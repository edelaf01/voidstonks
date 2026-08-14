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

test("el historial llega tal cual cuando el worker responde", async () => {
  responde([{ datetime: "2026-01-01", median: 120 }]);
  const h = await getWeaponHistory("Kuva Bramma");
  assert.equal(h.length, 1);
  assert.equal(h[0].median, 120);
});

test("un fallo del worker devuelve lista vacía, no una excepción", async () => {
  responde({}, 502);
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);

  responder = async () => { throw new Error("sin red"); };
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);
});

test("lo que no sea una lista se normaliza a lista vacía", async () => {
  responde({ algo: "raro" });
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);

  responde(null);
  assert.deepEqual(await getWeaponHistory("Kuva Bramma"), []);
});

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

// returning ok:true with an empty map caches the empty state and stops local fallback attempts
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

test("un catálogo que solo trae metadatos deja el mapa vacío", async () => {
  responde({ TTL: 3600, STATUS: "ok" });
  const r = await getRivenIndex();
  assert.equal(r.ok, true, "la respuesta era válida");
  assert.deepEqual(r.weapons, {}, "pero no hay ni un arma");
});
