import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { state } = await import("../deploy/js/state.js");
const { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } = await import(
  "../deploy/js/utils/inventory/relic_drop_odds.utils.js"
);

function conDrops(nombre, drops) {
  state.itemsDatabase = { [nombre]: drops };
  return nombre;
}

test("una pieza Uncommon no se clasifica como Common", () => {
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Uncommon", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "UNCOMMON", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Common", chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Rare", chance: 2 }])), "rare");
});

// cutoffs (17 and 5) infer rarity from intact rates in db (common 25.33, uncommon 11, rare 2)
test("sin rarity, la rareza se deduce de la probabilidad intacta", () => {
  assert.equal(getPartRarity(conDrops("p", [{ chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 2 }])), "rare");
});

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

test("la probabilidad de escuadrón es 1-(1-p)^n, no p*n", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  const pSingle = DROP_RATES_BY_RARITY.rare.radiant;
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  casi(calculatePartExpectedRuns(p, "radiant", 1), 1 / pSingle);
  casi(calculatePartExpectedRuns(p, "radiant", 4), 1 / (1 - (1 - pSingle) ** 4));

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
  assert.equal(normalizeRarity("Legendary"), null);
  assert.equal(normalizeRarity(undefined), null);
});

test("con radiante, una poco común pide MENOS runs que una común", () => {
  const comun = runsForRarity("Common", "radiant", 4);
  const pocoComun = runsForRarity("Uncommon", "radiant", 4);
  assert.ok(pocoComun < comun, `poco común ${pocoComun} debería costar menos que común ${comun}`);

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

  state.squadSize = 0;
  assert.deepEqual(getPlayerOdds(), { refinement: "radiant", squadSize: 4 });
});

test("getPlayerOdds ignora el contador de reclutamiento", () => {
  state.refinement = "Rad";
  state.squadSize = 4;
  state.playerCount = 1;
  assert.equal(getPlayerOdds().squadSize, 4, "«faltan 1» no significa escuadra de 1");
});
