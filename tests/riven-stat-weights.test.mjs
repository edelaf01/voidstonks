// El daño de una negativa sale del PESO del stat en ESA arma, no de listas de nombres en duro.
// Estos tests fijan la propiedad que hacía falta para poder retirarlas: el mismo stat como
// negativa debe brickear donde el arma lo valora y ser inocuo donde no.
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

// Un arma que vive del multishot vs otra a la que le da igual: MISMA negativa, MISMO roll.
const PESA = { "Multishot": 1.0, "Critical Chance": 1.0, "Critical Damage": 1.0, "Zoom": 0.01, "Recoil": 0.05 };
const NO_PESA = { "Multishot": 0.01, "Critical Chance": 1.0, "Critical Damage": 1.0, "Zoom": 0.01, "Recoil": 0.05 };
const ROLL = [S("Critical Chance", 150), S("Critical Damage", 150), S("Multishot", 40, false)];

test("la negativa brickea solo donde el arma valora ese stat", () => {
  const pesa = tasar(PESA, ROLL);
  const noPesa = tasar(NO_PESA, ROLL);
  assert.ok(pesa.adjustedScore <= 20,
    `-Multishot en un arma que lo valora (1.0) debe brickear; score=${pesa.adjustedScore}`);
  assert.ok(noPesa.adjustedScore > 50,
    `-Multishot en un arma a la que le da igual (0.01) NO debe brickear; score=${noPesa.adjustedScore}`);
  assert.ok(noPesa.estimatedValue > pesa.estimatedValue,
    `misma negativa: debe valer más donde el stat no importa (${noPesa.estimatedValue} vs ${pesa.estimatedValue})`);
});

test("un stat irrelevante como negativa no hunde el precio", () => {
  const conZoom = tasar(PESA, [S("Critical Chance", 150), S("Critical Damage", 150), S("Zoom", 40, false)]);
  assert.ok(conZoom.adjustedScore > 50, `-Zoom (peso 0.01) no debe brickear; score=${conZoom.adjustedScore}`);
});

test("recoil deja de ser inofensivo por decreto: si el arma lo valora, penaliza", () => {
  // El regex viejo (/zoom|recoil|vs |faction/) forzaba 0.05 SIEMPRE. Hay armas con recoil a 0.65.
  const RECOIL_IMPORTA = { "Recoil": 1.0, "Critical Chance": 1.0, "Critical Damage": 1.0 };
  const RECOIL_DA_IGUAL = { "Recoil": 0.02, "Critical Chance": 1.0, "Critical Damage": 1.0 };
  const roll = [S("Critical Chance", 150), S("Critical Damage", 150), S("Recoil", 40, false)];
  const importa = tasar(RECOIL_IMPORTA, roll);
  const daIgual = tasar(RECOIL_DA_IGUAL, roll);
  assert.ok(importa.estimatedValue < daIgual.estimatedValue,
    `-Recoil debe penalizar donde el arma lo valora (${importa.estimatedValue} vs ${daIgual.estimatedValue})`);
});

test("el daño por facción tampoco es inofensivo por decreto", () => {
  const IMPORTA = { "Damage Vs Corpus": 1.0, "Critical Chance": 1.0, "Critical Damage": 1.0 };
  const DA_IGUAL = { "Damage Vs Corpus": 0.05, "Critical Chance": 1.0, "Critical Damage": 1.0 };
  const roll = [S("Critical Chance", 150), S("Critical Damage", 150), S("Damage Vs Corpus", 40, false)];
  assert.ok(tasar(IMPORTA, roll).estimatedValue < tasar(DA_IGUAL, roll).estimatedValue,
    "una facción que el arma valora debe penalizar más que una que no");
});

test("no quedan listas de stats en duro en la lógica de negativas", () => {
  // Se mira el CÓDIGO, no los comentarios: los nombres viejos siguen citados en la explicación
  // de por qué se retiraron, y eso debe seguir permitido.
  const sinComentarios = (f) => fs.readFileSync(path.resolve(__dirname, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const src = sinComentarios("../deploy/js/utils/rivens/riven_logic.js");
  for (const viejo of ["universalCriticalNegs", "brickNegs", "mitigableNegs"]) {
    assert.ok(!src.includes(viejo),
      `${viejo} volvió a riven_logic.js: el daño de la negativa debe salir del peso por arma`);
  }
  assert.ok(!/zoom\|recoil/.test(sinComentarios("../deploy/js/utils/rivens/riven_ml.js")),
    "el regex de negativas 'inofensivas' volvió a riven_ml.js: mentía en las armas que sí valoran esos stats");
});
