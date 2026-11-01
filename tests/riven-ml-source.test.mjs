import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { state } from "../deploy/js/state.js";
import { RIVEN_DISPOSITION } from "../deploy/js/config.js";
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
const TORID = { name: "Torid", official_median: 357, wfm_avg: 7966, de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 }, de_unrolled: { median: 357, pop: 8 } };
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

test("un arma sin datos de WFM tasa con el registro de DE10", async () => {
  const band = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
  assert.equal(band.fuente, "de10");
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
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  try {
    delete nt.prima_de10;
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(band.p50, 206);
    const otra = await N.predictRivenMLBand({ ...LARKSPUR, de_rerolled: { ...LARKSPUR.de_rerolled, median: 900 } }, STATS, LARKSPUR, null, 75);
    assert.equal(otra.p50, band.p50);
  } finally {
    nt.prima_de10 = primaPrevia;
  }
});

test("cambiar la fila de de10 de la familia mueve el precio", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  try {
    delete nt.prima_de10;
    const de10 = await NT.cargarDe10();
    const filaOrig = [...de10.familias.larkspur];
    try {
      de10.familias.larkspur = [filaOrig[0] + 1, ...filaOrig.slice(1)];
      const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
      assert.equal(band.p50, 559);
    } finally {
      de10.familias.larkspur = filaOrig;
    }
    const restaurado = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(restaurado.p50, 206);
  } finally {
    nt.prima_de10 = primaPrevia;
  }
});

test("un arma cortada tasa con el registro de DE y su suelo", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  try {
    delete nt.prima_de10;
    assert.equal(NT.nombreArma(nt, "Torid"), null);
    const de10 = await NT.cargarDe10();
    const fila = NT.filaDe10(de10, "Torid", TORID.de_rerolled);
    const nivel = NT.nivelSinWfm(nt, "Torid", fila);
    const reg = NT.registroSinWfm(nt, nivel, RIVEN_DISPOSITION, "Rifle");
    assert.equal(reg.nivel, nivel);

    const band = await N.predictRivenMLBand(TORID, STATS, TORID, null, 75);
    assert.equal(band.fuente, "de10");
    assert.equal(band.p50, 895);
    assert.ok(band.p25 >= band.floor);

    const buena = [
      { name: "Critical Chance", value: 150, isPositive: true, minIdeal: 50, maxIdeal: 150 },
      { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
      { name: "Multishot", value: 100, isPositive: true, minIdeal: 50, maxIdeal: 150 },
      { name: "Zoom", value: 40, isPositive: false, minIdeal: 20, maxIdeal: 60 }
    ];
    const bandaBuena = await N.predictRivenMLBand(TORID, buena, TORID, null, 90);
    assert.equal(bandaBuena.fuente, "de10");
    assert.equal(bandaBuena.p95, 4428);
  } finally {
    nt.prima_de10 = primaPrevia;
  }
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

test("sin prima_de10 en el modelo la tasación no cambia", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  try {
    delete nt.prima_de10;
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(band.p50, 206);
    assert.equal(band.fuente, "de10");
  } finally {
    nt.prima_de10 = primaPrevia;
  }
});

test("la prima de de10 se suma por tramo de pop10", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  const de10 = await NT.cargarDe10();
  const orig = [...de10.familias.larkspur];
  const PRIMA = { cortes: [3, 6, 12], valores: [0, 0.1, 0.2, 0.3] };
  try {
    nt.prima_de10 = PRIMA;
    for (const [pop10, valor] of [[3.88, 0.1], [8, 0.2], [20, 0.3]]) {
      de10.familias.larkspur = [orig[0], orig[1], orig[2], pop10, orig[4]];
      const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
      assert.equal(band.fuente, "de10");
      assert.ok(Math.abs(band.p50 - 206 * Math.exp(valor)) <= 1.5);
      assert.ok(band.p25 <= band.p50 && band.p50 <= band.p80 && band.p80 <= band.p90 && band.p90 <= band.p95);
    }
  } finally {
    nt.prima_de10 = primaPrevia;
    de10.familias.larkspur = orig;
  }
});

test("el techo ln max10 sigue mandando con prima", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  const de10 = await NT.cargarDe10();
  const orig = [...de10.familias.larkspur];
  try {
    nt.prima_de10 = { cortes: [3, 6, 12], valores: [0, 0.3, 0.3, 0.3] };
    de10.familias.larkspur = [orig[0], orig[1], 250, orig[3], orig[4]];
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(band.fuente, "de10");
    assert.equal(band.p50, 250);
    assert.equal(band.p95, 250);
  } finally {
    nt.prima_de10 = primaPrevia;
    de10.familias.larkspur = orig;
  }
});

test("la prima no toca las fuentes modelo ni curva", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  const de10 = await NT.cargarDe10();
  const orig = [...de10.familias.larkspur];
  const sinWfm = nt.sin_wfm;
  const prima = { cortes: [0, 3, 6, 12], valores: [0.5, 0.5, 0.5, 0.5, 0.5] };
  try {
    delete nt.prima_de10;
    de10.familias.larkspur = [orig[0], orig[1], orig[2], 2, orig[4]];
    const a0 = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(a0.fuente, "modelo");
    nt.prima_de10 = prima;
    const a1 = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(a1.fuente, "modelo");
    assert.equal(a1.p25, a0.p25);
    assert.equal(a1.p50, a0.p50);
    assert.equal(a1.p80, a0.p80);
    assert.equal(a1.p90, a0.p90);
    assert.equal(a1.p95, a0.p95);

    delete nt.prima_de10;
    de10.familias.larkspur = orig;
    delete nt.sin_wfm;
    const b0 = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
    assert.equal(b0.fuente, "curva");
    nt.prima_de10 = prima;
    const b1 = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
    assert.equal(b1.fuente, "curva");
    assert.equal(b1.p25, b0.p25);
    assert.equal(b1.p50, b0.p50);
    assert.equal(b1.p80, b0.p80);
    assert.equal(b1.p90, b0.p90);
    assert.equal(b1.p95, b0.p95);
  } finally {
    nt.prima_de10 = primaPrevia;
    de10.familias.larkspur = orig;
    nt.sin_wfm = sinWfm;
  }
});

test("un arma sin fila de de10 y pop10 bajo no lleva prima", async () => {
  const nt = await NT.cargarNivelTirada();
  const primaPrevia = nt.prima_de10;
  try {
    delete nt.prima_de10;
    const sinPrima = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
    nt.prima_de10 = { cortes: [3, 6, 12], valores: [0, 0.42, 0.6, 0.79] };
    const conPrima = await N.predictRivenMLBand(SIN_NIVEL, STATS, SIN_NIVEL, null, 75);
    assert.equal(sinPrima.fuente, "de10");
    assert.equal(conPrima.fuente, "de10");
    assert.equal(conPrima.p25, sinPrima.p25);
    assert.equal(conPrima.p50, sinPrima.p50);
    assert.equal(conPrima.p80, sinPrima.p80);
    assert.equal(conPrima.p90, sinPrima.p90);
    assert.equal(conPrima.p95, sinPrima.p95);
  } finally {
    nt.prima_de10 = primaPrevia;
  }
});
