// inventory price prefetch: which slugs go to the network and in how many batches
// asking too much burns worker quota and delays the tab, too little leaves rows loading forever

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const urls = [];
let snapshot = { p: {} };
let preciosLote = {};

const loteOk = () => ({ ok: true, status: 200, json: async () => preciosLote });
let respondeLote = loteOk;
let nLote = 0;

globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(u);
  if (u.includes("type=prices_snapshot")) {
    return { ok: true, status: 200, json: async () => snapshot };
  }
  if (u.includes("type=prices_batch")) return respondeLote(nLote++);
  return { ok: false, status: 404, json: async () => ({}) };
};

const { state } = await import("../deploy/js/state.js");
const { MEMORY_CACHE } = await import("../deploy/js/repositories/storage.repository.js");
const { warmupPrices } = await import("../deploy/js/services/inventory/inventory.service.js");

/** slugs of each batch, in request order */
const lotes = () =>
  urls
    .filter((u) => u.includes("type=prices_batch"))
    .map((u) => decodeURIComponent(u.split("q=")[1] || "").split(",").filter(Boolean));

const pedidos = () => lotes().flat();

function reset() {
  urls.length = 0;
  nLote = 0;
  respondeLote = loteOk;
  preciosLote = {};
  MEMORY_CACHE.clear();
  state.primeInventory = {};
  state.inventory = [];
  state.relicsDatabase = {};
  state.setsDatabase = null;
  state.settings = undefined;
}

/** runs fn without the expected warnings flooding the test output */
async function sinRuido(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try { await fn(); } finally { console.warn = warn; }
}

// runs first on purpose: the snapshot is fetched once per session, so only this test sees it next to the
// batches
test("lo que ya trae el snapshot de precios no se vuelve a pedir en lotes", async () => {
  // the snapshot must be awaited before the list is built; awaiting it after the filter refetches the whole
  // catalog in batches of 25 under a cache key that never hits
  snapshot = { p: { ash_prime_set: 120 } };
  state.primeInventory = { "Ash Prime Neuroptics Blueprint": 2 };

  await warmupPrices();

  assert.deepEqual(pedidos(), ["ash_prime_neuroptics_blueprint"]);
  assert.equal(MEMORY_CACHE.get("ash_prime_set"), 120);
});

test("cada pieza suelta arrastra el precio de su set", async () => {
  reset();
  state.primeInventory = {
    "Ash Prime Neuroptics Blueprint": 1,
    "Braton Vandal Stock": 1,
    "Latron Wraith Receiver": 1,
    "Forma Blueprint": 3,
  };

  await warmupPrices();
  const p = pedidos();

  assert.ok(p.includes("ash_prime_set"), "Prime");
  assert.ok(p.includes("braton_vandal_set"), "Vandal");
  assert.ok(p.includes("latron_wraith_set"), "Wraith");

  // forma belongs to no set: "forma_set" is a slug warframe.market does not know
  assert.ok(!p.some((s) => s.startsWith("forma") && s.endsWith("_set")), p.join());
  assert.ok(p.includes("forma_blueprint"));
});

test("una pieza a 0 no se consulta salvo que se muestren los huecos", async () => {
  reset();
  state.primeInventory = { "Volt Prime Chassis": 0 };
  await warmupPrices();
  assert.deepEqual(pedidos(), [], "un inventario lleno de ceros pediría medio catálogo");

  reset();
  state.primeInventory = { "Volt Prime Chassis": 0 };
  state.settings = { showEmptyPrime: true };
  await warmupPrices();
  assert.deepEqual(pedidos().sort(), ["volt_prime_chassis", "volt_prime_set"]);
});

test("tener una sola pieza de un set pide el precio de todas las demás", async () => {
  reset();
  state.primeInventory = { "Mag Prime Blueprint": 1 };
  state.setsDatabase = {
    "Mag Prime": ["Mag Prime Blueprint", "Mag Prime Neuroptics", "Mag Prime Chassis"],
    "Rhino Prime": ["Rhino Prime Blueprint", "Rhino Prime Systems"],
  };

  await warmupPrices();
  const p = pedidos();

  assert.ok(p.includes("mag_prime_neuroptics"), p.join());
  assert.ok(p.includes("mag_prime_chassis"), p.join());
  assert.ok(p.includes("mag_prime_set"), p.join());

  // sets with nothing owned stay out, or the whole prime catalog would go out in batches
  assert.ok(!p.some((s) => s.startsWith("rhino")), p.join());
});

test("las recompensas de las reliquias que tienes también se tasan", async () => {
  reset();
  state.inventory = [{ name: "Lith A1" }, { name: "Axi Z9" }];
  state.relicsDatabase = {
    "Lith A1": [{ name: "Nikana Prime Blade" }, { name: "Forma Blueprint" }],
    // "Axi Z9" is not in the db: a bad ocr read must not break the prefetch for the rest
  };

  await warmupPrices();

  assert.deepEqual(pedidos().sort(), ["forma_blueprint", "nikana_prime_blade"]);
});

test("el mismo ítem por dos caminos se pide una sola vez", async () => {
  reset();
  state.primeInventory = { "Mag Prime Blueprint": 1 };
  state.setsDatabase = { "Mag Prime": ["Mag Prime Blueprint"] };
  state.inventory = [{ name: "Lith M1" }];
  state.relicsDatabase = { "Lith M1": [{ name: "Mag Prime Blueprint" }] };

  await warmupPrices();
  const p = pedidos();

  assert.equal(new Set(p).size, p.length, `slugs repetidos: ${p.join()}`);
  assert.deepEqual(p.sort(), ["mag_prime_blueprint", "mag_prime_set"]);
});

test("los lotes van de 25 y ninguno pierde slugs por el camino", async () => {
  reset();
  // 60 parts of different weapons = 120 slugs (part + set), 5 batches
  const esperados = new Set();
  for (let i = 0; i < 60; i++) {
    state.primeInventory[`Arma${i} Prime Barrel`] = 1;
    esperados.add(`arma${i}_prime_barrel`);
    esperados.add(`arma${i}_prime_set`);
  }

  await warmupPrices();
  const tamanos = lotes().map((c) => c.length);

  // the worker cuts with slice(0, 25): larger batches lost their second half silently
  assert.ok(tamanos.every((n) => n <= 25), `hay lotes de más de 25: ${tamanos.join()}`);
  assert.deepEqual(tamanos, [25, 25, 25, 25, 20]);
  assert.deepEqual(new Set(pedidos()), esperados);
});

test("un lote que falla no se lleva por delante a los siguientes", async () => {
  await sinRuido(async () => {
    reset();
    for (let i = 0; i < 30; i++) state.primeInventory[`Arma${i} Prime Barrel`] = 1;

    // a network error, then a 500: neither may abort the loop
    respondeLote = (n) => {
      if (n === 0) throw new Error("red caída");
      if (n === 1) return { ok: false, status: 500, json: async () => ({}) };
      return loteOk();
    };

    await warmupPrices();

    assert.equal(lotes().length, 3, "los tres lotes deben intentarse");
  });
});

test("un precio de 0 no se guarda en la caché", async () => {
  reset();
  state.primeInventory = { "Volt Prime Chassis": 1, "Mag Prime Set": 1 };
  preciosLote = { volt_prime_chassis: 12, mag_prime_set: 0, volt_prime_set: -3 };

  await warmupPrices();

  assert.equal(MEMORY_CACHE.get("volt_prime_chassis"), 12);
  // 0 means "no data", not "worth 0": caching it froze the price and its set at 0 for the session
  assert.equal(MEMORY_CACHE.has("mag_prime_set"), false);
  assert.equal(MEMORY_CACHE.has("volt_prime_set"), false);
});

test("sin nada que tasar no se genera ni un lote", async () => {
  reset();
  await warmupPrices();
  // checks the batches, not `urls`: warmupPrices always waits for the snapshot, so an empty `urls` only held
  // because an earlier test had memoized it
  assert.deepEqual(lotes(), [], "sin inventario no hay nada que pedir en lotes");
});
