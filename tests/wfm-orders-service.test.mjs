// warframe.market orders: reading, editing, and enriching with name and icon
// the write path to the user's account whose typical failure mode is not an exception, but an empty or
// partial list looking like "no orders"
// pins the choices preventing silent errors: v2 response shapes, chunking to avoid worker 500s, and
// graceful degradation on partial failures

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

/** response router: each test declares what each endpoint returns */
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

// slug always travels even with a token: if the JWT does not authorize v2, the worker falls back to public
// profile orders seamlessly; without the slug, that fallback is impossible
test("el slug viaja aunque haya token, para que el worker pueda caer a lo público", async () => {
  reset();
  conSesion();
  rutas.set("wfm_my_orders", () => respuesta(200, { data: [] }));

  await orders.fetchMyOrders();
  const p = peticiones.find((x) => x.url.includes("wfm_my_orders"));
  assert.match(p.url, /user=tenno/);
  assert.ok(p.init.headers["X-WFM-Token"], "y el token también");
});

// WFM v2 returns data as an array or as {sell, buy} depending on the worker endpoint: handling only one
// leaves the list empty with no visible error
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

// actual scope is only known when USING the token: re-evaluating on each load lets a session marked
// "public" upgrade to "full" (e.g. after deploying a worker fix) without reconnecting
test("el scope servido por el worker se guarda en cada carga", async () => {
  reset();
  conSesion();
  auth.cacheScope("public");
  assert.equal(auth.getScope(), "public");

  rutas.set("wfm_my_orders", () => respuesta(200, { data: [] }, { "X-WFM-Scope": "full" }));
  await orders.fetchMyOrders();
  assert.equal(auth.getScope(), "full", "debe corregirse sin reloguear");
});

// 76 ids in a single request returned 500: the worker exceeded Cloudflare's subrequest limit by writing to
// cache once per item
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

// without names the list is ugly, without a list there is nothing: name resolution is cosmetic and must
// not break loading
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

// the order list remains useful without market context, so the batch degrades to {} instead of throwing
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

// reviewing prices needs real market data: Cloudflare serves cached data with 5 h max-age
test("el mercado de todos se repite con lo que el worker dejó pendiente, y el fresco se salta las cachés", async () => {
  reset();
  const servidos = new Set();
  rutas.set("wfm_market_batch", (u) => {
    // worker resolves 9 uncached per request; here, 2
    const pedidos = new URL(u, "https://x").searchParams.get("slugs").split(",");
    const nuevos = pedidos.filter((s) => !servidos.has(s)).slice(0, 2);
    nuevos.forEach((s) => servidos.add(s));
    return respuesta(200, Object.fromEntries(pedidos.filter((s) => servidos.has(s)).map((s) => [s, { median: 1 }])));
  });
  const progreso = [];
  const r = await orders.mercadoDeTodos(["a", "b", "c", "d", "e"], { fresco: true, esperaMs: 0, onProgreso: ({ hechos, total }) => progreso.push(`${hechos}/${total}`) });
  assert.deepEqual(Object.keys(r).sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(progreso, ["2/5", "4/5", "5/5"]);
  const ultima = peticiones.at(-1);
  assert.match(ultima.url, /&_cb=\d+/);
  assert.equal(ultima.init?.cache, "no-cache");
  assert.deepEqual(new URL(ultima.url, "https://x").searchParams.get("slugs").split(","), ["e"], "solo lo que faltaba");

  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  assert.deepEqual(await orders.mercadoDeTodos(["a"], { rondas: 3, esperaMs: 0 }), {});
  assert.equal(peticiones.filter((p) => p.url.includes("wfm_market_batch")).length, 1, "una ronda sin nada nuevo no se repite");
  assert.ok(!peticiones.at(-1).url.includes("_cb") && !peticiones.at(-1).init?.cache, "la lista sí aprovecha las cachés");
});

test("sin nada nuevo se pide una vez por tanda de 30 y se para", async () => {
  reset();
  rutas.set("wfm_market_batch", () => respuesta(200, {}));
  const slugs = Array.from({ length: 35 }, (_, i) => `s${i}`);
  assert.deepEqual(await orders.mercadoDeTodos(slugs, { esperaMs: 0 }), {});
  assert.equal(peticiones.filter((p) => p.url.includes("wfm_market_batch")).length, 2);
});

test("lo visto en la última hora no se vuelve a pedir a warframe.market; revisar precios sí va a la red", async () => {
  reset();
  const local = new Map();
  const orig = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) };
  rutas.set("wfm_market_batch", (u) => {
    const slugs = new URL(u, "https://x").searchParams.get("slugs").split(",");
    return respuesta(200, Object.fromEntries(slugs.map((s) => [s, { median: 7 }])));
  });
  try {
    await orders.fetchMarketBatch(["a", "b"]);
    assert.deepEqual(await orders.fetchMarketBatch(["a", "b"]), { a: { median: 7 }, b: { median: 7 } });
    assert.equal(peticiones.length, 1, "recargar la pestaña no pide nada");
    await orders.fetchMarketBatch(["a", "c"]);
    assert.deepEqual(new URL(peticiones.at(-1).url, "https://x").searchParams.get("slugs").split(","), ["c"], "solo lo que falta");
    await orders.fetchMarketBatch(["a"], { fresco: true });
    assert.equal(peticiones.length, 3);
  } finally { globalThis.localStorage = orig; }
});

// each order load resolved all ids again, and a cache miss in the worker downloads the 1.4 MB catalog
test("id, slug y nombre se guardan una semana y al worker solo va lo que falta", async () => {
  const local = new Map();
  const orig = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) };
  const pedidos = [];
  const pide = async (claves) => { pedidos.push(claves); return Object.fromEntries(claves.filter((c) => c !== "raro").map((c) => [c, { slug: c }])); };
  try {
    const t0 = Date.parse("2026-09-27T10:00:00Z");
    assert.deepEqual(await orders.conCatalogoLocal("id", ["a", "b", "raro"], pide, t0), { a: { slug: "a" }, b: { slug: "b" } });
    assert.deepEqual(await orders.conCatalogoLocal("id", ["a", "c"], pide, t0 + 3600000), { a: { slug: "a" }, c: { slug: "c" } });
    assert.deepEqual(pedidos, [["a", "b", "raro"], ["c"]], "lo que el catálogo no conoce se vuelve a preguntar; lo conocido no");
    await orders.conCatalogoLocal("slug", ["a"], pide, t0 + 3600000);
    assert.deepEqual(pedidos.at(-1), ["a"], "ids y slugs no se mezclan");
    await orders.conCatalogoLocal("id", ["b"], pide, t0 + 8 * 86400000);
    assert.deepEqual(pedidos.at(-1), ["b"], "pasada una semana se refresca");
    globalThis.localStorage = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } };
    assert.deepEqual(await orders.conCatalogoLocal("id", ["a"], pide, t0), { a: { slug: "a" } }, "sin almacenamiento se pide a la red");
  } finally { globalThis.localStorage = orig; }
});
