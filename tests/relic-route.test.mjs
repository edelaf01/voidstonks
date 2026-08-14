import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSetRoute, buildFarmRoutes, normalizeTier } from "../deploy/js/utils/inventory/relic_route.js";

const setsDatabase = {
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis", "Gara Prime Systems"],
  "Nidus Prime": ["Nidus Prime Blueprint", "Nidus Prime Neuroptics"],
};
const itemsDatabase = {
  "Gara Prime Chassis": [
    { relic: "Meso P13 Relic", tier: "Meso", rarity: "Common", chance: 25 },
    { relic: "Neo N20 Relic", tier: "Neo", rarity: "Rare", chance: 2 },
  ],
  "Gara Prime Systems": [{ relic: "Axi G1 Relic", tier: "Axi", rarity: "Rare", chance: 2 }],
  "Nidus Prime Neuroptics": [{ relic: "Lith N4 Relic", tier: "Lith", rarity: "Common", chance: 25 }],
};
const relicSources = {
  "Neo N20": [{ location: "Ío (Júpiter)", mission: "Defense", rotation: "B", chance: 11 }],
  "Axi G1": [{ location: "Hydron (Sedna)", mission: "Defense", rotation: "C", chance: 10 }],
};
const base = {
  setsDatabase, itemsDatabase, relicSources,
  primeInventory: { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1, "Nidus Prime Blueprint": 1 },
  relicCounts: { "Meso P13": 12 },
  fissures: [{ node: "Ío (Júpiter)", type: "Defense", tier: "Meso", eta: "35m" }],
  getRequiredCount: () => 1,
};

test("ruta: un set completo apunta al SIGUIENTE, no dice 'ya está'", () => {
  const full = Object.fromEntries(setsDatabase["Gara Prime"].map((p) => [p, 1]));
  const r = buildSetRoute("Gara Prime", { ...base, primeInventory: full });
  assert.equal(r.built, 1, "ya tienes uno montado");
  assert.equal(r.missingCount, 4, "para el segundo te faltan las cuatro");
});

// El caso que motivó esto: Acceltra completo y encima piezas sueltas de sobra. Antes salía
// "no tienes ningún set a medias" cuando en realidad estás a una pieza del segundo.
test("rutas: con piezas de MÁS, el set sigue siendo recomendable", () => {
  const sobras = {
    "Gara Prime Blueprint": 3, "Gara Prime Neuroptics": 2,
    "Gara Prime Chassis": 2, "Gara Prime Systems": 1,
  };
  const routes = buildFarmRoutes({ ...base, primeInventory: sobras });
  const gara = routes.find((r) => r.setName === "Gara Prime");
  assert.ok(gara, "un set con excedentes tiene que aparecer");
  assert.equal(gara.built, 1);
  assert.deepEqual(gara.missing.map((m) => m.part), ["Gara Prime Systems"],
    "solo falta la pieza de la que no te sobra ninguna");
});

test("rutas: un set completo SIN excedentes no ensucia la lista", () => {
  const justo = Object.fromEntries(setsDatabase["Gara Prime"].map((p) => [p, 1]));
  const routes = buildFarmRoutes({ ...base, primeInventory: justo });
  assert.equal(routes.find((r) => r.setName === "Gara Prime"), undefined);
});

test("ruta: set inexistente no revienta", () => {
  assert.equal(buildSetRoute("No Existe Prime", base), null);
});

test("ruta: lista solo lo que falta", () => {
  const r = buildSetRoute("Gara Prime", base);
  assert.equal(r.totalParts, 4);
  assert.equal(r.missingCount, 2);
  assert.deepEqual(r.missing.map((m) => m.part), ["Gara Prime Chassis", "Gara Prime Systems"]);
});

test("ruta: primero la reliquia que TIENES y con fisura abierta", () => {
  const chassis = buildSetRoute("Gara Prime", base).missing[0];
  assert.equal(chassis.relics[0].relic, "Meso P13", "tienes 12 y hay fisura Meso");
  assert.equal(chassis.relics[0].owned, 12);
  assert.equal(chassis.relics[0].fissures.length, 1);
  assert.equal(chassis.ready, true, "se puede ir a por ella ahora mismo");
});

test("ruta: si no tienes la reliquia, dice dónde farmearla", () => {
  const systems = buildSetRoute("Gara Prime", base).missing[1];
  assert.equal(systems.ready, false, "sin copias no se puede correr ya");
  assert.equal(systems.relics[0].owned, 0);
  assert.deepEqual(systems.relics[0].sources[0].location, "Hydron (Sedna)");
});

test("ruta: teniendo la reliquia no se molesta en decir dónde farmearla", () => {
  const chassis = buildSetRoute("Gara Prime", base).missing[0];
  assert.deepEqual(chassis.relics[0].sources, [], "ya la tienes: la fuente es ruido");
});

test("ruta: sin fisuras activas sigue dando plan, solo que nada está listo", () => {
  const r = buildSetRoute("Gara Prime", { ...base, fissures: [] });
  assert.equal(r.readyCount, 0);
  assert.equal(r.missing[0].relics[0].owned, 12, "las copias se siguen viendo");
});

test("rutas: solo sets EMPEZADOS y sin cerrar", () => {
  const routes = buildFarmRoutes(base);
  const names = routes.map((r) => r.setName);
  assert.ok(names.includes("Gara Prime"));
  assert.ok(names.includes("Nidus Prime"));

  // Un set del que no tienes nada no es una recomendación, es un listado del juego entero.
  const sinEmpezar = buildFarmRoutes({ ...base, primeInventory: {} });
  assert.deepEqual(sinEmpezar, []);
});

test("rutas: primero al que menos le falta", () => {
  const routes = buildFarmRoutes(base);
  assert.equal(routes[0].setName, "Nidus Prime", "le falta 1; a Gara le faltan 2");
});

test("rutas: aguanta datos a medias sin romperse", () => {
  assert.deepEqual(buildFarmRoutes({}), []);
  const r = buildSetRoute("Gara Prime", { setsDatabase, primeInventory: base.primeInventory });
  assert.equal(r.missingCount, 2);
  assert.deepEqual(r.missing[0].relics, [], "sin itemsDatabase no hay reliquias, pero no explota");
});

test("normalizeTier: el worldstate llama Vanguard a Axi", () => {
  assert.equal(normalizeTier("Vanguard"), "Axi");
  assert.equal(normalizeTier("Meso"), "Meso");
});
