// El precio sale del MODELO entrenado (fuente "ml") solo en las armas con calibrado ask->venta
// fiable; el resto usa la curva anclada a ventas de DE (fuente "curva").
//
// Este test necesita fichero propio: riven_ml.js cachea el bundle en la primera carga (_ml), así
// que inyectar un cal.venta distinto desde otro test que ya lo cargó no tendría efecto.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_ROOT = path.resolve(__dirname, "../deploy/assets/ml");

// Simula un bundle YA reentrenado: "Torid" con ancla fiable, "Amphis" sin ella.
const VENTA = {
  Torid: { factor: 0.09, de_med: 450, ask_med: 5000, pop: 12, fiable: true },
  Amphis: { factor: 1.0, de_med: 90, ask_med: 307, pop: 1, fiable: false },
};

globalThis.fetch = async (url) => {
  const filename = path.basename(String(url).split("?")[0]);
  const filepath = path.join(ML_ROOT, filename);
  if (!fs.existsSync(filepath)) throw new Error(`File not found: ${filepath}`);
  const json = JSON.parse(fs.readFileSync(filepath, "utf8"));
  if (filename === "calibracion_por_arma.json") {
    return { ok: true, json: async () => ({ ...json, venta: VENTA }) };
  }
  return { ok: true, json: async () => json };
};

const { state } = await import("../deploy/js/state.js");
const ML = await import("../deploy/js/utils/rivens/riven_ml.js");
state.currentLang = "es";

const STATS = [
  { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
  { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
  { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
];

test("un arma con calibrado fiable tasa con el modelo entrenado", async () => {
  const w = { name: "Torid", official_median: 357, wfm_avg: 7966,
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 } };
  const b = await ML.predictRivenMLBand(w, STATS, w, null, 75);
  assert.equal(b.fuente, "ml", "con ancla fiable el precio debe venir del modelo");
  assert.ok(Number.isFinite(b.p50) && b.p50 > 0, `p50 inválido: ${b.p50}`);
});

test("un arma sin calibrado fiable cae a la curva anclada a DE", async () => {
  const w = { name: "Amphis", official_median: 135, wfm_avg: 307,
    de_rerolled: { median: 90, pop: 1, stddev: 0, max_price: 90 },
    de_unrolled: { median: 135, pop: 1 } };
  const b = await ML.predictRivenMLBand(w, STATS, w, null, 75);
  assert.equal(b.fuente, "curva", "sin ancla fiable NO se debe usar el modelo (sigue en escala de ask)");
  assert.ok(Number.isFinite(b.p50) && b.p50 > 0, `p50 inválido: ${b.p50}`);
});

test("la banda de cuantiles sale ordenada por las dos vías", async () => {
  for (const [name, w] of Object.entries({
    Torid: { name: "Torid", official_median: 357, wfm_avg: 7966,
      de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357 } },
    Amphis: { name: "Amphis", official_median: 135, wfm_avg: 307,
      de_rerolled: { median: 90, pop: 1, stddev: 0, max_price: 90 }, de_unrolled: { median: 135 } },
  })) {
    const b = await ML.predictRivenMLBand(w, STATS, w, null, 75);
    assert.ok(b.p25 <= b.p50 && b.p50 <= b.p80 && b.p80 <= b.p90 && b.p90 <= b.p95,
      `${name} (${b.fuente}): banda desordenada ${b.p25}/${b.p50}/${b.p80}/${b.p90}/${b.p95}`);
  }
});

test("sin cal.venta en el bundle no se usa el modelo (compat con el bundle viejo)", async () => {
  // Antes del primer reentreno calibrado el bundle NO trae `venta`: el tasador debe seguir
  // funcionando por la curva en vez de tasar con un modelo entrenado en asks.
  const vacio = await import("../deploy/js/utils/rivens/riven_ml.js");
  const ml = await vacio.loadRivenML();
  const original = ml.venta;
  try {
    ml.venta = {};
    const w = { name: "Torid", official_median: 357, wfm_avg: 7966,
      de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357 } };
    const b = await vacio.predictRivenMLBand(w, STATS, w, null, 75);
    assert.equal(b.fuente, "curva", "sin `venta` el modelo no debe fijar el precio");
  } finally {
    ml.venta = original;
  }
});
