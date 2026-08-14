// Órdenes de warframe.market: leerlas, editarlas y adornarlas con nombre e icono.
//
// Es el camino de escritura sobre la cuenta del usuario, y su modo de fallo típico no es una
// excepción: es que la lista salga vacía o a medias y parezca que "no hay órdenes". Lo que se
// fija aquí son las decisiones que producen ese resultado sin ruido — la forma de la respuesta
// de la v2, el troceo que evita el 500 del worker, y que un fallo parcial degrade en vez de
// tumbar la pantalla entera.

import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

/** Enrutador de respuestas: cada test declara qué contesta cada endpoint. */
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
    headers: { get: (h) => headers[h] ?? null },
  };
}

const orders = await import("../deploy/js/services/market/wfm_orders.service.js");
const auth = await import("../deploy/js/services/market/wfm_auth.service.js");

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.firma`;
}

function conSesion({ token = true, slug = "tenno" } = {}) {
  almacen.clear();
  if (token) {
    almacen.set("wfm_jwt", jwt({ exp: Math.floor((Date.now() + 3600_000) / 1000) }));
    almacen.set("wfm_exp", String(Date.now() + 3600_000));
  }
  if (slug) almacen.set("wfm_slug", slug);
}

const reset = () => {
  rutas.clear();
  peticiones.length = 0;
};

test("sin token ni slug no se pide nada", async () => {
  reset();
  almacen.clear();
  assert.deepEqual(await orders.fetchMyOrders(), { ok: false, error: "no_token" });
  assert.equal(peticiones.length, 0);
});

// El slug viaja siempre aunque haya token: si el JWT no autoriza la v2, el worker cae a las
// órdenes públicas del perfil y el usuario no nota nada. Sin el slug, esa caída no es posible.
test("el slug viaja aunque haya token, para que el worker pueda caer a lo público", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => respuesta(200, { data: [] }));

  await orders.fetchMyOrders();
  const p = peticiones.find((x) => x.url.includes("wfm_my_orders"));
  assert.match(p.url, /user=tenno/);
  assert.ok(p.init.headers["X-WFM-Token"], "y el token también");
});

// WFM v2 responde `data` como array o como {sell, buy} según el endpoint que sirva el worker.
// Tratar solo uno de los dos casos deja la lista vacía sin ningún error visible.
test("acepta las dos formas de 'data' que devuelve la v2", async () => {
  reset();
  conSesion();

  rutas.set("wfm_my_orders", () => respuesta(200, { data: [{ id: "a" }, { id: "b" }] }));
  let res = await orders.fetchMyOrders();
  assert.equal(res.ok, true);
  assert.deepEqual(res.orders.map((o) => o.id), ["a", "b"]);

  reset();
  rutas.set("wfm_my_orders", () =>
    respuesta(200, { data: { sell: [{ id: "s1" }], buy: [{ id: "b1" }] } }));
  res = await orders.fetchMyOrders();
  assert.deepEqual(res.orders.map((o) => o.id), ["s1", "b1"]);
});

test("401 y 403 se distinguen de un error de servidor", async () => {
  reset();
  conSesion();
  for (const status of [401, 403]) {
    rutas.clear();
    rutas.set("wfm_my_orders", () => respuesta(status));
    assert.deepEqual(await orders.fetchMyOrders(), { ok: false, error: "unauthorized" });
  }
  rutas.clear();
  rutas.set("wfm_my_orders", () => respuesta(500));
  assert.deepEqual(await orders.fetchMyOrders(), { ok: false, error: "server" });
});

test("un cuerpo con 'error' cuenta como no autorizado aunque el HTTP sea 200", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => respuesta(200, { error: "invalid_token" }));
  assert.deepEqual(await orders.fetchMyOrders(), { ok: false, error: "unauthorized" });
});

test("un JSON ilegible no revienta: se reporta como error de servidor", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => { throw new Error("no es JSON"); },
  }));
  assert.deepEqual(await orders.fetchMyOrders(), { ok: false, error: "server" });
});

// El scope real solo se conoce al USAR el token. Reevaluarlo en cada carga permite que una
// sesión marcada "public" pase a "full" (p. ej. tras desplegar un worker corregido) sin que el
// usuario tenga que volver a conectarse.
test("el scope servido por el worker se guarda en cada carga", async () => {
  reset();
  conSesion();
  auth.cacheScope("public");
  assert.equal(auth.getScope(), "public");

  rutas.set("wfm_my_orders", () => respuesta(200, { data: [] }, { "X-WFM-Scope": "full" }));
  await orders.fetchMyOrders();
  assert.equal(auth.getScope(), "full", "debe corregirse sin reloguear");
});

// 76 ids en una sola petición daban 500: el worker pasaba del tope de subrequests de Cloudflare
// por hacer una escritura de caché por ítem.
test("los ids se resuelven en tandas de 25 como mucho", async () => {
  reset();
  conSesion();
  const muchos = Array.from({ length: 60 }, (_, i) => `id${String(i).padStart(3, "0")}`);
  rutas.set("wfm_my_orders", () =>
    respuesta(200, { data: muchos.map((itemId) => ({ id: itemId, itemId })) }));
  rutas.set("wfm_resolve", (u) => {
    const ids = new URL(u, "https://x").searchParams.get("ids").split(",");
    return respuesta(200, Object.fromEntries(ids.map((id) => [id, { name: `N-${id}`, slug: id }])));
  });

  await orders.fetchMyOrders();

  const resoluciones = peticiones.filter((p) => p.url.includes("wfm_resolve"));
  assert.ok(resoluciones.length >= 3, `60 ids necesitan >=3 tandas, hubo ${resoluciones.length}`);
  for (const p of resoluciones) {
    const n = new URL(p.url, "https://x").searchParams.get("ids").split(",").length;
    assert.ok(n <= 25, `una tanda llevaba ${n} ids`);
  }
});

test("las órdenes se adornan con nombre, slug y miniatura", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => respuesta(200, { data: [{ id: "o1", itemId: "i1" }] }));
  rutas.set("wfm_resolve", () =>
    respuesta(200, { i1: { name: "Ash Prime Set", slug: "ash_prime_set", thumb: "a/b.png", maxRank: 3 } }));

  const { orders: lista } = await orders.fetchMyOrders();
  assert.equal(lista[0].itemName, "Ash Prime Set");
  assert.equal(lista[0].itemSlug, "ash_prime_set");
  assert.equal(lista[0].itemThumb, "https://warframe.market/static/assets/a/b.png");
  assert.equal(lista[0].itemMaxRank, 3, "solo los rangueables traen maxRank");
});

// Sin nombre la lista es fea; sin lista no hay nada. La resolución es un adorno y no puede
// tumbar la carga.
test("si la resolución de nombres falla, las órdenes salen igual", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => respuesta(200, { data: [{ id: "o1", itemId: "i1" }] }));
  rutas.set("wfm_resolve", () => respuesta(500));

  const res = await orders.fetchMyOrders();
  assert.equal(res.ok, true);
  assert.equal(res.orders.length, 1);
  assert.equal(res.orders[0].itemName, undefined, "se queda sin nombre, pero está");
});

test("editar sin sesión no llega a salir a la red", async () => {
  reset();
  almacen.clear();
  assert.deepEqual(await orders.editOrder("o1", "update", { platinum: 10 }),
    { ok: false, error: "no_token" });
  assert.equal(peticiones.length, 0);
});

test("editar manda el token, el id y la acción, y el payload como JSON", async () => {
  reset();
  conSesion();
  rutas.set("wfm_order_edit", () => respuesta(200, {}));

  const res = await orders.editOrder("o 1/raro", "update", { platinum: 25, visible: false });
  assert.deepEqual(res, { ok: true });

  const p = peticiones.at(-1);
  assert.equal(p.init.method, "POST");
  assert.equal(p.init.headers["Content-Type"], "application/json");
  assert.ok(p.init.headers["X-WFM-Token"]);
  assert.deepEqual(JSON.parse(p.init.body), { platinum: 25, visible: false });
  assert.ok(!p.url.includes("o 1/raro"), "el id debe ir codificado en la URL");
  assert.match(p.url, /action=update/);
});

test("editar distingue no autorizado de error de servidor y de caída de red", async () => {
  reset();
  conSesion();

  rutas.set("wfm_order_edit", () => respuesta(403));
  assert.deepEqual(await orders.editOrder("o1", "close", {}), { ok: false, error: "unauthorized" });

  rutas.clear();
  rutas.set("wfm_order_edit", () => respuesta(500));
  assert.deepEqual(await orders.editOrder("o1", "close", {}), { ok: false, error: "server" });

  rutas.clear();
  rutas.set("wfm_order_edit", () => { throw new Error("sin red"); });
  assert.deepEqual(await orders.editOrder("o1", "close", {}), { ok: false, error: "network" });
});

test("el mercado de un ítem acota por rango solo si se pide un entero", async () => {
  reset();
  rutas.set("wfm_item_market", () => respuesta(200, { median: 12 }));

  await orders.fetchItemMarket("ash_prime_set");
  assert.ok(!peticiones.at(-1).url.includes("rank="), "sin rango no se manda el parámetro");

  await orders.fetchItemMarket("augur_secrets", 0);
  assert.match(peticiones.at(-1).url, /rank=0/, "rango 0 es un rango válido, no 'sin rango'");

  await orders.fetchItemMarket("augur_secrets", null);
  assert.ok(!peticiones.at(-1).url.includes("rank="));
});

test("sin slug no se pide el mercado", async () => {
  reset();
  assert.deepEqual(await orders.fetchItemMarket(""), { ok: false, error: "no_slug" });
  assert.equal(peticiones.length, 0);
});

// La lista de órdenes sigue siendo útil sin contexto de mercado, así que el lote degrada a {}
// en vez de propagar el error.
test("el lote de mercado deduplica, acota a 30 y degrada a vacío si falla", async () => {
  reset();
  rutas.set("wfm_market_batch", (u) => {
    const slugs = new URL(u, "https://x").searchParams.get("slugs").split(",");
    return respuesta(200, Object.fromEntries(slugs.map((s) => [s, { median: 1 }])));
  });

  await orders.fetchMarketBatch(["a", "a", "b", null, "", "c"]);
  const enviados = new URL(peticiones.at(-1).url, "https://x").searchParams.get("slugs").split(",");
  assert.deepEqual(enviados, ["a", "b", "c"], "sin duplicados ni vacíos");

  await orders.fetchMarketBatch(Array.from({ length: 50 }, (_, i) => `s${i}`));
  const acotados = new URL(peticiones.at(-1).url, "https://x").searchParams.get("slugs").split(",");
  assert.equal(acotados.length, 30);

  assert.deepEqual(await orders.fetchMarketBatch([]), {}, "lista vacía: ni se pide");

  rutas.clear();
  rutas.set("wfm_market_batch", () => respuesta(500));
  assert.deepEqual(await orders.fetchMarketBatch(["a"]), {});
});
