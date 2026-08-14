// Prefetch de precios del inventario: decide QUÉ slugs salen a la red y en cuántos lotes.
//
// Es una decisión invisible en pantalla y por eso se rompe sin que nadie se entere: pedir de
// más gasta cuota del worker (100k/día) y retrasa la pestaña; pedir de menos deja filas en
// "cargando" para siempre. Lo que se fija aquí es la lista de slugs de cada petición.

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

/** Los slugs de cada lote, en el orden en que se pidieron. */
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

/** Ejecuta el cuerpo sin llenar la salida de los tests con los avisos esperados. */
async function sinRuido(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try { await fn(); } finally { console.warn = warn; }
}

// Va primero a propósito: el snapshot solo se baja una vez por sesión, así que este es el
// único test que puede observar la relación entre el snapshot y los lotes.
test("lo que ya trae el snapshot de precios no se vuelve a pedir en lotes", async () => {
  // El snapshot cubre el catálogo prime entero en una petición cacheable en el edge, y se
  // espera ANTES de calcular la lista. Si alguien mueve ese await detrás del filtro, todo el
  // catálogo se vuelve a pedir en lotes de 25 con una clave de caché (el inventario del
  // usuario) que nunca acierta.
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

  // Sin el precio del set no se puede decir si compensa vender la pieza suelta.
  assert.ok(p.includes("ash_prime_set"), "Prime");
  assert.ok(p.includes("braton_vandal_set"), "Vandal");
  assert.ok(p.includes("latron_wraith_set"), "Wraith");

  // Forma no pertenece a ningún set: "forma_set" sería un slug que warframe.market no
  // conoce, o sea una consulta desperdiciada en cada arranque.
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
  // Con las piezas que faltan a la vista sí hacen falta sus precios: son justo las que el
  // usuario está decidiendo si comprar.
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

  // Lo que le falta al set es el dato que se enseña ("te faltan X y Y, cuestan Z"): limitarse
  // a lo que ya se tiene dejaría ese cálculo a medias.
  assert.ok(p.includes("mag_prime_neuroptics"), p.join());
  assert.ok(p.includes("mag_prime_chassis"), p.join());
  assert.ok(p.includes("mag_prime_set"), p.join());

  // Un set del que no se tiene nada no interesa todavía: incluirlos sería pedir el catálogo
  // prime completo en lotes, que es justo lo que evita el snapshot.
  assert.ok(!p.some((s) => s.startsWith("rhino")), p.join());
});

test("las recompensas de las reliquias que tienes también se tasan", async () => {
  reset();
  state.inventory = [{ name: "Lith A1" }, { name: "Axi Z9" }];
  state.relicsDatabase = {
    "Lith A1": [{ name: "Nikana Prime Blade" }, { name: "Forma Blueprint" }],
    // "Axi Z9" no está en la base: una reliquia recién salida del OCR no puede reventar el
    // prefetch entero y dejar sin precio también a las demás.
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
  // 60 piezas de armas distintas = 120 slugs (pieza + set), o sea 5 lotes.
  const esperados = new Set();
  for (let i = 0; i < 60; i++) {
    state.primeInventory[`Arma${i} Prime Barrel`] = 1;
    esperados.add(`arma${i}_prime_barrel`);
    esperados.add(`arma${i}_prime_set`);
  }

  await warmupPrices();
  const tamanos = lotes().map((c) => c.length);

  // El worker recorta con slice(0, 25): con lotes de 50 la segunda mitad se descartaba en
  // silencio y esos ítems se quedaban sin precio hasta pedirlos de uno en uno.
  assert.ok(tamanos.every((n) => n <= 25), `hay lotes de más de 25: ${tamanos.join()}`);
  assert.deepEqual(tamanos, [25, 25, 25, 25, 20]);
  assert.deepEqual(new Set(pedidos()), esperados);
});

test("un lote que falla no se lleva por delante a los siguientes", async () => {
  await sinRuido(async () => {
    reset();
    for (let i = 0; i < 30; i++) state.primeInventory[`Arma${i} Prime Barrel`] = 1;

    // Primero un corte de red, luego un 500: ni la excepción ni la respuesta mala pueden
    // abortar el bucle, o un fallo puntual dejaría sin precio a todo lo que venía detrás.
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
  // 0 significa "el worker no tiene dato", no "vale 0 platino". Cachearlo lo congelaba a 0
  // el resto de la sesión, y con él el valor del set entero.
  assert.equal(MEMORY_CACHE.has("mag_prime_set"), false);
  assert.equal(MEMORY_CACHE.has("volt_prime_set"), false);
});

test("sin nada que tasar no se genera ni un lote", async () => {
  reset();
  await warmupPrices();
  // Se miran los LOTES, no `urls`: warmupPrices siempre espera al snapshot, así que un usuario
  // nuevo sí hace esa petición (una, compartida y cacheable en el edge). Asertar `urls` vacío
  // solo pasaba porque un test anterior ya había memoizado el snapshot — verde por orden de
  // ejecución, no por lo que se quería comprobar.
  assert.deepEqual(lotes(), [], "sin inventario no hay nada que pedir en lotes");
});
