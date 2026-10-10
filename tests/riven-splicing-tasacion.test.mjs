import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_ROOT = path.resolve(__dirname, "../deploy/assets/ml");
globalThis.fetch = async (url) => {
  const f = path.join(ML_ROOT, path.basename(String(url).split("?")[0]));
  if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
};

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {} }), addEventListener() {} };

const { state } = await import("../deploy/js/state.js");
const { calculateAdvancedPredictivePrice, calculateHybridTiers } = await import("../deploy/js/utils/rivens/riven_logic.js");
const { pesoFusionado, esFusionado } = await import("../deploy/js/utils/rivens/riven_cycling.js");
const { computeDesirabilityMultiplier } = await import("../deploy/js/services/rivens/riven_appraisal.service.js");
const { gradeRiven, loadRivenML } = await import("../deploy/js/utils/rivens/riven_ml.js");
const { RivenScannerHUD } = await import("../deploy/js/ui.components/rivens/ui_riven_scanner_hud.js");
const { getCanonicalStatKey } = await import("../deploy/js/utils/rivens/riven_naming.js");
const { getMetaStats } = await import("../deploy/js/services/rivens/riven_market.service.js");

state.currentLang = "es";

const S = (n, v, pos = true) => ({ name: n, value: v, isPositive: pos, minIdeal: 50, maxIdeal: 150 });
const base = { official_median: 100, wfm_avg: 400, official_stddev: 30,
  de_unrolled: { median: 100, pop: 10, min_price: 50, max_price: 400 },
  de_rerolled: { median: 200, pop: 10, stddev: 80, max_price: 800 },
  popularity_pct: 30, liquidity_score: 50, wfm_market_sample: 30 };

const tasar = (dynamic_weights, stats, tipo = "Rifle") => {
  const w = { ...base, name: "TestWeapon", dynamic_weights };
  const tiers = calculateHybridTiers(w, null);
  const r = calculateAdvancedPredictivePrice(w, stats, tiers, 1.0,
    { name: "TestWeapon", t: tipo, disposition: 1.0, dynamic_weights }, null);
  return { ...r, tiers };
};

test("pesoFusionado es la media de los dos stats de origen", () => {
  const p = pesoFusionado("Gas", { "Toxin Damage": 0.8, "Heat Damage": 0.4 }, 0);
  assert(Math.abs(p - 0.6) < 0.001);
});

test("con varias recetas gana la media máxima", () => {
  const p = pesoFusionado("Weak Point Damage", { "Base Damage / Melee Damage": 0.9, "Zoom": 0.1, "Multishot": 0.7 }, 0);
  assert(Math.abs(p - 0.8) < 0.001);
});

test("la receta gana al peso propio, que solo entra sin receta", () => {
  const p = pesoFusionado("Gas", { "Gas": 0.2, "Toxin Damage": 0.9, "Heat Damage": 0.9 }, 0);
  assert(Math.abs(p - 0.9) < 0.001);
  assert.equal(pesoFusionado("Gas", { "Gas": 0.2 }, 0), 0.2);
  const relleno = pesoFusionado("Heavy Attack Damage",
    { "Heavy Attack Damage": 0.3, "Heavy Attack Efficiency": 0.05, "Chance To Gain Extra Combo Count": 0.03 }, 3);
  assert(Math.abs(relleno - 0.04) < 0.001);
});

test("sin datos de origen devuelve null", () => {
  assert.equal(pesoFusionado("Gas", { "Multishot": 1 }, 0), null);
  assert.equal(pesoFusionado("Multishot", { "Multishot": 1 }, 0), null);
  assert.equal(pesoFusionado("Gas", null, 0), null);
});

test("en melee las recetas usan Attack Speed", () => {
  const p = pesoFusionado("Slam Attack Damage", { "Base Damage / Melee Damage": 0.8, "Fire Rate / Attack Speed": 0.6 }, 3);
  assert(Math.abs(p - 0.7) < 0.001);
  const parry = pesoFusionado("Parry Angle", { "Fire Rate / Attack Speed": 0.6, "Range": 1.0 }, 3);
  assert(Math.abs(parry - 0.8) < 0.001);
  assert.equal(pesoFusionado("Parry Angle", { "Fire Rate / Attack Speed": 0.6, "Range": 1.0 }, 0), null);
});

test("una receta que no existe en el tipo de arma no da peso", () => {
  assert.equal(pesoFusionado("Magazine Reload when Holstered", { "Ammo Maximum": 1, "Reload Speed": 1, "Magazine Capacity": 1 }, 4), null);
});

test("esFusionado reconoce los nombres fusionados y no los viejos", () => {
  assert.equal(esFusionado("Gas", 0), true);
  assert.equal(esFusionado("Weak Point Critical Chance", 0), true);
  assert.equal(esFusionado("Damage to Orokin", 0), true);
  assert.equal(esFusionado("Damage Vs Scaldra", 0), true);
  assert.equal(esFusionado("Weakpoint Damage", 0), true);
  assert.equal(esFusionado("Critical Chance", 0), false);
  assert.equal(esFusionado("Toxin Damage", 0), false);
  assert.equal(esFusionado("Damage Vs Grineer", 0), false);
  assert.equal(esFusionado("", 0), false);
});

test("la tasación pesa un stat fusionado por sus stats de origen en el arma", () => {
  const roll = [S("Weak Point Critical Chance", 140), S("Critical Damage", 140), S("Zoom", 60, false)];
  const scoreAlto = tasar({ "Critical Chance": 0.6, "Multishot": 1.0, "Critical Damage": 0.2, "Zoom": 0.01 }, roll).adjustedScore;
  const scoreBajo = tasar({ "Critical Chance": 0.6, "Multishot": 0.05, "Critical Damage": 0.2, "Zoom": 0.01 }, roll).adjustedScore;
  assert(scoreAlto > scoreBajo, `${scoreAlto} debería superar a ${scoreBajo}`);
});

test("la deseabilidad pesa Weak Point Critical Chance por sus recetas y no como Critical Chance", () => {
  const pos = (n) => ({ name: n, value: 100, isPositive: true });
  const neg = (n) => ({ name: n, value: -50, isPositive: false });
  const antes = { baseline: state.rivenStatBaseline, prior: state.rivenStatPrior };
  try {
    state.rivenStatBaseline = null;
    state.rivenStatPrior = { "Critical Chance": 0.9, "Multishot": 0.9, "Zoom": 0.05, "Toxin Damage": 0.1, "Heat Damage": 0.1, "Critical Damage": 0.9 };
    const meta = { name: "Braton", pos: [], midPos: [], neg: [], midNeg: [] };
    const arma = { t: "Rifle", name: "Braton" };
    const multAlto = computeDesirabilityMultiplier([pos("Weak Point Critical Chance"), pos("Critical Damage"), neg("Zoom")], meta, arma);
    const multBajo = computeDesirabilityMultiplier([pos("Gas"), pos("Critical Damage"), neg("Zoom")], meta, arma);
    assert(multAlto > multBajo, `${multAlto} debería superar a ${multBajo}`);
    state.rivenStatPrior = { "Critical Chance": 0.9, "Multishot": 0.05, "Zoom": 0.05, "Critical Damage": 0.9 };
    const multCC = computeDesirabilityMultiplier([pos("Critical Chance"), pos("Critical Damage"), neg("Zoom")], meta, arma);
    const multWPCC = computeDesirabilityMultiplier([pos("Weak Point Critical Chance"), pos("Critical Damage"), neg("Zoom")], meta, arma);
    assert(multCC > multWPCC, `${multCC} debería superar a ${multWPCC}`);
  } finally {
    state.rivenStatBaseline = antes.baseline;
    state.rivenStatPrior = antes.prior;
  }
});

test("gradeRiven da a los fusionados el peso de sus recetas", async () => {
  const antes = state.weaponMap;
  try {
    state.weaponMap = { "TestRifle": { t: "Rifle" } };
    await loadRivenML();
    const gWeak = await gradeRiven("TestRifle", [{ name: "Weak Point Critical Chance", isPositive: true }]);
    const gGas = await gradeRiven("TestRifle", [{ name: "Gas", isPositive: true }]);
    assert(gWeak.stats[0].weight !== 0.30);
    assert(gWeak.stats[0].weight > gGas.stats[0].weight);
  } finally {
    state.weaponMap = antes;
  }
});

test("el HUD del escáner etiqueta los stats fusionados por sus recetas y no como sus stats de origen", () => {
  const r1 = RivenScannerHUD._statDesirability({ t: "Rifle", dynamic_weights: { "Critical Chance": 0.9, "Multishot": 0.05, "Zoom": 0.05 } }, "Weak Point Critical Chance", true);
  assert.equal(r1.label, "GOOD");

  const r2 = RivenScannerHUD._statDesirability({ t: "Rifle", dynamic_weights: { "Toxin Damage": 0.9, "Heat Damage": 0.9 } }, "Gas", true);
  assert.equal(r2.label, "TOP");

  const r3 = RivenScannerHUD._statDesirability({ t: "Rifle", pos: ["Critical Chance"] }, "Weak Point Critical Chance", true);
  assert.equal(r3.label, "WEAK");
});

test("los comparables de mercado no confunden los fusionados con los stats de origen", () => {
  assert.equal(getCanonicalStatKey("Weak Point Critical Chance"), "weak_point_critical_chance");
  assert.equal(getCanonicalStatKey("weak_point_critical_chance"), "weak_point_critical_chance");
  assert.equal(getCanonicalStatKey("Weakpoint Critical Chance"), "weak_point_critical_chance");
  assert.equal(getCanonicalStatKey("Magazine Reload when Holstered"), "magazine_reload_when_holstered");
  assert.equal(getCanonicalStatKey("Ammo Efficiency"), "ammo_efficiency");
  assert.equal(getCanonicalStatKey("Gas"), "gas_damage");
  assert.equal(getCanonicalStatKey("gas_damage"), "gas_damage");
  assert.equal(getCanonicalStatKey("Critical Chance"), "critical_chance");
  assert.equal(getCanonicalStatKey("magazine_capacity"), "magazine_capacity");
  assert.equal(getCanonicalStatKey("ammo_maximum"), "ammo_maximum");
  assert.equal(getCanonicalStatKey("Damage to Corpus"), "vs_corpus");
});

test("un arma cuerpo a cuerpo sin tipo en el meta se tasa como cuerpo a cuerpo", async () => {
  const antes = { indice: state.rivenIndexData, mapa: state.weaponMap };
  try {
    state.rivenIndexData = { TestSword: { pos: ["Range"], dynamic_weights: { "Fire Rate / Attack Speed": 0.9, "Range": 0.9 } } };
    state.weaponMap = { TestSword: { t: "Melee" } };
    const meta = getMetaStats("TestSword");
    assert.equal(meta.t, "Melee");
    assert.equal(RivenScannerHUD._statDesirability(meta, "Parry Angle", true).label, "TOP");
    await loadRivenML();
    const g = await gradeRiven("TestSword", [{ name: "Parry Angle", isPositive: true }]);
    assert.notEqual(g.stats[0].weight, 0.30);
  } finally {
    state.rivenIndexData = antes.indice;
    state.weaponMap = antes.mapa;
  }
});
