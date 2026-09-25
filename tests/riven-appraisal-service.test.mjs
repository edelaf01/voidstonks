// desirability multiplier and roll appraisal: the SAME function powers all three views (rivens tab,
// scanner HUD, 2-roll compare)
// divergence makes the scanner and tab disagree on the same riven with no way to tell which lies; tests
// behaviour and ranking rules rather than raw constants

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const { computeDesirabilityMultiplier, appraiseParsedRiven, statsBuscadosDelArma } =
  await import("../deploy/js/services/rivens/riven_appraisal.service.js");

// without ML weights or prior: exercises universal lists, the last resort when the ML bundle fails to load
state.rivenStatBaseline = null;
state.rivenStatPrior = null;

const RIFLE = { t: "Rifle", name: "Braton" };
const MELEE = { t: "Melee", name: "Dagger" };
const META = { name: "Braton", pos: [], midPos: [], neg: [], midNeg: [] };

const pos = (name, value = 100) => ({ name, value });
const neg = (name, value = -50) => ({ name, value });

test("un roll de puros stats meta puntúa por encima de uno de basura", () => {
  const bueno = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Zoom")], META, RIFLE);
  const malo = computeDesirabilityMultiplier(
    [pos("Zoom"), pos("Recoil"), neg("Zoom")], META, RIFLE);
  assert.ok(bueno > malo, `${bueno} debería superar a ${malo}`);
});

// without a curse the riven costs more to cycle and is worth less than the same roll with an innocuous
// curse: the explicit "no curse" penalty
test("no tener negativa penaliza frente a tener una inofensiva", () => {
  const conNegInocua = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Zoom")], META, RIFLE);
  const sinNeg = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot")], META, RIFLE);
  assert.ok(sinNeg < conNegInocua, `sin negativa (${sinNeg}) no puede ganar a ${conNegInocua}`);
});

// the "brick" case: a curse on the weapon's most wanted stat ruins the riven regardless of how good the
// positives are
test("una negativa sobre un stat clave hunde el roll aunque los positivos sean perfectos", () => {
  const m = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Critical Chance")], META, RIFLE);
  assert.ok(m <= 0.1, `un brick debería quedar en el suelo, no en ${m}`);
});

// faction damage is the classic cheap curse: takes up a curse slot without removing real power, so it
// cannot count as a ruin
test("el daño por facción en negativo no cuenta como maldición mala", () => {
  const facción = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Damage to Grineer")], META, RIFLE);
  const critica = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Critical Chance")], META, RIFLE);
  assert.ok(facción > critica, `${facción} debería superar a ${critica}`);
});

// code comment warning: fuzzy matching made bare "Damage" match thirteen stats and find returned Critical
// Damage; if that returned, a roll with -Damage would not read as intended
test('"Damage" a secas no se confunde con Critical Damage', () => {
  const conDamage = computeDesirabilityMultiplier([pos("Damage"), neg("Zoom")], META, RIFLE);
  const conCrit = computeDesirabilityMultiplier([pos("Critical Damage"), neg("Zoom")], META, RIFLE);
  assert.ok(conDamage > 0.1 && conCrit > 0.1, "los dos deben valorarse");
});

// good stats differ between melee and ranged: Range matters on melee and Multishot does not exist there
test("melee y arma de fuego no valoran los mismos stats", () => {
  const rangeEnMelee = computeDesirabilityMultiplier(
    [pos("Range"), pos("Critical Damage"), neg("Zoom")], { ...META, name: "Dagger" }, MELEE);
  const rangeEnRifle = computeDesirabilityMultiplier(
    [pos("Range"), pos("Critical Damage"), neg("Zoom")], META, RIFLE);
  assert.ok(rangeEnMelee > rangeEnRifle, `melee ${rangeEnMelee} vs rifle ${rangeEnRifle}`);
});

test("el multiplicador nunca se sale de su rango", () => {
  const casos = [
    [],
    [pos("Critical Damage"), pos("Multishot"), pos("Critical Chance")],
    [neg("Critical Chance"), neg("Multishot"), neg("Damage")],
    [pos("Zoom"), pos("Recoil"), pos("Ammo Maximum"), pos("Zoom"), neg("Zoom")],
  ];
  for (const stats of casos) {
    const m = computeDesirabilityMultiplier(stats, META, RIFLE);
    assert.ok(m >= 0.1 && m <= 1.0, `${m} fuera de [0.1, 1.0] con ${stats.length} stats`);
  }
});

test("un meta corrupto no revienta la tasación", () => {
  for (const malo of [{}, { pos: "no es lista", neg: 7 }, { name: "X" }]) {
    assert.doesNotThrow(
      () => computeDesirabilityMultiplier([pos("Critical Damage")], malo, RIFLE), JSON.stringify(malo));
  }
});

// returning null instead of a partial object lets the scanner show "no data" rather than a made-up price
// for an unlisted weapon
test("sin meta del arma no se inventa una tasación", () => {
  state.weaponMap = {};
  assert.equal(appraiseParsedRiven("Arma Inexistente", [pos("Critical Damage")]), null);
});

test("con meta devuelve las cuatro piezas que espera quien la pinta", () => {
  state.weaponMap = { Braton: { t: "Rifle", disposition: 1.0 } };
  const r = appraiseParsedRiven("Braton", [
    { name: "Critical Damage", value: 120, isPositive: true },
    { name: "Zoom", value: 30, isPositive: false },
  ], META);

  assert.ok(r, "debe tasar");
  for (const clave of ["meta", "tiers", "prediction", "itemAttributes"]) {
    assert.ok(clave in r, `falta ${clave}`);
  }
  assert.equal(r.itemAttributes.length, 2);
});

// sign is stored in isPositive, not in the value: ocr and tab deliver curses as a POSITIVE value with the
// flag set to false, and confusing them would invert appraisal
test("las negativas llegan con el valor en positivo y la bandera aparte", () => {
  state.weaponMap = { Braton: { t: "Rifle", disposition: 1.0 } };
  const r = appraiseParsedRiven("Braton", [
    { name: "Zoom", value: 30, isPositive: false },
  ], META);
  assert.equal(r.itemAttributes[0].isPositive, false);
  assert.ok(r.itemAttributes[0].value > 0, "el valor absoluto, no el signo");
});

// scanner cycling advice uses these desired stats: if it relied on bare meta.pos, which arrives empty for
// most weapons, the scanner would almost never suggest anything
test("los stats buscados salen de los pesos del arma y, sin ellos, de meta.pos", () => {
  const conPesos = { name: "Braton", pos: [], midPos: [],
    dynamic_weights: { "Critical Damage": 0.9, "Multishot": 0.8, "Toxin Damage": 0.5, "Zoom": 0.1 } };
  assert.deepEqual(statsBuscadosDelArma(conPesos, "Braton"),
    { best: ["Critical Damage", "Multishot"], mid: ["Toxin Damage"] });
  assert.deepEqual(statsBuscadosDelArma({ name: "Braton", pos: ["Zoom"], midPos: ["Recoil"] }, "Braton"),
    { best: ["Zoom"], mid: ["Recoil"] });
  assert.deepEqual(statsBuscadosDelArma(null, "Braton"), { best: [], mid: [] });
});
