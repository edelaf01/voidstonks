import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { state } from "../deploy/js/state.js";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

globalThis.fetch = async (url) => {
  const base = url.split("/").pop().split("?")[0];
  const buf = fs.readFileSync(new URL(`../deploy/assets/ml/${base}`, import.meta.url));
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

test("un arma con datos de WFM tasa con el modelo de nivel y tirada", async () => {
  const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(band.fuente, "ml");
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

test("un arma con nivel de WFM tasa sobre su nivel y no sobre DE", async () => {
  const nt = await NT.cargarNivelTirada();
  const { positivos, negativo } = NT.atributosAWfm(STATS, 0);
  const r = NT.residuosTirada(nt, "Larkspur", positivos, negativo);
  const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
  assert.equal(band.p50, Math.round(Math.exp(nt.armas.Larkspur.nivel + r[1])));
  const otra = await N.predictRivenMLBand({ ...LARKSPUR, de_rerolled: { ...LARKSPUR.de_rerolled, median: 900 } }, STATS, LARKSPUR, null, 75);
  assert.equal(otra.p50, band.p50);
});

test("el índice de DE mueve el nivel de las armas conocidas", async () => {
  const nt = await NT.cargarNivelTirada();
  const { positivos, negativo } = NT.atributosAWfm(STATS, 0);
  const r = NT.residuosTirada(nt, "Larkspur", positivos, negativo);
  const metas = {};
  for (const [arma, ref] of Object.entries(nt.sin_wfm.de_ref)) {
    metas[arma] = { de_rerolled: { median: ref * 2, pop: 5 } };
  }
  try {
    globalThis.dynamicMetaStats = { data: metas };
    const band = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.ok(Math.abs(band.p50 - Math.round(Math.exp(nt.armas.Larkspur.nivel + Math.log(2) + r[1]))) <= 1);
    globalThis.dynamicMetaStats = metas;
    const plano = await N.predictRivenMLBand(LARKSPUR, STATS, LARKSPUR, null, 75);
    assert.equal(plano.p50, band.p50);
  } finally {
    delete globalThis.dynamicMetaStats;
  }
});

test("un arma cortada tasa con el registro de DE y su suelo", async () => {
  const nt = await NT.cargarNivelTirada();
  assert.equal(NT.nombreArma(nt, "Torid"), null);
  const { positivos, negativo } = NT.atributosAWfm(STATS, 0);
  const reg = NT.registroSinWfm(nt, 450, 1.3, null, 12);
  assert.ok(Math.abs(reg.nivel - Math.log(450)) < 1e-12);
  const r = NT.residuosTirada(nt, "Torid", positivos, negativo, reg);
  const band = await N.predictRivenMLBand(TORID, STATS, TORID, null, 75);
  assert.equal(band.fuente, "ml");
  assert.equal(band.p50, Math.max(band.floor, Math.round(Math.exp(reg.nivel + (r[1] > 0 ? r[1] * reg.cola : r[1])))));
  assert.ok(band.p25 >= band.floor);

  const buena = [
    { name: "Critical Chance", value: 150, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Multishot", value: 100, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 40, isPositive: false, minIdeal: 20, maxIdeal: 60 }
  ];
  const { positivos: pb, negativo: nb } = NT.atributosAWfm(buena, 0);
  const rb = NT.residuosTirada(nt, "Torid", pb, nb, reg);
  const bandaBuena = await N.predictRivenMLBand(TORID, buena, TORID, null, 90);
  assert.ok(rb[4] > 0);
  assert.equal(bandaBuena.p95, Math.max(bandaBuena.floor, Math.round(Math.exp(reg.nivel + rb[4] * reg.cola))));
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
