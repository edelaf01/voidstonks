// Historial y catálogo del worker de rivens.
//
// El service nació al sacar a `ui_rivens.js` del repositorio, pero lo que absorbe de verdad son
// dos cosas que el componente repetía en sus cuatro puntos de llamada: el `try/catch` (el
// repositorio LANZA si la respuesta no es ok, y una de las cuatro no lo envolvía) y la forma de
// la respuesta, que el worker manda unas veces envuelta en `{data}` y otras plana.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
const urls = [];
globalThis.fetch = async (url) => {
  urls.push(String(url));
  return responder(String(url));
};

const { getWeaponHistory, getRivenIndex } = await import(
  "../deploy/js/services/rivens/riven_index.service.js"
);

const responde = (cuerpo, status = 200) => {
  responder = async () => ({
    ok: status >= 200 && status < 300, status, json: async () => cuerpo,
  });
};

// --- Historial ----------------------------------------------------------------------------

test("el historial llega tal cual cuando el worker responde", async () => {
  responde([{ datetime: "2026-01-01", median: 120 }]);
  const h = await getWeaponHistory("Kuva Bramma");
  assert.equal(h.length, 1);
  assert.equal(h[0].median, 120);
});

// La tasación tiene respaldo local: un fallo aquí no puede propagarse como excepción a un
// `.then()` sin `.catch`, que era el caso de una de las llamadas del componente.
test("un fallo del worker devuelve lista vacía, no una excepción", async () => {
  responde({}, 502);
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);

  responder = async () => { throw new Error("sin red"); };
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);
});

// El worker devuelve a veces `{data: [...], pos, neg}` en vez del array pelado; el repositorio
// ya lo desenvuelve, pero si llegara otra cosa el componente hacía `.map` sobre ella.
test("lo que no sea una lista se normaliza a lista vacía", async () => {
  responde({ algo: "raro" });
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);

  responde(null);
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);
});

// --- Catálogo -----------------------------------------------------------------------------

test("el catálogo se acepta plano y envuelto en {data}", async () => {
  responde({ "Kuva Bramma": { disposition: 0.8 } });
  const plano = await getRivenIndex();
  assert.equal(plano.ok, true);
  assert.deepEqual(Object.keys(plano.weapons), ["Kuva Bramma"]);

  responde({ data: { Torid: { disposition: 1.1 } } });
  const envuelto = await getRivenIndex();
  assert.equal(envuelto.ok, true);
  assert.deepEqual(Object.keys(envuelto.weapons), ["Torid"]);
});

// Colarlas en el mapa las pinta como una entrada más: aparecía "TTL" entre los resultados del
// buscador de armas.
test("las claves de metadatos no se cuelan como armas", async () => {
  responde({
    "Kuva Bramma": { disposition: 0.8 },
    NOTE: "algo", STATUS: "ok", VERSION: 3, TTL: 3600, ERROR: null, __baseline: { stat_weights: {} },
  });
  const r = await getRivenIndex();
  assert.deepEqual(Object.keys(r.weapons), ["Kuva Bramma"]);
});

test("el baseline sale aparte y solo si trae pesos", async () => {
  responde({ Torid: {}, __baseline: { stat_weights: { cc: 1 } } });
  const conPesos = await getRivenIndex();
  assert.deepEqual(conPesos.baseline, { stat_weights: { cc: 1 } });

  responde({ Torid: {}, __baseline: { otra_cosa: 1 } });
  const sinPesos = await getRivenIndex();
  assert.equal(sinPesos.baseline, null, "un __baseline sin stat_weights no vale como baseline");
});

// Devolver `ok:true` con un mapa vacío haría que el componente guardara ese vacío en su caché
// local y dejara de intentar el respaldo.
test("una respuesta vacía o con error no cuenta como catálogo", async () => {
  for (const cuerpo of [{}, { error: "upstream" }, null, { data: {} }]) {
    responde(cuerpo);
    assert.deepEqual(await getRivenIndex(), { ok: false }, JSON.stringify(cuerpo));
  }
});

test("un fallo de red tampoco revienta", async () => {
  responder = async () => { throw new Error("sin red"); };
  assert.deepEqual(await getRivenIndex(), { ok: false });
});

// Solo metadatos y nada de armas: el mapa queda vacío, pero la respuesta en sí era válida.
test("un catálogo que solo trae metadatos deja el mapa vacío", async () => {
  responde({ TTL: 3600, STATUS: "ok" });
  const r = await getRivenIndex();
  assert.equal(r.ok, true, "la respuesta era válida");
  assert.deepEqual(r.weapons, {}, "pero no hay ni un arma");
});
