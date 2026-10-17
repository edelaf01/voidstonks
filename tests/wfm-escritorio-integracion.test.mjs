import { test } from "node:test";
import assert from "node:assert/strict";
import { creaWfm } from "../desktop/electron/src/wfm.js";

const sessionMap = new Map();
const localMap = new Map();

globalThis.sessionStorage = {
  getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
  setItem: (k, v) => sessionMap.set(k, String(v)),
  removeItem: (k) => sessionMap.delete(k),
  clear: () => sessionMap.clear()
};

globalThis.localStorage = {
  getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
  setItem: (k, v) => localMap.set(k, String(v)),
  removeItem: (k) => localMap.delete(k),
  clear: () => localMap.clear()
};

globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

const alNavegador = [];
globalThis.fetch = async (url) => {
  alNavegador.push(String(url));
  throw new Error("el renderer no debe salir a la red");
};

const { WORKER_URL } = await import("../deploy/js/config.js");
const auth = await import("../deploy/js/services/market/wfm_auth.service.js");
const orders = await import("../deploy/js/services/market/wfm_orders.service.js");
const link = await import("../deploy/js/services/market/wfm_link.service.js");

const ORDEN = "111111111111111111111111";
const ITEM_A = "222222222222222222222222";
const ITEM_B = "333333333333333333333333";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor((Date.now() + 3600_000) / 1000) })}.firma`;

const aWfm = [];

async function wfmFetch(url, init = {}) {
  const u = String(url);
  const metodo = init.method || "GET";
  const headers = init.headers || {};
  const cuerpo = init.body ?? null;
  aWfm.push({ url: u, metodo, headers, body: cuerpo });

  const authHeader = headers.Authorization || headers.authorization;

  if (u === "https://api.warframe.market/v1/auth/signin" && metodo === "POST") {
    return new Response(JSON.stringify({ payload: { user: { ingame_name: "Tenno", slug: "tenno" } } }), {
      status: 200,
      headers: { authorization: `JWT ${TOKEN}`, "content-type": "application/json" }
    });
  }
  if (u === "https://api.warframe.market/v2/orders/my" && metodo === "GET") {
    if (authHeader === `Bearer ${TOKEN}`) {
      return new Response(JSON.stringify({
        data: [{ id: ORDEN, itemId: ITEM_A, type: "sell", platinum: 10, quantity: 1 }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  if (u === "https://api.warframe.market/v2/auth/signout" && metodo === "POST") {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u === "https://api.warframe.market/v2/items" && metodo === "GET") {
    return new Response(JSON.stringify({
      data: [
        { id: ITEM_A, slug: "ash_prime_set", i18n: { en: { name: "Ash Prime Set", thumb: "items/ash.png" } } },
        { id: ITEM_B, slug: "serration", maxRank: 10, i18n: { en: { name: "Serration", thumb: "items/serration.png" } } }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u === `https://api.warframe.market/v2/order/${ORDEN}` && metodo === "PATCH") {
    return new Response(JSON.stringify({ data: { id: ORDEN } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (u === "https://api.warframe.market/v2/order" && metodo === "POST") {
    return new Response(JSON.stringify({ data: { id: "nueva" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (u === "https://api.warframe.market/v1/items/serration/statistics" && metodo === "GET") {
    return new Response(JSON.stringify({
      payload: {
        statistics_closed: {
          "90days": [{ datetime: "d1", median: 30, avg_price: 31, volume: 4, min_price: 25, max_price: 35 }],
          "48hours": []
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u === "https://api.warframe.market/v2/orders/item/serration/top" && metodo === "GET") {
    return new Response(JSON.stringify({
      data: {
        sell: [{ platinum: 29, quantity: 1, user: { ingameName: "Vende", status: "ingame" } }],
        buy: []
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
}

const main = creaWfm({
  fetch: wfmFetch,
  ahora: () => 1_000_000_000,
  espera: async () => {},
  rutaCatalogo: "/tmp/vs-test/catalogo.json",
  leeFichero: async () => {
    throw new Error("ENOENT");
  },
  escribeFichero: async () => {}
});

globalThis.voidstonksNativo = {
  wfm: (tipo, peticion) => main.ejecuta(String(tipo), peticion)
};

async function entra() {
  sessionMap.clear();
  localMap.clear();
  aWfm.length = 0;
  alNavegador.length = 0;
  const res = await auth.login("yo@x.com", "secreto-123", "pc");
  assert.deepEqual(res, { ok: true, ingameName: "Tenno", authorized: true });
  aWfm.length = 0;
}

test("con el puente wfmPrivado es true y el login va directo a warframe.market", async () => {
  assert.equal(auth.wfmPrivado(), true);
  sessionMap.clear();
  localMap.clear();
  aWfm.length = 0;
  alNavegador.length = 0;
  const res = await auth.login("yo@x.com", "secreto-123", "pc");
  assert.deepEqual(res, { ok: true, ingameName: "Tenno", authorized: true });
  assert.equal(sessionMap.get("wfm_jwt"), TOKEN);
  assert.equal(sessionMap.get("wfm_slug"), "tenno");
  assert.equal(sessionMap.get("wfm_name"), "Tenno");
  assert.equal(sessionMap.get("wfm_scope"), "full");
  assert.equal(sessionMap.get("wfm_platform"), "pc");
  assert.equal(auth.getToken(), TOKEN);
  assert.equal(aWfm[0].metodo, "POST");
  assert.equal(aWfm[0].url, "https://api.warframe.market/v1/auth/signin");
  assert.deepEqual(JSON.parse(aWfm[0].body), { email: "yo@x.com", password: "secreto-123" });
  assert.equal(alNavegador.length, 0);
});

test("mis órdenes se leen de warframe.market con el token y se enriquecen con el catálogo", async () => {
  await entra();
  const res = await orders.fetchMyOrders();
  assert.equal(res.ok, true);
  assert.equal(res.orders[0].itemName, "Ash Prime Set");
  assert.equal(res.orders[0].itemSlug, "ash_prime_set");
  assert.equal(res.orders[0].itemThumb, "https://warframe.market/static/assets/items/ash.png");
  assert.equal(auth.getScope(), "full");
  const tieneOrdersMy = aWfm.some(
    (p) =>
      p.url === "https://api.warframe.market/v2/orders/my" &&
      p.metodo === "GET" &&
      (p.headers.Authorization === `Bearer ${TOKEN}` || p.headers.authorization === `Bearer ${TOKEN}`)
  );
  assert.equal(tieneOrdersMy, true);
  const tieneItems = aWfm.some(
    (p) => p.url === "https://api.warframe.market/v2/items" && p.metodo === "GET"
  );
  assert.equal(tieneItems, true);
});

test("editar una orden manda el PATCH a warframe.market", async () => {
  await entra();
  const res = await orders.editOrder(ORDEN, "update", { platinum: 12 });
  assert.deepEqual(res, { ok: true });
  const ultima = aWfm.at(-1);
  assert.equal(ultima.metodo, "PATCH");
  assert.equal(ultima.url, `https://api.warframe.market/v2/order/${ORDEN}`);
  assert.deepEqual(JSON.parse(ultima.body), { platinum: 12 });
});

test("el mercado de varios ítems sale del proceso main", async () => {
  sessionMap.clear();
  localMap.clear();
  aWfm.length = 0;
  alNavegador.length = 0;
  const res = await orders.fetchMarketBatch(["serration"]);
  assert.equal(res.serration?.median, 30);
  assert.equal(res.serration?.sell?.[0]?.user, "Vende");
  const tieneStats = aWfm.some(
    (p) => p.url === "https://api.warframe.market/v1/items/serration/statistics" && p.metodo === "GET"
  );
  const tieneTop = aWfm.some(
    (p) => p.url === "https://api.warframe.market/v2/orders/item/serration/top" && p.metodo === "GET"
  );
  assert.equal(tieneStats, true);
  assert.equal(tieneTop, true);
});

test("resolver slugs a ids y publicar una orden van por el puente", async () => {
  await entra();
  const resIds = await link.resolveIds(["ash_prime_set"]);
  assert.deepEqual(resIds, {
    ash_prime_set: { id: ITEM_A, name: "Ash Prime Set", thumb: "items/ash.png" }
  });
  const resOrder = await link.createSellOrder({
    itemId: ITEM_A,
    platinum: 15,
    quantity: 2,
    slug: "ash_prime_set"
  });
  assert.deepEqual(resOrder, { ok: true });
  const postOrder = aWfm.find(
    (p) => p.url === "https://api.warframe.market/v2/order" && p.metodo === "POST"
  );
  assert.ok(postOrder);
  assert.equal(
    postOrder.headers.Authorization || postOrder.headers.authorization,
    `Bearer ${TOKEN}`
  );
  assert.equal(postOrder.headers.platform, "pc");
  assert.deepEqual(JSON.parse(postOrder.body), {
    itemId: ITEM_A,
    type: "sell",
    platinum: 15,
    quantity: 2
  });
  assert.equal(link.isListed("ash_prime_set"), true);
});

test("cerrar sesión revoca el token en warframe.market y borra la sesión", async () => {
  await entra();
  const res = await auth.logout();
  assert.deepEqual(res, { ok: true, revoked: true });
  const tieneSignout = aWfm.some(
    (p) =>
      p.url === "https://api.warframe.market/v2/auth/signout" &&
      p.metodo === "POST" &&
      (p.headers.Authorization === `Bearer ${TOKEN}` || p.headers.authorization === `Bearer ${TOKEN}`)
  );
  assert.equal(tieneSignout, true);
  assert.equal(auth.getToken(), null);
});

test("nada sale hacia el worker", () => {
  assert.equal(alNavegador.length, 0);
  assert.ok(aWfm.length > 0);
  for (const p of aWfm) {
    assert.equal(p.url.startsWith(WORKER_URL), false);
    assert.equal(p.url.startsWith("https://api.warframe.market/"), true);
  }
});

test("si el puente se cae, el servicio lo trata como error de red", async () => {
  await entra();
  const origWfm = globalThis.voidstonksNativo.wfm;
  try {
    globalThis.voidstonksNativo.wfm = async () => {
      throw new Error("ipc caído");
    };
    const res = await orders.fetchMyOrders();
    assert.deepEqual(res, { ok: false, error: "network" });
  } finally {
    globalThis.voidstonksNativo.wfm = origWfm;
  }
});

test.after(() => {
  delete globalThis.voidstonksNativo;
});
