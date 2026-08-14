// Recomendaciones de sets según las fisuras activas: qué reliquia abrir ahora para completar
// un set que te falta.
//
// Todo lo que hay aquí falla en silencio. Una fisura mal mapeada no rompe nada: simplemente
// deja de recomendarse un set y nadie se entera. Y los números que sí se ven (runs estimadas,
// "mejor comprarlo") salen de reglas del juego que no se deducen leyendo el código.

import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const { MEMORY_CACHE } = await import("../deploy/js/repositories/storage.repository.js");
const {
  getFissureSetRecommendations,
  attachSetPrices,
  filterSetRecommendations,
  getSetRecsPrefs,
  saveSetRecsPrefs,
} = await import("../deploy/js/services/inventory/set_recommendations.service.js");

const fisura = (tier, node, type = "Survival") => ({ tier, node, type });

/** Escenario mínimo: un set de 2 piezas, una en el inventario y otra no. */
function escenario({ refinement = "Rad", playerCount = 4 } = {}) {
  state.setsDatabase = { "Mag Prime": ["Mag Prime Neuroptics", "Mag Prime Chassis"] };
  state.itemsDatabase = {
    "Mag Prime Neuroptics": [{ tier: "Lith", ducats: 15, rarity: "Common", chance: 25.33 }],
    "Mag Prime Chassis": [{ tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 }],
  };
  state.primeInventory = { "Mag Prime Neuroptics": 1 };
  state.refinement = refinement;
  state.playerCount = playerCount;
}

test("solo se recomiendan sets a los que les falta alguna pieza", () => {
  escenario();
  const recs = getFissureSetRecommendations([fisura("Axi", "Xini")]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].setName, "Mag Prime");
  assert.deepEqual(recs[0].missingParts, ["Mag Prime Chassis"]);
  assert.equal(recs[0].totalParts, 2);

  // Con el set completo no hay nada que recomendar.
  state.primeInventory = { "Mag Prime Neuroptics": 1, "Mag Prime Chassis": 1 };
  assert.deepEqual(getFissureSetRecommendations([fisura("Axi", "Xini")]), []);
});

// Regla del juego: las fisuras Vanguard son de la era Axi. Sin el mapeo, un jugador con una
// Vanguard activa no ve ninguna recomendación de Axi y parece que no hay nada que farmear.
test("una fisura Vanguard cuenta como Axi", () => {
  escenario();
  const recs = getFissureSetRecommendations([fisura("Vanguard", "Hepit")]);
  assert.equal(recs.length, 1, "Vanguard debe casar con las fuentes Axi");
  assert.equal(recs[0].matches[0].fissures[0].tier, "Vanguard", "se devuelve la fisura original");
});

test("una fisura de otra era no recomienda nada", () => {
  escenario();
  assert.deepEqual(getFissureSetRecommendations([fisura("Meso", "Io")]), []);
});

// Una pieza puede caer de varias reliquias de la misma era. Sin deduplicar por nodo+tipo, la
// misma fisura aparecía repetida tantas veces como reliquias la dropeaban.
test("la misma fisura no se lista dos veces aunque la pieza salga de varias reliquias", () => {
  escenario();
  state.itemsDatabase["Mag Prime Chassis"] = [
    { tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 },
    { tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 },
    { tier: "Vanguard", ducats: 100, rarity: "Rare", chance: 2 },
  ];
  const recs = getFissureSetRecommendations([fisura("Axi", "Xini", "Survival")]);
  assert.equal(recs[0].matches[0].fissures.length, 1);
});

test("el mismo nodo con dos tipos de misión sí son dos fisuras", () => {
  escenario();
  const recs = getFissureSetRecommendations([
    fisura("Axi", "Xini", "Survival"),
    fisura("Axi", "Xini", "Defense"),
  ]);
  assert.equal(recs[0].matches[0].fissures.length, 2);
});

// El número que se enseña tiene que ser el del jugador que lo lee: en solitario y con
// reliquias intactas la estimación se va al triple frente a "radiante y escuadra de 4".
test("las runs estimadas usan TU refinamiento y TU escuadra", () => {
  escenario({ refinement: "Rad", playerCount: 4 });
  const conEscuadra = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;

  escenario({ refinement: "Intact", playerCount: 1 });
  const soloIntacta = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;

  assert.ok(soloIntacta > conEscuadra * 2,
    `en solitario e intacta deben ser muchas más runs (${soloIntacta} vs ${conEscuadra})`);
});

test("una escuadra fuera de rango se acota a 1..4", () => {
  escenario({ playerCount: 99 });
  const a = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;
  escenario({ playerCount: 4 });
  const b = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;
  assert.equal(a, b, "99 jugadores no puede dar mejor resultado que 4");
});

test("los sets a los que menos falta salen primero", () => {
  state.setsDatabase = {
    "Casi Completo": ["a1", "a2", "a3"],
    "Recién Empezado": ["b1", "b2", "b3"],
  };
  state.itemsDatabase = {
    a3: [{ tier: "Axi", ducats: 15 }],
    b1: [{ tier: "Axi", ducats: 15 }],
    b2: [{ tier: "Axi", ducats: 15 }],
    b3: [{ tier: "Axi", ducats: 15 }],
  };
  state.primeInventory = { a1: 1, a2: 1 };
  state.refinement = "Rad";
  state.playerCount = 4;

  const recs = getFissureSetRecommendations([fisura("Axi", "Xini")]);
  assert.deepEqual(recs.map((r) => r.setName), ["Casi Completo", "Recién Empezado"]);
});

test("sin fisuras activas o sin bases de datos no se inventa nada", () => {
  escenario();
  assert.deepEqual(getFissureSetRecommendations([]), []);
  assert.deepEqual(getFissureSetRecommendations(null), []);
  state.setsDatabase = null;
  assert.deepEqual(getFissureSetRecommendations([fisura("Axi", "Xini")]), []);
});

// "Mejor comprarlo" solo si la pieza suelta cuesta <= 15 % del set completo. Ese corte es lo
// que separa un consejo útil de decirle al usuario que compre a cualquier precio.
test("una pieza barata frente al set se marca como mejor comprarla", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 10); // 10 % del set

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].setPricePlat, 100);
  assert.equal(recs[0].matches[0].buyPricePlat, 10);
  assert.equal(recs[0].matches[0].betterToBuy, true);
});

test("una pieza cara frente al set NO se marca como mejor comprarla", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 40); // 40 % del set

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].matches[0].betterToBuy, false);
});

test("sin precio conocido no se recomienda comprar", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 0);

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].matches[0].betterToBuy, false);
});

test("el filtro por piezas restantes y por 'solo comprar' acota la lista", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 10);
  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));

  assert.equal(filterSetRecommendations(recs, { maxMissing: 1, buyOnly: false }).length, 1);
  assert.equal(filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false }).length, 1,
    "maxMissing 0 significa sin límite");
  assert.equal(filterSetRecommendations(recs, { maxMissing: 1, buyOnly: true }).length, 1);

  MEMORY_CACHE.set("mag_prime_chassis", 40);
  const caros = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(filterSetRecommendations(caros, { maxMissing: 0, buyOnly: true }).length, 0,
    "con buyOnly, un set sin piezas que compense desaparece");
});

// Las preferencias vienen de localStorage, o sea de fuera: un valor corrupto no puede dejar
// el panel sin recomendaciones ni petar al abrir la pestaña.
test("unas preferencias corruptas caen a los valores por defecto", () => {
  const porDefecto = { maxMissing: 0, buyOnly: false };
  for (const basura of ["{no es json", '{"maxMissing":"tres"}', '{"buyOnly":"sí"}', "null"]) {
    almacen.set("vs_fissure_set_recs_prefs", basura);
    assert.deepEqual(getSetRecsPrefs(), porDefecto, basura);
  }
  almacen.delete("vs_fissure_set_recs_prefs");
  assert.deepEqual(getSetRecsPrefs(), porDefecto);
});

test("las preferencias válidas se guardan y se releen", () => {
  saveSetRecsPrefs({ maxMissing: 2, buyOnly: true });
  assert.deepEqual(getSetRecsPrefs(), { maxMissing: 2, buyOnly: true });
});
