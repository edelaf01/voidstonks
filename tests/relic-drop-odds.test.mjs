// Probabilidades de drop de reliquias: cuántas runs cuesta una pieza.
//
// Es el tipo de cálculo que falla en silencio: un factor mal puesto no rompe nada en pantalla,
// solo cambia un número que nadie puede verificar a ojo. Y de ahí salen las estimaciones que
// el rastreador de sets le enseña al usuario para decidir si farmea o compra.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { state } = await import("../deploy/js/state.js");
const { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } = await import(
  "../deploy/js/utils/inventory/relic_drop_odds.utils.js"
);

/** Deja itemsDatabase con lo justo para el caso y devuelve el nombre de la pieza. */
function conDrops(nombre, drops) {
  state.itemsDatabase = { [nombre]: drops };
  return nombre;
}

// El bug que esto fija: "uncommon".includes("common") es true, así que mirando common primero
// TODA pieza poco común se clasificaba como común — y con ella las tasas equivocadas
// (radiant 0.1667 en vez de 0.20), o sea más runs estimadas de las reales.
test("una pieza Uncommon no se clasifica como Common", () => {
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Uncommon", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "UNCOMMON", chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Common", chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ rarity: "Rare", chance: 2 }])), "rare");
});

// Sin campo `rarity` se deduce de la probabilidad. Los cortes (17 y 5) están calibrados sobre
// las tasas de reliquia INTACTA, que es el único estado que la BD guarda: común 25.33,
// poco común 11, rara 2.
test("sin rarity, la rareza se deduce de la probabilidad intacta", () => {
  assert.equal(getPartRarity(conDrops("p", [{ chance: 25.33 }])), "common");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 11 }])), "uncommon");
  assert.equal(getPartRarity(conDrops("p", [{ chance: 2 }])), "rare");
});

// La API manda a veces la probabilidad como fracción (0.11) y a veces como porcentaje (11).
// El módulo normaliza tratando todo lo que sea <= 1 como fracción.
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

// La fórmula del escuadrón: con 4 jugadores abriendo la misma reliquia, la pieza cae si la
// saca CUALQUIERA. Invertirla (multiplicar por el tamaño, o usar 1-p^n) da números plausibles
// pero mal, y nadie lo notaría.
test("la probabilidad de escuadrón es 1-(1-p)^n, no p*n", () => {
  const p = conDrops("p", [{ rarity: "Rare", chance: 2 }]);
  const pSingle = DROP_RATES_BY_RARITY.rare.radiant; // 0.10
  // Con un solo jugador la fórmula se reduce a 1/p, pero se compara con tolerancia: la función
  // aplica igualmente 1-(1-p)^1, que en coma flotante da 10.000000000000002 y no 10.
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  casi(calculatePartExpectedRuns(p, "radiant", 1), 1 / pSingle);
  casi(calculatePartExpectedRuns(p, "radiant", 4), 1 / (1 - (1 - pSingle) ** 4));

  // Más gente nunca puede salir a más runs.
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

// Las comunes son el caso al revés y es contraintuitivo: refinar BAJA su probabilidad
// (0.2533 intacta -> 0.1667 radiante), porque el refinamiento desplaza peso hacia las raras.
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
