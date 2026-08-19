// Puerta de todo el tráfico al worker: qué se cachea, qué no, y qué pasa cuando falla.
//
// `http-cache-policy.test.mjs` ya vigila esto grepeando el fuente. Esto lo comprueba
// EJECUTÁNDOLO: mira qué opciones llegan de verdad a fetch. Un endpoint nuevo declarado en la
// clase equivocada no rompe nada visible — reaparece el bug que motivó toda esta política:
// bounties clavadas en "ROTATING" durante dos rotaciones, sin salir ni forzando el refetch ni
// recargando, porque el zone de Cloudflare reescribe el Cache-Control a 5 h y el navegador
// respondía desde su propia copia.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const llamadas = [];
let responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

globalThis.fetch = async (url, init) => {
  llamadas.push({ url: String(url), init });
  return responder(String(url), init);
};

const api = await import("../deploy/js/repositories/api.repository.js");

const ultima = () => llamadas.at(-1);
const reset = () => { llamadas.length = 0; };

// --- Clases de caché --------------------------------------------------------------------

// Los datos que rotan a hora fija: si la petición llega aquí es porque la copia de aguas
// arriba ya caducó, así que la del navegador está igual de vieja y no puede responder.
test("los datos que rotan se piden con no-cache", async () => {
  reset();
  for (const pedir of [api.getActiveBounties, api.getActiveFissures, api.getArbitration, api.getLichWeapons]) {
    await pedir();
    assert.equal(ultima().init.cache, "no-cache", ultima().url);
  }
});

// `force` es el botón de refrescar. El no-cache convence al navegador, pero el edge de
// Cloudflare tiene stale-while-revalidate y sigue sirviendo la ventana vieja un par de minutos
// — justo los que importan cuando se acaba de rotar. Estrenar clave de caché lo esquiva.
test("forzar el refresco estrena clave de caché para esquivar también al edge", async () => {
  reset();
  await api.getActiveBounties(false);
  assert.ok(!ultima().url.includes("_cb="), "sin force no se ensucia la URL");

  await api.getActiveBounties(true);
  assert.match(ultima().url, /[?&]_cb=\d+/, "con force sí");
});

// La hora del servidor y el buzón de sync: una copia no es un dato viejo, es un dato falso.
// El buzón vive 60 s en KV y la escritura viaja en un GET — si el navegador responde de su
// caché, la petición NO sale y el mensaje no llega a escribirse.
test("lo que solo vale ahora se pide con no-store", async () => {
  reset();
  await api.getServerTime();
  assert.equal(ultima().init.cache, "no-store");

  await api.sendSyncMessage("1234", "hola");
  assert.equal(ultima().init.cache, "no-store");

  await api.getSyncMessage("1234");
  assert.equal(ultima().init.cache, "no-store");
});

// El catálogo cambia con los parches del juego: aquí la caché del navegador es justo lo que se
// quiere, y las 5 h del zone no molestan. Declararlos no-cache tiraría a la basura el ahorro.
test("el catálogo NO desactiva la caché del navegador", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({ p: {} }) });

  await api.getPricesSnapshot();
  assert.equal(ultima().init.cache, undefined, "el snapshot de precios se cachea");

  await api.getPricesBatch(["ash_prime_set"]);
  assert.equal(ultima().init.cache, undefined, "los lotes de precios también");
});

// --- Timeout ----------------------------------------------------------------------------

// Sin abortar, una petición colgada deja la pestaña esperando para siempre: el usuario ve el
// spinner y no hay error que lo saque de ahí.
//
// No se espera al timeout de verdad (10-15 s según el endpoint): eso solo mediría un
// setTimeout y añadiría esos segundos a cada `npm test`. Lo que se comprueba es el cableado —
// que llega una señal viva y que el rechazo se propaga en vez de tragarse.
test("cada petición lleva una señal de aborto viva", async () => {
  reset();
  await api.getActiveFissures();
  const { signal } = ultima().init;
  assert.ok(signal, "sin signal no hay timeout posible");
  assert.equal(signal.aborted, false, "no puede llegar ya abortada");
  assert.equal(typeof signal.addEventListener, "function");
});

test("si la petición se aborta, el error sale afuera y no se traga", async () => {
  reset();
  responder = async () => { throw new Error("AbortError"); };
  await assert.rejects(() => api.getServerTime(), /AbortError/);
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

// --- loadRelicsData ---------------------------------------------------------------------

// Las tres respuestas son piezas del mismo dato. Quedarse con las que llegaron dejaría la base
// de reliquias a medias y en silencio: recompensas de misión vacías, bounties sin premios, y
// el usuario buscando por qué "no salen las reliquias de Cetus".
test("si una de las tres respuestas falla, no se construye una base a medias", async () => {
  reset();
  responder = async (url) => ({
    ok: !url.includes("bounties_opt"),
    status: url.includes("bounties_opt") ? 502 : 200,
    json: async () => ({}),
  });

  await assert.rejects(() => api.loadRelicsData("clave_test", 60000), /Partial/);
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

test("las tres piezas del catálogo se piden a la vez, no en cadena", async () => {
  reset();
  let simultaneas = 0;
  let maximo = 0;
  responder = async () => {
    simultaneas++;
    maximo = Math.max(maximo, simultaneas);
    await new Promise((r) => setTimeout(r, 10));
    simultaneas--;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await api.loadRelicsData("clave_test2", 60000);
  // En cadena serían 3 viajes de ida y vuelta al worker en el arranque, que es justo cuando
  // el usuario está esperando a que aparezca algo en pantalla.
  assert.equal(maximo, 3, "las tres deben solaparse");
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

test("el resultado rellena las claves que falten en vez de dejarlas sin definir", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  const datos = await api.loadRelicsData("clave_test3", 60000);
  // Quien consume esto hace `.forEach` sobre ellas: un undefined revienta el arranque entero.
  assert.deepEqual(datos.relics, []);
  assert.deepEqual(datos.missionRewards, {});
  assert.deepEqual(datos.cetusBountyRewards, []);
  assert.deepEqual(datos.solarisBountyRewards, []);
  assert.deepEqual(datos.zarimanRewards, []);
  assert.deepEqual(datos.deimosRewards, []);
});

// --- Construcción de URLs ---------------------------------------------------------------

test("los slugs se codifican al ir en la querystring", async () => {
  reset();
  await api.getProfileData("Tenno Con Espacio", "pc");
  assert.ok(!ultima().url.includes("Tenno Con Espacio"), ultima().url);
  assert.match(ultima().url, /Tenno(%20|\+)Con/);
});

test("el buzón de sync codifica el mensaje: puede llevar corchetes y comas", async () => {
  reset();
  await api.sendSyncMessage("1234", "[Lith A1] x3, [Axi Z9] x1");
  const u = ultima().url;
  assert.ok(!u.includes("[Lith A1]"), "sin codificar, los corchetes rompen la URL");
  assert.match(u, /id=1234/);
});
