import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {}
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_ROOT = path.resolve(__dirname, "../deploy/assets/ml");

globalThis.fetch = async (url) => {
  const filename = path.basename(url.split("?")[0]);
  const filepath = path.join(ML_ROOT, filename);
  if (fs.existsSync(filepath)) {
    return {
      json: async () => JSON.parse(fs.readFileSync(filepath, "utf8")),
      ok: true
    };
  }
  throw new Error(`File not found: ${filepath}`);
};

import { state } from "../deploy/js/state.js";
import { calculateAdvancedPredictivePrice, calculateHybridTiers } from "../deploy/js/utils/rivens/riven_logic.js";
import * as ML from "../deploy/js/utils/rivens/riven_ml.js";

let API_MAP = {};
try {
  const cachePath = path.resolve(__dirname, "../scripts-actu/ML-rivenvaluation/cache_datos_api.json");
  API_MAP = JSON.parse(fs.readFileSync(cachePath, "utf8")).api_map || {};
} catch {}

state.currentLang = "es";
state.weaponMap = {
  "Torid": { name: "Torid", t: "Rifle", disposition: 0.5, omegaAttenuation: 0.5 },
  "Bubonico": { name: "Bubonico", t: "Shotgun", disposition: 0.5, omegaAttenuation: 0.5 },
  "Amphis": { name: "Amphis", t: "Melee", disposition: 1.5, omegaAttenuation: 1.5 },
};

const TEST_CASES = [
  {
    weaponName: "Torid",
    rollName: "Godroll",
    stats: [
      { name: "Multishot", value: 120, isPositive: true },
      { name: "Critical Damage", value: 150, isPositive: true },
      { name: "Critical Chance", value: 180, isPositive: true },
      { name: "Zoom", value: -40, isPositive: false }
    ],
    rolls: 10
  },
  {
    weaponName: "Torid",
    rollName: "Trash",
    stats: [
      { name: "Magazine Capacity", value: 30, isPositive: true },
      { name: "Zoom", value: 20, isPositive: true },
      { name: "Ammo Maximum", value: 40, isPositive: true }
    ],
    rolls: 0
  },
  {
    weaponName: "Bubonico",
    rollName: "Godroll",
    stats: [
      { name: "Multishot", value: 110, isPositive: true },
      { name: "Critical Chance", value: 140, isPositive: true },
      { name: "Critical Damage", value: 120, isPositive: true },
      { name: "Zoom", value: -30, isPositive: false }
    ],
    rolls: 5
  },
  {
    weaponName: "Bubonico",
    rollName: "Trash",
    stats: [
      { name: "Magazine Capacity", value: 20, isPositive: true },
      { name: "Punch Through", value: 2, isPositive: true },
      { name: "Ammo Maximum", value: 30, isPositive: true }
    ],
    rolls: 0
  },
  {
    weaponName: "Amphis",
    rollName: "Godroll",
    stats: [
      { name: "Base Damage / Melee Damage", value: 220, isPositive: true },
      { name: "Range", value: 150, isPositive: true },
      { name: "Critical Chance On Slide Attack", value: 110, isPositive: true },
      { name: "Finisher Damage", value: -50, isPositive: false }
    ],
    rolls: 20
  },
  {
    weaponName: "Amphis",
    rollName: "Trash",
    stats: [
      { name: "Critical Chance On Slide Attack", value: 40, isPositive: true },
      { name: "Slash Damage", value: 30, isPositive: true },
      { name: "Impact Damage", value: 50, isPositive: true }
    ],
    rolls: 0
  }
];

test("Compare heuristics vs ML price models and record results", async () => {
  const mlData = await ML.loadRivenML();
  const results = [];

  for (const tc of TEST_CASES) {
    const { weaponName, rollName, stats, rolls } = tc;
    
    // price_bands.json holds WFM ask deciles, not sales: real sales go in official_median
    const real = API_MAP[weaponName.toLowerCase()] || {};
    const meta = mlData.statWeights[weaponName] ? {
      name: weaponName,
      official_median: real.official_median || mlData.bands[weaponName]?.floor || 50,
      wfm_avg: real.wfm_avg || mlData.bands[weaponName]?.typical || 50,
      official_stddev: real.official_stddev,
      de_unrolled: real.de_unrolled,
      de_rerolled: real.de_rerolled,
      popularity_pct: real.popularity_pct,
      liquidity_score: real.liquidity_score,
      wfm_market_sample: real.wfm_market_sample,
      dynamic_weights: mlData.statWeights[weaponName]?.pos?.S || {}
    } : null;

    const tiers = calculateHybridTiers(meta || { name: weaponName, official_median: 50, wfm_avg_price: 50 });
    const itemAttributes = stats.map(s => ({
      isPositive: s.isPositive,
      name: s.name,
      value: Math.abs(s.value),
      minIdeal: 50,
      maxIdeal: 150
    }));
    
    const heuristic = calculateAdvancedPredictivePrice(
      meta || { name: weaponName, official_median: 50, wfm_avg_price: 50 },
      itemAttributes,
      tiers,
      1.0,
      { name: weaponName, t: weaponName === "Amphis" ? "Melee" : weaponName === "Bubonico" ? "Shotgun" : "Rifle" },
      null
    );

    const _w = meta || { name: weaponName };
    const mlRaw = await ML.predictRivenMLPrice(_w, itemAttributes, meta, rolls);

    const est = await ML.mlBandEstimate(weaponName, itemAttributes, heuristic.adjustedScore, { 
      median: (_w.de_rerolled?.median) || (_w.de_unrolled?.median) || _w.official_median, 
      max: (_w.de_rerolled?.max_price) || 0, 
      floor: _w.official_median 
    });
    
    const band = est || ML.robustPriceBand(_w, []);
    const mlPrice = est ? est.price : Math.max(band.floor, Math.min(band.ceiling, mlRaw));

    results.push({
      weapon: weaponName,
      roll: rollName,
      score: est ? est.score : heuristic.adjustedScore,
      heuristic: heuristic.estimatedValue,
      mlRaw: Math.round(mlRaw),
      mlPrice: mlPrice,
      range: est ? `[${band.floor} - ${band.max}]` : `[${band.floor} - ${band.ceiling}]`
    });
  }

  const resultsPath = path.resolve(__dirname, "appraisal_results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n[TEST] Appraisal comparison results saved to ${resultsPath}`);

  const mdPath = path.resolve(__dirname, "appraisal_results.md");
  let md = "# Comparison: Heuristic vs ML Appraisals\n\n";
  md += "| Weapon | Roll Type | Quality Score | Heuristic Price | Raw ML Price | Anchored ML Price | Active Band |\n";
  md += "| :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n";
  for (const r of results) {
    md += `| \`${r.weapon}\` | ${r.roll} | ${r.score}/100 | ${r.heuristic} pl | ${r.mlRaw} pl | **${r.mlPrice} pl** | ${r.range} |\n`;
  }
  fs.writeFileSync(mdPath, md, "utf8");
  console.log(`[TEST] Appraisal comparison markdown saved to ${mdPath}`);

  assert.ok(results.length > 0, "No tests were executed");

  for (const w of [...new Set(results.map(r => r.weapon))]) {
    const god = results.find(r => r.weapon === w && r.roll === "Godroll");
    const trash = results.find(r => r.weapon === w && r.roll === "Trash");
    if (!god || !trash) continue;
    assert.ok(god.score > trash.score, `${w}: el godroll debe puntuar por encima del trash (${god.score} vs ${trash.score})`);
    assert.ok(god.mlPrice > trash.mlPrice, `${w}: el godroll debe tasarse por encima del trash (${god.mlPrice} vs ${trash.mlPrice})`);
    assert.ok(trash.score <= 40, `${w}: un roll trash no debe puntuar como decente (${trash.score}/100)`);
    const minGap = god.score >= 80 ? 3.0 : 1.5;
    assert.ok(god.mlPrice >= trash.mlPrice * minGap,
      `${w}: godroll (${god.mlPrice}pl, score ${god.score}) debe superar al trash (${trash.mlPrice}pl) al menos ${minGap}× — revisa el anclaje a ventas reales`);
  }
});
