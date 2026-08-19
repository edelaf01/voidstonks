// price cache: MEMORY_CACHE -> IndexedDB -> snapshot -> batch queue, used by half the app (relics, sets,
// inventory, ducats)
// everything pinned here fails silently: more worker requests or a price "loading" forever
// node has no indexedDB and that is fine: dbHelper.get/set swallow the error and return null, so these
// tests walk the "no local cache" path of a first start

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

/** replaces the network and records what was requested */
const peticiones = [];
let respuestaLote = {};
let respuestaSnapshot = { p: {} };

globalThis.fetch = async (url) => {
  const u = String(url);
  peticiones.push(u);
  if (u.includes("type=prices_snapshot")) {
    return { ok: true, status: 200, json: async () => respuestaSnapshot };
  }
  if (u.includes("type=prices_batch")) {
    return { ok: true, status: 200, json: async () => respuestaLote };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const { MEMORY_CACHE, getPriceValue, ensurePriceSnapshot } = await import(
  "../deploy/js/repositories/storage.repository.js"
);

const lotesPedidos = () => peticiones.filter((u) => u.includes("type=prices_batch"));
const slugsDe = (url) => decodeURIComponent(url.split("q=")[1] || "").split(",").filter(Boolean);

// forma and kuva are not sold for platinum and always came back 0 after the full trip to the worker, so
// they are cut before touching anything
test("los ítems que no tienen precio se resuelven a 0 sin pedir nada", async () => {
  const antes = peticiones.length;
  const casos = [
    ["Forma Blueprint", "forma_blueprint"],
    ["Kuva", "kuva"],
    ["Riven Sliver", "riven_sliver"],
    ["Exilus Weapon Adapter Blueprint", "exilus_weapon_adapter_blueprint"],
  ];
  for (const [nombre, slug] of casos) {
    assert.equal(await getPriceValue(nombre, slug), 0, nombre);
  }
  assert.equal(await getPriceValue("", "algo"), 0);
  assert.equal(await getPriceValue("Algo", ""), 0);
  assert.equal(peticiones.length, antes, "ninguno debe generar tráfico");
});

test("un precio ya en memoria no vuelve a pedirse", async () => {
  MEMORY_CACHE.set("ash_prime_set", 120);
  const antes = peticiones.length;
  assert.equal(await getPriceValue("Ash Prime Set", "ash_prime_set"), 120);
  assert.equal(peticiones.length, antes);
});

// the snapshot carries the whole catalog's median; an entry already in memory comes from the user's IDB or
// wfm_live_prices, both more specific, so overwriting them would make the price worse when the tab loads
test("el snapshot rellena huecos pero no pisa lo que ya hay", async () => {
  MEMORY_CACHE.set("mag_prime_set", 999);
  respuestaSnapshot = { p: { mag_prime_set: 10, nyx_prime_set: 45 } };
  await ensurePriceSnapshot();

  assert.equal(MEMORY_CACHE.get("mag_prime_set"), 999, "no debe pisar el valor existente");
  assert.equal(MEMORY_CACHE.get("nyx_prime_set"), 45, "sí debe rellenar el que faltaba");
});

test("el snapshot se baja una sola vez por sesión", async () => {
  const antes = peticiones.filter((u) => u.includes("prices_snapshot")).length;
  await ensurePriceSnapshot();
  await ensurePriceSnapshot();
  assert.equal(peticiones.filter((u) => u.includes("prices_snapshot")).length, antes);
});

// two components painting the same item at once (every relic render) asked for the price separately;
// IN_FLIGHT_PROMISES makes them share the promise
test("dos peticiones simultáneas del mismo ítem comparten una sola promesa", async () => {
  respuestaLote = { volt_prime_set: 77 };
  const a = getPriceValue("Volt Prime Set", "volt_prime_set");
  const b = getPriceValue("Volt Prime Set", "volt_prime_set");
  assert.equal(a, b, "debe devolver literalmente la misma promesa");
  assert.equal(await a, 77);
});

// the batch url is the edge cache key: if slugs are not always in the same order, two clients asking the
// same create two entries and neither hits
test("los slugs del lote van en orden alfabético y en tandas de 25", async () => {
  MEMORY_CACHE.clear();
  respuestaSnapshot = { p: {} };
  const nombres = ["Zeta Prime Set", "Alfa Prime Set", "Media Prime Set"];
  const slugs = ["zeta_prime_set", "alfa_prime_set", "media_prime_set"];
  respuestaLote = Object.fromEntries(slugs.map((s) => [s, 5]));

  const antes = lotesPedidos().length;
  await Promise.all(nombres.map((n, i) => getPriceValue(n, slugs[i])));

  const nuevos = lotesPedidos().slice(antes);
  assert.ok(nuevos.length >= 1, "debe haberse pedido al menos un lote");
  const pedidos = slugsDe(nuevos[0]);
  assert.deepEqual(pedidos, [...pedidos].sort(), "los slugs deben ir ordenados");
  for (const url of nuevos) {
    assert.ok(slugsDe(url).length <= 25, "ningún lote puede pasar de 25 slugs");
  }
});

test("un lote grande se parte en tandas de 25 como mucho", async () => {
  MEMORY_CACHE.clear();
  const slugs = Array.from({ length: 60 }, (_, i) => `item_${String(i).padStart(3, "0")}_set`);
  respuestaLote = Object.fromEntries(slugs.map((s) => [s, 3]));

  const antes = lotesPedidos().length;
  await Promise.all(slugs.map((s) => getPriceValue(`Item ${s}`, s)));

  const nuevos = lotesPedidos().slice(antes);
  const total = nuevos.reduce((n, u) => n + slugsDe(u).length, 0);
  assert.equal(total, 60, "deben pedirse los 60 slugs");
  assert.ok(nuevos.length >= 3, `60 slugs necesitan >=3 tandas, hubo ${nuevos.length}`);
  for (const url of nuevos) assert.ok(slugsDe(url).length <= 25);
});

// without the retry cap, a slug the worker does not know stayed queued forever and its price stayed
// "loading"
test("un slug que el worker nunca devuelve acaba resolviendo 0, no se cuelga", async () => {
  MEMORY_CACHE.clear();
  respuestaLote = {}; // the worker answers OK but without that slug
  const precio = await getPriceValue("Fantasma Prime Set", "fantasma_prime_set");
  assert.equal(precio, 0);
});

test("un precio recibido queda cacheado en memoria para la siguiente vez", async () => {
  MEMORY_CACHE.clear();
  respuestaLote = { saryn_prime_set: 42 };
  await getPriceValue("Saryn Prime Set", "saryn_prime_set");
  assert.equal(MEMORY_CACHE.get("saryn_prime_set"), 42);

  const antes = lotesPedidos().length;
  assert.equal(await getPriceValue("Saryn Prime Set", "saryn_prime_set"), 42);
  assert.equal(lotesPedidos().length, antes, "la segunda vez sale de memoria");
});
