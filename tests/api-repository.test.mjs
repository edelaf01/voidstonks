// the gateway to every worker request: what is cached, what is not and what happens on failure
// checked by running it and looking at the options fetch actually receives

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

test("los datos que rotan se piden con no-cache", async () => {
  reset();
  for (const pedir of [api.getActiveBounties, api.getActiveFissures, api.getArbitration, api.getLichWeapons]) {
    await pedir();
    assert.equal(ultima().init.cache, "no-cache", ultima().url);
  }
});

// the Cloudflare edge has stale-while-revalidate and keeps serving the old window for a couple of minutes; a new cache key gets around it
test("forzar el refresco estrena clave de caché para esquivar también al edge", async () => {
  reset();
  await api.getActiveBounties(false);
  assert.ok(!ultima().url.includes("_cb="), "sin force no se ensucia la URL");

  await api.getActiveBounties(true);
  assert.match(ultima().url, /[?&]_cb=\d+/, "con force sí");
});

test("lo que solo vale ahora se pide con no-store", async () => {
  reset();
  await api.getServerTime();
  assert.equal(ultima().init.cache, "no-store");

  await api.sendSyncMessage("1234", "hola");
  assert.equal(ultima().init.cache, "no-store");

  await api.getSyncMessage("1234");
  assert.equal(ultima().init.cache, "no-store");
});

test("el catálogo NO desactiva la caché del navegador", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({ p: {} }) });

  await api.getPricesSnapshot();
  assert.equal(ultima().init.cache, undefined, "el snapshot de precios se cachea");

  await api.getPricesBatch(["ash_prime_set"]);
  assert.equal(ultima().init.cache, undefined, "los lotes de precios también");
});

// the real 10-15 s timeout is not awaited, only the wiring: a live signal arrives and the rejection propagates
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
  assert.equal(maximo, 3, "las tres deben solaparse");
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

// the drop tables version (WFCD info.json) decides whether the copy is valid, not its age
async function conCopia(copia, info) {
  const { dbHelper } = await import("../deploy/js/repositories/storage.repository.js");
  const orig = { get: dbHelper.get, set: dbHelper.set };
  const guardado = [];
  dbHelper.get = async () => copia;
  dbHelper.set = async (_k, v) => { guardado.push(v); };
  responder = async (url) => (url.includes("info.json")
    ? (info ? { ok: true, status: 200, json: async () => info } : Promise.reject(new Error("sin red")))
    : { ok: true, status: 200, json: async () => ({ relics: [{ tier: "Axi", relicName: "C12" }] }) });
  reset();
  try {
    const datos = await api.loadRelicsData("clave_version", 48 * 3600 * 1000);
    return { datos, guardado, alWorker: llamadas.filter((l) => !l.url.includes("info.json")).map((l) => l.url) };
  } finally {
    Object.assign(dbHelper, orig);
    responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
  }
}

test("con las tablas de drops sin cambios, la copia vale aunque tenga días", async () => {
  const copia = { timestamp: Date.now() - 5 * 24 * 3600 * 1000, version: "abc", data: { relics: ["vieja"] } };
  const { datos, alWorker } = await conCopia(copia, { hash: "abc" });
  assert.deepEqual(datos.relics, ["vieja"]);
  assert.deepEqual(alWorker, [], "ni una petición al worker");
});

test("si cambian las tablas, se piden con la versión en la URL y se guarda la versión nueva", async () => {
  const copia = { timestamp: Date.now() - 60 * 1000, version: "abc", data: { relics: ["vieja"] } };
  const { datos, guardado, alWorker } = await conCopia(copia, { hash: "def" });
  assert.equal(datos.relics[0].relicName, "C12");
  assert.equal(alWorker.length, 3);
  for (const url of alWorker) assert.match(url, /&v=def$/);
  assert.equal(guardado[0].version, "def");
});

test("sin poder leer la versión, manda la caducidad de 48 h de siempre", async () => {
  const fresca = await conCopia({ timestamp: Date.now() - 3600 * 1000, version: "abc", data: { relics: ["vieja"] } }, null);
  assert.deepEqual(fresca.datos.relics, ["vieja"]);
  const caducada = await conCopia({ timestamp: Date.now() - 49 * 3600 * 1000, version: "abc", data: { relics: ["vieja"] } }, null);
  assert.equal(caducada.alWorker.length, 3);
  for (const url of caducada.alWorker) assert.doesNotMatch(url, /&v=/, "sin versión la URL es la de siempre");
});

test("el resultado rellena las claves que falten en vez de dejarlas sin definir", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  const datos = await api.loadRelicsData("clave_test3", 60000);
  assert.deepEqual(datos.relics, []);
  assert.deepEqual(datos.missionRewards, {});
  assert.deepEqual(datos.cetusBountyRewards, []);
  assert.deepEqual(datos.solarisBountyRewards, []);
  assert.deepEqual(datos.zarimanRewards, []);
  assert.deepEqual(datos.deimosRewards, []);
});

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
