import { test, after } from "node:test";
import assert from "node:assert/strict";

const origLocalStorage = globalThis.localStorage;
const origFetch = globalThis.fetch;
const origNativo = globalThis.voidstonksNativo;

const almacenLocal = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacenLocal.has(k) ? almacenLocal.get(k) : null),
  setItem: (k, v) => almacenLocal.set(k, String(v)),
  removeItem: (k) => almacenLocal.delete(k),
  clear: () => almacenLocal.clear()
};

const rutas = new Map();
const peticiones = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  peticiones.push({ url: u, init });
  for (const [patron, responder] of rutas) {
    if (u.includes(patron)) return responder(u, init);
  }
  return respuesta(404);
};

function respuesta(status, cuerpo = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
    headers: { get: (h) => headers[h] ?? null }
  };
}

const { estadisticasDe } = await import("../deploy/js/services/market/wfm_orders.service.js");

function reset() {
  almacenLocal.clear();
  rutas.clear();
  peticiones.length = 0;
  delete globalThis.voidstonksNativo;
}

after(() => {
  if (origLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = origLocalStorage;
  if (origFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = origFetch;
  if (origNativo === undefined) delete globalThis.voidstonksNativo;
  else globalThis.voidstonksNativo = origNativo;
});

test("sin slug devuelve no_slug sin fetch", async () => {
  reset();
  for (const slug of ["", null, undefined]) {
    const res = await estadisticasDe(slug);
    assert.deepEqual(res, { ok: false, error: "no_slug" });
  }
  assert.equal(peticiones.length, 0);
});

test("respuesta 200 con el slug devuelve mercado", async () => {
  reset();
  const mercado = { median: 100 };
  rutas.set("wfm_market_batch", () => respuesta(200, { ash_prime_set: mercado }));
  const res = await estadisticasDe("ash_prime_set");
  assert.deepEqual(res, { ok: true, mercado });
});

test("respuesta 200 sin el slug devuelve mercado null", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  const res = await estadisticasDe("ash_prime_set");
  assert.deepEqual(res, { ok: true, mercado: null });
});

test("respuesta 429 devuelve rate", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(429));
  const res = await estadisticasDe("ash_prime_set");
  assert.deepEqual(res, { ok: false, error: "rate" });
});

test("respuesta 500 devuelve server", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(500));
  const res = await estadisticasDe("ash_prime_set");
  assert.deepEqual(res, { ok: false, error: "server" });
});

test("fetch que lanza devuelve network", async () => {
  reset();
  rutas.set("wfm_market_batch", () => {
    throw new Error("red rota");
  });
  const res = await estadisticasDe("ash_prime_set");
  assert.deepEqual(res, { ok: false, error: "network" });
});

test("peticion incluye solo stats cache no-cache cb y slug codificado", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  await estadisticasDe("ash prime/set");
  assert.equal(peticiones.length, 1);
  const p = peticiones[0];
  assert.match(p.url, /solo=stats/);
  assert.match(p.url, /_cb=\d+/);
  assert.match(p.url, /slugs=ash%20prime%2Fset/);
  assert.equal(p.init?.cache, "no-cache");
});

test("no escribe en vs_mercado_v1 de localStorage", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, { ash_prime_set: { median: 100 } }));
  await estadisticasDe("ash_prime_set");
  assert.equal(almacenLocal.get("vs_mercado_v1"), undefined);
});

test("con puente nativo envia tipo params solo y slug", async () => {
  reset();
  const llamadas = [];
  globalThis.voidstonksNativo = {
    wfm: async (tipo, peticion) => {
      llamadas.push({ tipo, peticion });
      return { status: 200, cuerpo: JSON.stringify({ ash_prime_set: { median: 80 } }) };
    }
  };
  try {
    const res = await estadisticasDe("ash_prime_set");
    assert.deepEqual(res, { ok: true, mercado: { median: 80 } });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].tipo, "wfm_market_batch");
    assert.equal(llamadas[0].peticion.params.solo, "stats");
    assert.equal(llamadas[0].peticion.params.slugs, "ash_prime_set");
  } finally {
    delete globalThis.voidstonksNativo;
  }
});
