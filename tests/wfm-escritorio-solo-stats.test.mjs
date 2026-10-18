import { test } from "node:test";
import assert from "node:assert/strict";
import { creaWfm } from "../desktop/electron/src/wfm.js";

const V1 = "https://api.warframe.market/v1";

const json = (datos, init = {}) =>
  new Response(JSON.stringify(datos), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });

const montaje = ({
  responde = () => json({}),
  reloj = { t: 1_000_000_000 }
} = {}) => {
  const llamadas = [];
  const esperas = [];
  const rutaCatalogo = "/tmp/vs-test/wfm-catalogo.json";
  const wfm = creaWfm({
    fetch: async (url, init) => {
      llamadas.push({ url: String(url), init });
      return responde(String(url), init);
    },
    ahora: () => reloj.t,
    espera: async (ms) => {
      esperas.push(ms);
    },
    rutaCatalogo,
    leeFichero: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    escribeFichero: async () => {}
  });
  return { wfm, llamadas, esperas, reloj };
};

const statsPayload = {
  payload: {
    statistics_closed: {
      "48hours": [
        {
          datetime: "2026-10-18T10:00:00.000Z",
          volume: 5,
          median: 50,
          closed_price: 52,
          mod_rank: null
        }
      ]
    }
  }
};

test("solo stats pide solo estadisticas y devuelve sell buy vacios", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => json(statsPayload)
  });
  const res = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set", solo: "stats" }
  });
  assert.equal(res.status, 200);
  const cuerpo = JSON.parse(res.cuerpo);
  assert.ok(cuerpo.ash_prime_set);
  assert.deepEqual(cuerpo.ash_prime_set.sell, []);
  assert.deepEqual(cuerpo.ash_prime_set.buy, []);
  assert.equal(cuerpo.ash_prime_set.reciente[""].mediana, 50);
  assert.equal(cuerpo.ash_prime_set.reciente[""].ultima, 52);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, `${V1}/items/ash_prime_set/statistics`);
  assert.ok(!llamadas.some((l) => l.url.includes("/top")));
});

test("sin solo pide estadisticas y top", async () => {
  const topPayload = {
    data: {
      sell: [{ platinum: 60, quantity: 1, user: { ingameName: "u1", status: "ingame" } }],
      buy: []
    }
  };
  const { wfm, llamadas } = montaje({
    responde: (url) => (url.includes("/statistics") ? json(statsPayload) : json(topPayload))
  });
  const res = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set" }
  });
  assert.equal(res.status, 200);
  const cuerpo = JSON.parse(res.cuerpo);
  assert.equal(cuerpo.ash_prime_set.sell.length, 1);
  assert.equal(llamadas.length, 2);
  assert.ok(llamadas.some((l) => l.url.includes("/statistics")));
  assert.ok(llamadas.some((l) => l.url.includes("/top")));
});

test("solo stats con 404 devuelve 200 vacio sin freno", async () => {
  const { wfm, llamadas } = montaje({
    responde: () => new Response("Not Found", { status: 404 })
  });
  const res = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "no_existe", solo: "stats" }
  });
  assert.deepEqual(res, { status: 200, cuerpo: "{}" });
  assert.equal(llamadas.length, 1);
});

test("solo stats con 503 frena siguientes llamadas y sin solo devuelve 200", async () => {
  let statusHttp = 503;
  const { wfm, llamadas } = montaje({
    responde: () => new Response("Service Unavailable", { status: statusHttp })
  });
  const r1 = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set", solo: "stats" }
  });
  assert.deepEqual(r1, { status: 429, cuerpo: JSON.stringify({ error: "wfm_frenado" }) });
  assert.equal(llamadas.length, 1);

  llamadas.length = 0;
  const r2 = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set", solo: "stats" }
  });
  assert.deepEqual(r2, { status: 429, cuerpo: JSON.stringify({ error: "wfm_frenado" }) });
  assert.equal(llamadas.length, 0);

  const rSinSolo = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set" }
  });
  assert.deepEqual(rSinSolo, { status: 200, cuerpo: "{}" });
  assert.equal(llamadas.length, 0);
});

test("solo stats con dos slugs devuelve 200 con el bueno antes del freno", async () => {
  const { wfm, llamadas } = montaje({
    responde: (url) => {
      if (url.includes("ash_prime_set")) return json(statsPayload);
      return new Response("Service Unavailable", { status: 503 });
    }
  });
  const res = await wfm.ejecuta("wfm_market_batch", {
    params: { slugs: "ash_prime_set,primed_flow", solo: "stats" }
  });
  assert.equal(res.status, 200);
  const cuerpo = JSON.parse(res.cuerpo);
  assert.ok(cuerpo.ash_prime_set);
  assert.equal(cuerpo.primed_flow, undefined);
  assert.equal(llamadas.length, 2);
});
