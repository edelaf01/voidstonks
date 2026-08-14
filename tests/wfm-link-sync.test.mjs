// Cruce entre el inventario local y lo publicado en warframe.market.
//
// Es la función con la consecuencia más cara del repo: lo que sale en `stale` es lo que la UI
// ofrece **retirar**. Un falso positivo ahí no es un pixel mal puesto — es una orden buena
// borrada de la cuenta del usuario, y no hay deshacer.

import { test } from "node:test";
import assert from "node:assert/strict";

const sesion = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sesion.has(k) ? sesion.get(k) : null),
  setItem: (k, v) => sesion.set(k, String(v)),
  removeItem: (k) => sesion.delete(k),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");

const llamadas = [];
let responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
globalThis.fetch = async (url, init) => {
  llamadas.push({ url: String(url), init });
  return responder(String(url), init);
};

const { state } = await import("../deploy/js/state.js");
const link = await import("../deploy/js/services/market/wfm_link.service.js");

function jwtValido() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor((Date.now() + 3600_000) / 1000) })}.f`;
}

function conSesion() {
  sesion.clear();
  sesion.set("wfm_jwt", jwtValido());
  sesion.set("wfm_exp", String(Date.now() + 3600_000));
}

/** Inventario con los sets indicados completos. */
function inventario(sets) {
  state.setsDatabase = {};
  state.primeInventory = {};
  state.itemsDatabase = {};
  for (const [nombre, piezas] of Object.entries(sets)) {
    state.setsDatabase[nombre] = piezas.lista;
    for (const p of piezas.lista) state.primeInventory[p] = piezas.cantidad;
  }
}

const orden = (slug, extra = {}) => ({
  id: `o-${slug}`, type: "sell", itemSlug: slug, itemName: slug, ...extra,
});

test("lo vendible sale del inventario con su slug de warframe.market", () => {
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint", "Mag Prime Chassis"], cantidad: 1 } });
  const vendible = link.collectSellable();
  assert.equal(vendible.length, 1);
  assert.equal(vendible[0].slug, "mag_prime_set");
  assert.equal(vendible[0].source, "primeSets");
});

test("un set incompleto no se ofrece para vender", () => {
  state.setsDatabase = { "Mag Prime": ["Mag Prime Blueprint", "Mag Prime Chassis"] };
  state.primeInventory = { "Mag Prime Blueprint": 1 }; // falta el chassis
  state.itemsDatabase = {};
  assert.deepEqual(link.collectSellable(), []);
});

test("el cruce separa lo que tienes sin publicar de lo que ya está en venta", async () => {
  conSesion();
  inventario({
    "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 },
    "Ash Prime": { lista: ["Ash Prime Blueprint"], cantidad: 1 },
  });

  const r = await link.syncInventory([orden("mag_prime_set")]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.listed.map((i) => i.slug), ["mag_prime_set"]);
  assert.deepEqual(r.unlisted.map((i) => i.slug), ["ash_prime_set"]);
  assert.ok(r.listed[0].order, "lo publicado viene con su orden para poder editarla");
});

// Una orden de compra no significa que tengas el ítem: contarla lo marcaría como publicado y
// nunca aparecería para vender.
test("las órdenes de compra no cuentan como publicado", async () => {
  conSesion();
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 } });

  const r = await link.syncInventory([orden("mag_prime_set", { type: "buy" })]);
  assert.deepEqual(r.unlisted.map((i) => i.slug), ["mag_prime_set"]);
  assert.deepEqual(r.listed, []);
});

// El caso caro. `stale` alimenta el botón de retirar: si mete algo que el inventario
// simplemente no sigue (un mod, un arcano), el usuario borra órdenes buenas.
test("solo se marca obsoleto lo que alguna fuente reconoce como suyo", async () => {
  conSesion();
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 } });

  const r = await link.syncInventory([
    orden("mag_prime_set"),
    orden("ash_prime_set"), // set que ya no tienes -> obsoleto de verdad
    orden("serration"), // un mod: el inventario no sigue mods, no es obsoleto
    orden("magus_elevate"), // un arcano: igual
  ]);

  assert.deepEqual(r.stale.map((s) => s.slug), ["ash_prime_set"],
    `marcó de más: ${r.stale.map((s) => s.slug).join()}`);
});

test("sin sesión ni órdenes pasadas, el cruce falla en vez de decir que no tienes nada", async () => {
  sesion.clear();
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 } });
  const r = await link.syncInventory();
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_token");
  assert.equal(r.stale, undefined, "un fallo no puede sugerir retirar nada");
});

// Quien pinta la pestaña acaba de pedir las órdenes; volver a pedirlas aquí duplicaba la
// llamada a wfm_my_orders Y la de resolución de nombres, que con ~76 ítems no es barata.
test("si le pasan las órdenes, no las vuelve a pedir", async () => {
  conSesion();
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 } });
  llamadas.length = 0;

  await link.syncInventory([orden("mag_prime_set")]);
  assert.equal(llamadas.length, 0, "no debe salir a la red");
});

test("el badge de 'ya en venta' queda disponible sin pedir nada más", async () => {
  conSesion();
  inventario({ "Mag Prime": { lista: ["Mag Prime Blueprint"], cantidad: 1 } });
  await link.syncInventory([orden("mag_prime_set")]);

  assert.equal(link.isListed("mag_prime_set"), true);
  assert.equal(link.isListed("ash_prime_set"), false);
  assert.equal(link.hasSyncData(), true);
});

// --- Publicar una orden ------------------------------------------------------------------

test("publicar valida precio y sesión antes de tocar la red", async () => {
  llamadas.length = 0;
  sesion.clear();
  assert.deepEqual(await link.createSellOrder({ itemId: "abc", platinum: 10 }),
    { ok: false, error: "no_token" });

  conSesion();
  assert.deepEqual(await link.createSellOrder({ platinum: 10 }), { ok: false, error: "no_item" });

  // Un precio no entero o menor que 1 lo rechaza WFM: mejor no gastar la petición.
  for (const malo of [0, -5, 1.5, "diez", null, undefined]) {
    assert.deepEqual(await link.createSellOrder({ itemId: "abc", platinum: malo }),
      { ok: false, error: "bad_price" }, String(malo));
  }
  assert.equal(llamadas.length, 0, "ninguna validación debe generar tráfico");
});

test("publicar manda el token, el tipo sell y la plataforma de la sesión", async () => {
  conSesion();
  sesion.set("wfm_platform", "ps4");
  llamadas.length = 0;
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  const r = await link.createSellOrder({ itemId: "abc123", platinum: 25, quantity: 2, slug: "x_set" });
  assert.deepEqual(r, { ok: true });

  const p = llamadas.at(-1);
  assert.match(p.url, /type=wfm_order_create/);
  assert.equal(p.init.method, "POST");
  assert.ok(p.init.headers["X-WFM-Token"]);
  assert.deepEqual(JSON.parse(p.init.body), {
    itemId: "abc123", type: "sell", platinum: 25, quantity: 2, platform: "ps4",
  });
});

// Sin esto el badge del inventario seguiría diciendo "sin publicar" hasta el siguiente cruce
// completo, y el usuario publicaría dos veces el mismo set.
test("publicar refleja el badge al momento, sin esperar a otro cruce", async () => {
  conSesion();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  assert.equal(link.isListed("nuevo_set"), false);
  await link.createSellOrder({ itemId: "abc", platinum: 10, slug: "nuevo_set" });
  assert.equal(link.isListed("nuevo_set"), true);
});

test("el rango solo viaja si es un entero: no todos los ítems lo tienen", async () => {
  conSesion();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  await link.createSellOrder({ itemId: "abc", platinum: 10, rank: 0 });
  assert.equal(JSON.parse(llamadas.at(-1).init.body).rank, 0, "rango 0 es un rango válido");

  await link.createSellOrder({ itemId: "abc", platinum: 10 });
  assert.equal("rank" in JSON.parse(llamadas.at(-1).init.body), false);
});

test("publicar distingue no autorizado, error de servidor y caída de red", async () => {
  conSesion();
  for (const [status, error] of [[403, "unauthorized"], [401, "unauthorized"], [500, "server"]]) {
    responder = async () => ({ ok: false, status, json: async () => ({}) });
    assert.deepEqual(await link.createSellOrder({ itemId: "a", platinum: 1 }), { ok: false, error });
  }
  responder = async () => { throw new Error("sin red"); };
  assert.deepEqual(await link.createSellOrder({ itemId: "a", platinum: 1 }),
    { ok: false, error: "network" });
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

// --- Resolución de ids -------------------------------------------------------------------

test("los ids se resuelven en tandas de 25 y sin duplicados", async () => {
  llamadas.length = 0;
  responder = async (url) => {
    const slugs = new URL(url, "https://x").searchParams.get("slugs").split(",");
    return { ok: true, status: 200, json: async () => Object.fromEntries(slugs.map((s) => [s, { id: s }])) };
  };

  const slugs = Array.from({ length: 60 }, (_, i) => `s${String(i).padStart(3, "0")}_set`);
  const out = await link.resolveIds([...slugs, ...slugs, null, ""]);

  const tandas = llamadas.filter((p) => p.url.includes("wfm_ids"));
  assert.ok(tandas.length >= 3, `60 slugs necesitan >=3 tandas, hubo ${tandas.length}`);
  for (const p of tandas) {
    const n = new URL(p.url, "https://x").searchParams.get("slugs").split(",").length;
    assert.ok(n <= 25, `una tanda llevaba ${n}`);
  }
  assert.equal(Object.keys(out).length, 60, "sin duplicados ni vacíos");
});

// Una tanda que falle solo deja sin id a sus slugs: su botón sale deshabilitado, pero los demás
// se pueden publicar igual.
test("una tanda que falla no se lleva por delante a las demás", async () => {
  llamadas.length = 0;
  let n = 0;
  responder = async (url) => {
    if (n++ === 0) return { ok: false, status: 500, json: async () => ({}) };
    const slugs = new URL(url, "https://x").searchParams.get("slugs").split(",");
    return { ok: true, status: 200, json: async () => Object.fromEntries(slugs.map((s) => [s, { id: s }])) };
  };

  const out = await link.resolveIds(Array.from({ length: 50 }, (_, i) => `s${i}_set`));
  assert.ok(Object.keys(out).length > 0, "las tandas buenas deben sobrevivir");
  assert.ok(Object.keys(out).length < 50, "y las de la tanda caída faltar");
});

test("sin slugs no se pide nada", async () => {
  llamadas.length = 0;
  assert.deepEqual(await link.resolveIds([]), {});
  assert.deepEqual(await link.resolveIds([null, ""]), {});
  assert.equal(llamadas.length, 0);
});
