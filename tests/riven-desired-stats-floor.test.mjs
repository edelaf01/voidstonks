// REGLA DE NEGOCIO: un riven con los stats DESEADOS del arma nunca se tasa por debajo de la
// mediana de ese arma. Si sus mejores positivos salen y aun así vale menos que un roll cualquiera,
// la tasación está mal por definición.
//
// El caso que rompía esto: con poco volumen los pesos por arma SATURAN (Seer trae 8 de 30 stats
// empatados a 1.0, Zoom y Recoil incluidos), así que cualquier negativa contaba como "perder un
// stat top" y brickeaba el riven. Seer con SUS mejores positivos se tasaba a 0.25× su mediana.
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

const { state } = await import("../deploy/js/state.js");
const { calculateAdvancedPredictivePrice, calculateHybridTiers } = await import("../deploy/js/utils/rivens/riven_logic.js");
const ML = await import("../deploy/js/utils/rivens/riven_ml.js");
state.currentLang = "es";

const tasar = (weapon, stats) => {
  const tiers = calculateHybridTiers(weapon, null);
  const wd = { name: weapon.name, t: weapon.type || "Pistol",
    disposition: weapon.disposition, dynamic_weights: weapon.dynamic_weights };
  return calculateAdvancedPredictivePrice(weapon, stats, tiers, 1.0, wd, null);
};
const S = (n, v, pos = true) => ({ name: n, value: v, isPositive: pos, minIdeal: 50, maxIdeal: 150 });

// Arma con pesos SATURADOS, como Seer: media docena de stats empatados al máximo, Zoom entre ellos.
const SATURADA = {
  name: "SaturadaTest", type: "Pistol", official_median: 144,
  de_unrolled: { median: 144, pop: 3, min_price: 20, max_price: 500 },
  de_rerolled: { median: 144, pop: 4, stddev: 60, max_price: 600 },
  wfm_avg: 900, popularity_pct: 20, liquidity_score: 30, wfm_market_sample: 10,
  dynamic_weights: {
    "Critical Damage": 1, "Status Duration": 1, "Base Damage / Melee Damage": 1,
    "Critical Chance": 1, "Fire Rate / Attack Speed": 1, "Electric Damage": 1,
    "Recoil": 1, "Zoom": 1, "Multishot": 0.46, "Cold Damage": 0.45,
    "Toxin Damage": 0.2, "Heat Damage": 0.2, "Ammo Maximum": 0.1,
    "Magazine Capacity": 0.1, "Reload Speed": 0.1, "Punch Through": 0.1,
    "Status Chance": 0.3, "Impact Damage": 0.05, "Puncture Damage": 0.05,
    "Slash Damage": 0.05, "Projectile Speed": 0.05, "Damage Vs Grineer": 0.05,
    "Damage Vs Corpus": 0.05, "Damage Vs Infested": 0.05,
  },
};

test("pesos saturados no brickean un riven con los stats deseados", () => {
  // Sus dos mejores positivos + una negativa que el dato saturado marca como 1.0 (Zoom).
  const r = tasar(SATURADA, [S("Critical Damage", 100), S("Critical Chance", 100), S("Zoom", 30, false)]);
  assert.ok(r.adjustedScore > 40,
    `con los mejores positivos del arma el score no debe hundirse; salió ${r.adjustedScore}/100`);
  assert.ok(r.estimatedValue >= SATURADA.de_rerolled.median,
    `un riven con stats deseados debe valer al menos la mediana del arma ` +
    `(${r.estimatedValue}p vs mediana ${SATURADA.de_rerolled.median}p)`);
});

test("un arma con pesos SANOS sigue brickeando cuando toca", () => {
  // Mismo escenario pero con pesos que sí discriminan: Zoom irrelevante, Multishot top.
  // La tabla lleva ~30 stats como las armas reales: con una tabla corta, 3 empates a 1.0 serían
  // un 30% y el guard de pesos degenerados saltaría por error.
  const sana = { ...SATURADA, name: "SanaTest", dynamic_weights: {
    "Critical Damage": 1, "Critical Chance": 1, "Multishot": 1,
    "Base Damage / Melee Damage": 0.5, "Status Chance": 0.3, "Fire Rate / Attack Speed": 0.2,
    "Zoom": 0.01, "Recoil": 0.02, "Ammo Maximum": 0.05, "Magazine Capacity": 0.05,
    "Reload Speed": 0.06, "Punch Through": 0.07, "Projectile Speed": 0.04,
    "Toxin Damage": 0.15, "Heat Damage": 0.14, "Cold Damage": 0.13, "Electric Damage": 0.12,
    "Impact Damage": 0.03, "Puncture Damage": 0.03, "Slash Damage": 0.03,
    "Status Duration": 0.11, "Damage Vs Grineer": 0.05, "Damage Vs Corpus": 0.05,
    "Damage Vs Infested": 0.04, "Range": 0.02, "Initial Combo": 0.02,
    "Combo Duration": 0.02, "Heavy Attack Efficiency": 0.02, "Heavy Attack Damage": 0.02,
    "Chance To Gain Extra Combo Count": 0.02,
  } };
  const conZoom = tasar(sana, [S("Critical Damage", 100), S("Critical Chance", 100), S("Zoom", 30, false)]);
  const conMulti = tasar(sana, [S("Critical Damage", 100), S("Critical Chance", 100), S("Multishot", 40, false)]);
  assert.ok(conZoom.adjustedScore > 40, "-Zoom (0.01) no debe brickear en un arma con pesos sanos");
  assert.ok(conMulti.adjustedScore <= 20, "-Multishot (1.0) SÍ debe brickear en un arma que lo valora");
});

test("el riven de stats deseados supera la mediana en las tres magnitudes", async () => {
  for (const mag of [50, 100, 150]) {
    const r = tasar(SATURADA, [S("Critical Damage", mag), S("Critical Chance", mag), S("Zoom", 30, false)]);
    const band = await ML.predictRivenMLBand(SATURADA, [S("Critical Damage", mag), S("Critical Chance", mag), S("Zoom", 30, false)],
      SATURADA, null, r.adjustedScore);
    assert.ok(band.p50 >= SATURADA.de_rerolled.median * 0.95,
      `magnitud ${mag}: p50 ${band.p50}p debería alcanzar la mediana ${SATURADA.de_rerolled.median}p`);
  }
});
