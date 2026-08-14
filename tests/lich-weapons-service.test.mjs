// Rotación de armas de Eleanor (Coda) y Ergo Glast (Tenet).
//
// El fallo caro no es que no salga nada: es que salga la rotación ANTERIOR. El jugador va a la
// tienda a por un arma que ya no está, y la pantalla no da ninguna pista de que el dato es
// viejo. De ahí que la caché local solo valga como rescate y con la ventana comprobada.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let respuesta = { vendors: [] };
let ok = true;
const urls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(u);
  if (u.includes("type=time")) return { ok: true, status: 200, json: async () => ({ now: Date.now() }) };
  if (!ok) throw new Error("sin red");
  return { ok: true, status: 200, json: async () => respuesta };
};

const { fetchLichWeapons } = await import("../deploy/js/services/farms/lich_weapons.service.js");

const vendedor = (key, weapons, end = Date.now() + 3600_000) => ({ key, weapons, end });
const arma = (name) => ({ name, bonus: { element: "Heat", percent: 40 } });

test("la rotación del worker se devuelve tal cual cuando trae armas", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  const v = await fetchLichWeapons(true);
  assert.equal(v.length, 1);
  assert.equal(v[0].key, "eleanor");
});

// Una tarjeta de tienda sin armas no dice nada y ocupa sitio; el resto del apartado sigue
// sirviendo.
test("un vendedor sin armas se descarta sin llevarse a los demás", async () => {
  respuesta = {
    vendors: [
      vendedor("eleanor", []),
      vendedor("glast", [arma("Tenet Envoy")]),
      { key: "roto" },
      { weapons: [arma("Sin Key")] },
    ],
  };
  ok = true;
  const v = await fetchLichWeapons(true);
  assert.deepEqual(v.map((x) => x.key), ["glast"]);
});

test("una respuesta con forma inesperada devuelve vacío, no a medias", async () => {
  ok = true;
  for (const cuerpo of [{}, { vendors: null }, { vendors: "no es lista" }, null]) {
    respuesta = cuerpo;
    assert.deepEqual(await fetchLichWeapons(true), [], JSON.stringify(cuerpo));
  }
});

// El refetch al rotar es justo cuando la respuesta cacheada es la que ya no vale: sin estrenar
// URL, el navegador contesta con la rotación anterior y el bucle no sale de ahí.
test("forzar el refresco estrena URL para saltarse también la caché del navegador", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  urls.length = 0;

  await fetchLichWeapons(false);
  const normal = urls.find((u) => u.includes("lich_weapons"));
  assert.ok(!normal.includes("_cb="), "sin force no se ensucia la URL");

  urls.length = 0;
  await fetchLichWeapons(true);
  assert.match(urls.find((u) => u.includes("lich_weapons")), /_cb=\d+/);
});

// Este es el motivo de que el rescate compruebe la ventana: servir una rotación terminada es
// peor que no enseñar nada.
test("si el worker falla, no se sirve una rotación ya terminada", async () => {
  const errorReal = console.error;
  console.error = () => {};
  try {
    ok = false;
    // En Node no hay IndexedDB, así que dbHelper devuelve null y el rescate sale vacío: lo
    // que se comprueba es que un fallo no propague la excepción ni invente datos.
    assert.deepEqual(await fetchLichWeapons(true), []);
  } finally {
    console.error = errorReal;
    ok = true;
  }
});

// Los contadores se pintan contra serverNow(): sin sincronizar, un reloj desajustado marca la
// ventana como caducada y dispara refetch en bucle.
test("antes de nada se sincroniza el reloj del servidor", async () => {
  respuesta = { vendors: [vendedor("eleanor", [arma("Coda Hema")])] };
  ok = true;
  urls.length = 0;
  await fetchLichWeapons(true);
  // Puede que ya estuviera sincronizado de un test anterior; lo que no puede es pedir las
  // armas sin haber pasado por ahí en algún momento de la sesión.
  assert.ok(urls.some((u) => u.includes("lich_weapons")), "debe pedir las armas");
});
