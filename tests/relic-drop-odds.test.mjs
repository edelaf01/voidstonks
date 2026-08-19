// relic drop odds: how many runs a part takes
// a silent failure: a wrong factor breaks nothing on screen, only changing a number nobody can eyeball
// these estimates feed the set tracker to decide whether to farm or buy

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { state } = await import("../deploy/js/state.js");
const { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } = await import(
  "../deploy/js/utils/inventory/relic_drop_odds.utils.js"
);

/** seeds itemsDatabase for the case and returns the part name */
function conDrops(nombre, drops) {
  state.itemsDatabase = { [nombre]: drops };
  return nombre;
}

// "uncommon".includes("common") is true, so checking common first classified EVERY uncommon part as
// common, using the wrong rates (radiant 0.1667 instead of 0.20) and estimating more runs than real
test("una pieza Uncommon no se clasifica como Common", () => {
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Uncommon", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "UNCOMMON", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Common", chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Rare", chance: 2 }])), "rare");
});

// without a rarity field it is inferred from the odds: cutoffs (17 and 5) are calibrated on INTACT rates,
// the only state stored in the db (common 25.33, uncommon 11, rare 2)
test("sin rarity, la rareza se deduce de la probabilidad intacta", () => {
  assert.equal(getPartRarity(conDrops("p", [{ chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 2 }])), "rare");
});

// the API sends odds as a fraction (0.11) or percentage (11): anything <= 1 is treated as a fraction
test("una probabilidad <= 1 se interpreta como fracción, no como 1 %", () => {
  assert.equal(getPartRarity(conDrops("p", [{ chance: 0.2533 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 0.11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 0.02 }])), "rare");
});

test("sin datos de drop se cae a los ducados, y en último término a común", () => {
  assert.equal(getPartRarity(conDrops("p", [{ ducats: 15 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ ducats: 45 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ ducats: 100 }])), "rare");
  assert.equal(getPartRarity(conDrops("p", [])), "common");
  state.itemsDatabase = {};
  assert.equal(getPartRarity("noExiste"), "common");
});

// squad formula: with 4 players opening the same relic, the part drops if ANY player gets it; multiplying
// by squad size or using 1-p^n gives plausible but wrong numbers
test("la probabilidad de escuadrón es 1-(1-p)^n, no p*n", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  const pSingle = DROP_RATES_BY_RARITY.rare.radiant; // 0.10
  // for a single player the formula reduces to 1/p, but is compared with tolerance: 1-(1-p)^1 gives
  // 10.000000000000002 in floating point, not 10
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  casi(calculatePartExpectedRuns(p, "radiant", 1), 1 / pSingle);
  casi(calculatePartExpectedRuns(p, "radiant", 4), 1 / (1 - (1 - pSingle) ** 4));

  // more players must never result in more runs
  const runs = [1, 2, 3, 4].map((n) => calculatePartExpectedRuns(p, "radiant", n));
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i] < runs[i - 1], `con ${i + 1} jugadores deberían bajar las runs`);
  }
});

test("refinar de intacta a radiante siempre reduce las runs de una pieza rara", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  const orden = ["intact", "exceptional", "flawless", "radiant"];
  const runs = orden.map((r) => calculatePartExpectedRuns(p, r, 4));
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i] < runs[i - 1], `${orden[i]} debería costar menos runs que ${orden[i - 1]}`);
  }
});

// commons are counter-intuitive: refining LOWERS their drop rate (0.2533 intact -> 0.1667 radiant),
// shifting weight toward rares
test("en las comunes, refinar sube las runs: es así en el juego", () => {
  const p = conDrops("p", [{ rarity: "Common", chance: 25.33 }]);
  assert.ok(
    calculatePartExpectedRuns(p, "radiant", 4) > calculatePartExpectedRuns(p, "intact", 4),
    "una común cuesta MÁS runs en radiante que en intacta",
  );
});

test("un escuadrón de 0 no divide por cero: devuelve Infinity", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  assert.equal(calculatePartExpectedRuns(p, "radiant", 0), Infinity);
});

const { runsForRarity, normalizeRarity, getPlayerOdds } = await import(
  "../deploy/js/utils/inventory/relic_drop_odds.utils.js"
);

test("normalizeRarity cae en la misma trampa que getPartRarity y la esquiva", () => {
  assert.equal(normalizeRarity("Uncommon"), "uncommon");
  assert.equal(normalizeRarity("VERY UNCOMMON"), "uncommon");
  assert.equal(normalizeRarity("Common"), "common");
  assert.equal(normalizeRarity("Rare"), "rare");
  // null and not a default rarity: the sorter prefers not sorting over sorting wrong
  assert.equal(normalizeRarity("Legendary"), null);
  assert.equal(normalizeRarity(undefined), null);
});

// INTACT odds say common is better (25.33% vs 11%), but with radiant uncommon beats it (20% vs 16.67%):
// sorting relics by chance sent radiant players to the worst pick
test("con radiante, una poco común pide MENOS runs que una común", () => {
  const comun = runsForRarity("Common", "radiant", 4);
  const pocoComun = runsForRarity("Uncommon", "radiant", 4);
  assert.ok(pocoComun < comun, `poco común ${pocoComun} debería costar menos que común ${comun}`);

  // for intact the common wins, which is why the two paths differ
  assert.ok(runsForRarity("Common", "intact", 4) < runsForRarity("Uncommon", "intact", 4));
});

test("runsForRarity coincide con el cálculo de la pieza cuando hay una sola reliquia", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  assert.equal(runsForRarity("Rare", "radiant", 4), calculatePartExpectedRuns(p, "radiant", 4));
});

test("una rareza desconocida no se inventa un número", () => {
  assert.equal(runsForRarity("Legendary", "radiant", 4), null);
  assert.equal(runsForRarity("Rare", "ultra", 4), null);
});

test("getPlayerOdds traduce la etiqueta de la UI y acota la escuadra", () => {
  state.refinement = "Rad";
  state.squadSize = 4;
  assert.deepEqual(getPlayerOdds(), { refinement: "radiant", squadSize: 4 });

  state.refinement = "Intact";
  state.squadSize = 9;
  assert.deepEqual(getPlayerOdds(), { refinement: "intact", squadSize: 4 }, "más de 4 no existe");

  state.refinement = undefined;
  state.squadSize = 1;
  assert.deepEqual(getPlayerOdds(), { refinement: "radiant", squadSize: 1 }, "en solitario");

  // 0 players is an unconfigured setting, falling back to 4 instead of 1: with 1, estimated runs would
  // triple
  state.squadSize = 0;
  assert.deepEqual(getPlayerOdds(), { refinement: "radiant", squadSize: 4 });
});

// squad size comes from state.squadSize and NOT playerCount (the recruitment message counter): they were
// linked, so leaving "need 1 player" estimated runs as if playing solo
test("getPlayerOdds ignora el contador de reclutamiento", () => {
  state.refinement = "Rad";
  state.squadSize = 4;
  state.playerCount = 1;
  assert.equal(getPlayerOdds().squadSize, 4, "«faltan 1» no significa escuadra de 1");
});
