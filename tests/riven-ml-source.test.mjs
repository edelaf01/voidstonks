import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { state } from "../deploy/js/state.js";
import { renderMlChip } from "../deploy/js/ui.components/rivens/ui_riven_appraisal.js";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

let fallarDe10 = false;
globalThis.fetch = async (url) => {
  const base = url.split("/").pop().split("?")[0];
  if (base === "de10.json" && fallarDe10) throw new Error("mock de10 falla");
  const ruta = base === "de10.json"
    ? new URL("./fixtures/de10_fijo.json", import.meta.url)
    : new URL(`../deploy/assets/ml/${base}`, import.meta.url);
  if (!fs.existsSync(ruta)) return { ok: false, status: 404, json: async () => ({}) };
  const buf = fs.readFileSync(ruta);
  return { ok: true, json: async () => JSON.parse(buf.toString()) };
};

state.currentLang = "es";

const N = await import("../deploy/js/utils/rivens/riven_ml.js");
const NT = await import("../deploy/js/utils/rivens/riven_nivel.js");

const STATS = [
  { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
  { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
  { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 }
];

const LARKSPUR = { name: "Larkspur", official_median: 357, wfm_avg: 7966, de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357, pop: 8 } };
const TORID = { name: "Torid", d: 1.3, official_median: 357, wfm_avg: 7966, de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357, pop: 8 } };
const SIN_NIVEL = { name: "SinNivelTest", official_median: 135, wfm_avg: 307, de_rerolled: { median: 90, pop: 1, stddev: 0, max_price: 90 }, de_unrolled: { median: 135, pop: 1 } };

test("con de10 que falla al cargar la tasación cae a la curva", async () => {
  fallarDe10 = true;
  try {
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(band.fuente, "curva");
    assert.ok(band.p25 <= band.p50 && band.p50 <= band.p80 && band.p80 <= band.p90 && band.p90 <= band.p95);
  } finally {
    fallarDe10 = false;
  }
});

test("un arma con datos de WFM tasa con el modelo de nivel y tirada", async () => {
  const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(band.fuente, "de10");
  assert.ok(Number.isFinite(band.p50));
  assert.ok(band.p50 > 0);
});

test("un arma sin datos de WFM cae a la curva anclada a DE", async () => {
  const band = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
  assert.equal(band.fuente, "curva");
  assert.ok(band.p50 > 0);
});

test("la banda sale ordenada por las dos vías", async () => {
  const b1 = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.ok(b1.p25 <= b1.p50);
  assert.ok(b1.p50 <= b1.p80);
  assert.ok(b1.p80 <= b1.p90);
  assert.ok(b1.p90 <= b1.p95);

  const b2 = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
  assert.ok(b2.p25 <= b2.p50);
  assert.ok(b2.p50 <= b2.p80);
  assert.ok(b2.p80 <= b2.p90);
  assert.ok(b2.p90 <= b2.p95);
});

test("un arma conocida tasa con su fila de DE de 10 semanas y no con el DE del día", async () => {
  const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(band.p50, 211);
  const otra = await N.predictRivenMLBand({ ...LARKSPUR, de_rerolled: { ...LARKSPUR.de_rerolled, median: 900 } }, STATS, LARKSPUR, null, 75);
  assert.equal(otra.p50, band.p50);
});

test("cambiar la fila de de10 de la familia mueve el precio", async () => {
  const de10 = await NT.cargarDe10();
  const filaOrig = [...de10.familias.larkspur];
  try {
    de10.familias.larkspur = [filaOrig[0] + 1, ...filaOrig.slice(1)];
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(band.p50, 573);
  } finally {
    de10.familias.larkspur = filaOrig;
  }
  const restaurado = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(restaurado.p50, 211);
});

test("un arma cortada tasa con el registro de DE y su suelo", async () => {
  const nt = await NT.cargarNivelTirada();
  assert.equal(NT.nombreArma(nt, "Torid"), null);
  const de10 = await NT.cargarDe10();
  const fila = NT.filaDe10(de10, "Torid", TORID.de_rerolled);
  const nivel = NT.nivelSinWfm(nt, "Torid", fila);
  const reg = NT.registroSinWfm(nt, nivel, 1.3, "Rifle");
  assert.equal(reg.nivel, nivel);

  const band = await N.predictRivenMLBand(TORID, STATS, TORID, null, 75);
  assert.equal(band.fuente, "de10");
  assert.equal(band.p50, 886);
  assert.ok(band.p25 >= band.floor);

  const buena = [
    { name: "Critical Chance", value: 150, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Multishot", value: 100, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 40, isPositive: false, minIdeal: 20, maxIdeal: 60 }
  ];
  const bandaBuena = await N.predictRivenMLBand(TORID, buena, TORID, null, 90);
  assert.equal(bandaBuena.fuente, "de10");
  assert.equal(bandaBuena.p95, 4043);
});

test("para un arma con DE vivo ningún precio baja del suelo floor", async () => {
  const bandTorid = await N.predictRivenMLBand(TORID, STATS, TORID, null, 75);
  assert.ok(bandTorid.floor > 0);
  const preciosTorid = [bandTorid.p25, bandTorid.p50, bandTorid.p80, bandTorid.p90, bandTorid.p95];
  assert.ok(preciosTorid.every(p => p >= bandTorid.floor));

  const bandLark = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.ok(bandLark.floor > 0);
  const preciosLark = [bandLark.p25, bandLark.p50, bandLark.p80, bandLark.p90, bandLark.p95];
  assert.ok(preciosLark.every(p => p >= bandLark.floor));
});

test("un riven sin rolar ya no lleva prima", async () => {
  const b0 = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, 0, 75);
  const bn = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(b0.p25, bn.p25);
  assert.equal(b0.p50, bn.p50);
  assert.equal(b0.p80, bn.p80);
  assert.equal(b0.p90, bn.p90);
  assert.equal(b0.p95, bn.p95);

  const c0 = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, 0, 75);
  const cn = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
  assert.equal(c0.p25, cn.p25);
  assert.equal(c0.p50, cn.p50);
  assert.equal(c0.p80, cn.p80);
  assert.equal(c0.p90, cn.p90);
  assert.equal(c0.p95, cn.p95);
});

test("una tirada alta vale más que una baja en el modelo", async () => {
  const statsHigh = [
    { name: "Critical Chance", value: 400, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 400, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 5, isPositive: false, minIdeal: 20, maxIdeal: 60 }
  ];
  const statsLow = [
    { name: "Critical Chance", value: 1, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 1, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 5, isPositive: false, minIdeal: 20, maxIdeal: 60 }
  ];
  const high = await N.predictRivenMLBand(LARKSPUR, statsHigh, LARKSPUR, null, null);
  const low = await N.predictRivenMLBand(LARKSPUR, statsLow, LARKSPUR, null, null);
  assert.ok(high.p50 > low.p50);
});

test("renderMlChip muestra el rótulo según la fuente y el idioma", () => {
  const elem = { style: {}, innerHTML: "", title: "" };
  const estCard = { querySelector: (sel) => sel === "[data-ml-line]" ? elem : null };
  const bandDe10 = { fuente: "de10", confianza: "alta", p25: 100, p50: 200, p80: 300, p95: 500 };
  const bandCurva = { fuente: "curva", confianza: "alta", p25: 100, p50: 200, p80: 300, p95: 500 };

  renderMlChip(estCard, null, bandDe10, true);
  assert.ok(elem.innerHTML.startsWith("DE 10 sem:"));

  renderMlChip(estCard, null, bandDe10, false);
  assert.ok(elem.innerHTML.startsWith("DE 10 wk:"));

  renderMlChip(estCard, null, bandCurva, true);
  assert.ok(elem.innerHTML.startsWith("IA:"));

  renderMlChip(estCard, null, bandCurva, false);
  assert.ok(elem.innerHTML.startsWith("AI:"));
});
