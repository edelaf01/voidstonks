import test from "node:test";
import assert from "node:assert/strict";
import { createMockEstCard, PESOS_BUENOS, armaConPerfil } from "./_helpers/riven-tasacion-dom.mjs";

const {
  parchearTasacion,
} = await import("../deploy/js/ui.components/rivens/ui_riven_appraisal.js");

const {
  calculateAdvancedPredictivePrice,
  calculateHybridTiers,
} = await import("../deploy/js/utils/rivens/riven_logic.js");

const {
  predictRivenMLBand,
  weaponPrecision,
} = await import("../deploy/js/utils/rivens/riven_ml.js");

const {
  precioJusto,
} = await import("../deploy/js/utils/rivens/riven_tasacion_visual.js");

test("parchearTasacion actualiza precio banda y medidores mediante fusion de ML", async () => {
  const { estCard, fp, fr, ml, ss, rs } = createMockEstCard();
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };
  const meta = {
    name: "Torid",
    official_median: 357,
    wfm_avg: 7966,
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 },
  };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const tiers = calculateHybridTiers(meta, null);
  const appraisal = calculateAdvancedPredictivePrice(meta, stats, tiers, 1.0, weaponData, null);

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData,
    meta,
    basePrice: 357,
    precioTipico: 357,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(fp.textContent.startsWith("~"), true);
  assert.equal(appraisal.fairLow <= appraisal.fairPrice && appraisal.fairPrice <= appraisal.fairHigh, true);
  assert.equal(fr.innerHTML.includes("plat-icon-inline"), true);
  assert.equal(fr.innerHTML.includes("tas-banda-marca"), true);
  assert.equal(ml.innerHTML.includes("tas-pips"), true);
  assert.equal(ss.innerHTML.includes("%"), true);
  assert.equal(ss.innerHTML.includes("gsc-mini-badge"), true);
  assert.equal(rs.innerHTML.includes("%"), true);
  assert.equal(rs.innerHTML.includes("gsc-mini-badge"), true);
});

test("parchearTasacion conserva estimacion de precio cuando falla la asignacion interna de puntuaciones", async () => {
  const { estCard, fp, ss, rs } = createMockEstCard();
  const weaponData = { name: "Gorgon", t: "Rifle", disposition: 1.0 };
  const meta = { name: "Gorgon", official_median: 200, wfm_avg: 400 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const appraisal = { adjustedScore: 70, estimatedValue: 200, suggestedMin: 100, suggestedMax: 400 };
  Object.defineProperty(appraisal, "statScore", {
    set() {
      throw new Error("x");
    },
    get() {
      return undefined;
    },
  });

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Gorgon",
    weaponData,
    meta,
    basePrice: 200,
    precioTipico: 200,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(ss.textContent, "—");
  assert.equal(rs.textContent, "—");
  assert.equal(fp.textContent.startsWith("~"), true);
});

test("parchearTasacion captura errores marca chips vacios sin alterar los calculados y muestra aviso", async () => {
  const { estCard, ml, ss, rs } = createMockEstCard();
  rs.textContent = "80%";
  const appraisal = { adjustedScore: 70 };

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData: null,
    meta: null,
    basePrice: 100,
    itemAttributes: null,
    isEs: true,
    conComparables: false,
  });

  assert.equal(ml.innerHTML.includes("Confianza no disponible"), true);
  assert.equal(ss.textContent, "—");
  assert.equal(rs.textContent, "80%");
});

test("parchearTasacion opera adecuadamente sin objeto meta partiendo de basePrice", async () => {
  const { estCard, fp } = createMockEstCard();
  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const appraisal = { adjustedScore: 70, estimatedValue: 200, suggestedMin: 100, suggestedMax: 400 };

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData,
    meta: null,
    basePrice: 200,
    precioTipico: 200,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.fairPrice > 0, true);
  assert.equal(fp.textContent.startsWith("~"), true);
});

test("parchearTasacion no intercambia heuristico y ml y traslada mape", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(false);
  const prec = await weaponPrecision(arma);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 90);
  const appraisal = { adjustedScore: 90, estimatedValue: band.p50 * 4, suggestedMin: 10, suggestedMax: 100000 };
  const basePrice = band.p50 * 100;

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice,
    precioTipico: basePrice,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.mlBand.confianza, "alta");

  const esperado = precioJusto({
    heuristico: band.p50 * 4,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 90,
    tipico: basePrice,
  }).justo;
  const invertido = precioJusto({
    heuristico: appraisal.mlBand.p50,
    ml: band.p50 * 4,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 90,
    tipico: basePrice,
  }).justo;

  assert.equal(appraisal.fairPrice, esperado);
  assert.notEqual(appraisal.fairPrice, invertido);
});

test("parchearTasacion traslada la confianza baja a precioJusto", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(true);
  const prec = await weaponPrecision(arma);
  const weaponData = { name: arma, t: "Rifle" };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 90);
  const appraisal = { adjustedScore: 90, estimatedValue: band.p50 * 4, suggestedMin: 10, suggestedMax: 100000 };
  const basePrice = band.p50 * 100;

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice,
    precioTipico: basePrice,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.mlBand.confianza, "baja");
  const esperado = precioJusto({
    heuristico: band.p50 * 4,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 90,
    tipico: basePrice,
  }).justo;
  const sinConfianza = precioJusto({
    heuristico: band.p50 * 4,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: undefined,
    puntuacion: 90,
    tipico: basePrice,
  }).justo;

  assert.equal(appraisal.fairPrice, esperado);
  assert.notEqual(appraisal.fairPrice, sinConfianza);
});

test("parchearTasacion traslada tipico y puntuacion aplicando el tope de rango", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(false);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 50);
  const appraisal = { adjustedScore: 50, estimatedValue: band.p50 * 2, suggestedMin: 10, suggestedMax: 100000 };
  const basePrice = Math.max(1, Math.round(band.p50 / 10));

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice,
    precioTipico: basePrice,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.mlBand.confianza, "alta");

  assert.equal(appraisal.fairPrice, Math.round(basePrice * 1.3));
});

test("parchearTasacion prioriza adjustedScore frente a statScore en precioJusto", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(false);
  const prec = await weaponPrecision(arma);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 90);
  const appraisal = { adjustedScore: 90, estimatedValue: band.p50 * 2, suggestedMin: 10, suggestedMax: 100000 };
  const basePrice = Math.max(1, Math.round(band.p50 / 10));

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice,
    precioTipico: basePrice,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.mlBand.confianza, "alta");

  assert.ok(appraisal.statScore.score < 85, "el caso solo discrimina con statScore bajo el tope");
  const esperado = precioJusto({
    heuristico: band.p50 * 2,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 90,
    tipico: basePrice,
  }).justo;
  assert.equal(appraisal.fairPrice, esperado);
  assert.ok(appraisal.fairPrice > Math.round(basePrice * 2.2));
});

test("parchearTasacion recurre a statScore cuando appraisal no incluye adjustedScore", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(false);
  const prec = await weaponPrecision(arma);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 90);
  const appraisal = { estimatedValue: band.p50 * 2, suggestedMin: 10, suggestedMax: 100000 };
  const basePrice = Math.max(1, Math.round(band.p50 / 10));

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice,
    precioTipico: basePrice,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(appraisal.mlBand.confianza, "alta");

  const esperado = precioJusto({
    heuristico: band.p50 * 2,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: appraisal.statScore.score,
    tipico: basePrice,
  }).justo;
  assert.equal(appraisal.fairPrice, esperado);
});

test("parchearTasacion muestra raya en statScore cuando meta es null pero conserva el objeto de rivenScores", async () => {
  const weaponName = "FixtureMetaNullTest";
  const weaponData = { name: weaponName, t: "Rifle" };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
  ];

  const { estCard: cardNull, ss: ssNull } = createMockEstCard();
  const appraisalNull = { adjustedScore: 70, estimatedValue: 200, suggestedMin: 100, suggestedMax: 400 };

  await parchearTasacion({
    estCard: cardNull,
    appraisal: appraisalNull,
    weaponName,
    weaponData,
    meta: null,
    basePrice: 100,
    precioTipico: 100,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(ssNull.innerHTML, "—");
  assert.equal(ssNull.innerHTML.includes("%"), false);
  assert.equal(ssNull.innerHTML.includes("gsc-mini-badge"), false);
  assert.ok(appraisalNull.statScore);
  assert.equal(typeof appraisalNull.statScore.score, "number");

  const { estCard: cardMeta, ss: ssMeta } = createMockEstCard();
  const appraisalMeta = { adjustedScore: 70, estimatedValue: 200, suggestedMin: 100, suggestedMax: 400 };
  const meta = { name: weaponName, official_median: 100, wfm_avg: 100 };

  await parchearTasacion({
    estCard: cardMeta,
    appraisal: appraisalMeta,
    weaponName,
    weaponData,
    meta,
    basePrice: 100,
    precioTipico: 100,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(ssMeta.innerHTML.includes("%"), true);
  assert.equal(ssMeta.innerHTML.includes("gsc-mini-badge"), true);
});

test("parchearTasacion con meta null y precioTipico null aplica tope usando el modelo y no basePrice", async () => {
  const { estCard } = createMockEstCard();
  const arma = await armaConPerfil(false);
  const prec = await weaponPrecision(arma);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 50);
  const appraisal = { adjustedScore: 50, estimatedValue: band.p50 * 2, suggestedMin: 10, suggestedMax: 100000 };

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice: 50,
    precioTipico: null,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  const esperado = precioJusto({
    heuristico: band.p50 * 2,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 50,
    tipico: null,
  }).justo;

  const conTipico50 = precioJusto({
    heuristico: band.p50 * 2,
    ml: appraisal.mlBand.p50,
    mape: prec.mape,
    confianza: appraisal.mlBand.confianza,
    puntuacion: 50,
    tipico: 50,
  }).justo;

  assert.equal(appraisal.fairPrice, esperado);
  assert.notEqual(appraisal.fairPrice, conTipico50);
});

test("parchearTasacion topa el precio justo sobre basePrice con suelo de 50 y sobre el ml solo cuando no hay precio tipico", async () => {
  const arma = await armaConPerfil(false);
  const weaponData = { name: arma, t: "Rifle", dynamic_weights: PESOS_BUENOS };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const band = await predictRivenMLBand({ name: arma, official_median: 300 }, stats, weaponData, null, 60);

  const { estCard: cardA, fp: fpA } = createMockEstCard();
  const appraisalA = { adjustedScore: 60, estimatedValue: band.p50 * 4, suggestedMin: 10, suggestedMax: 100000 };
  await parchearTasacion({
    estCard: cardA,
    appraisal: appraisalA,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice: 50,
    precioTipico: 25,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  assert.equal(appraisalA.fairPrice, 80);
  assert.notEqual(appraisalA.fairPrice, 40);
  assert.equal(fpA.textContent, "~80");
  assert.equal(cardA.querySelector("[data-fair-price]").textContent, "~80");

  const { estCard: cardB, fp: fpB } = createMockEstCard();
  const appraisalB = { adjustedScore: 60, estimatedValue: band.p50 * 4, suggestedMin: 10, suggestedMax: 100000 };
  await parchearTasacion({
    estCard: cardB,
    appraisal: appraisalB,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice: 50,
    precioTipico: null,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  const esperadoB = Math.round(band.p50 * 1.6);
  assert.equal(appraisalB.fairPrice, esperadoB);
  assert.notEqual(appraisalB.fairPrice, 80);
  assert.equal(fpB.textContent, `~${esperadoB}`);
  assert.equal(cardB.querySelector("[data-fair-price]").textContent, `~${esperadoB}`);

  const { estCard: cardC, fp: fpC } = createMockEstCard();
  const appraisalC = { adjustedScore: 60, estimatedValue: band.p50 * 4, suggestedMin: 10, suggestedMax: 100000 };
  await parchearTasacion({
    estCard: cardC,
    appraisal: appraisalC,
    weaponName: arma,
    weaponData,
    meta: null,
    basePrice: 200,
    precioTipico: 200,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });
  assert.equal(appraisalC.fairPrice, 320);
  assert.equal(fpC.textContent, "~320");
  assert.equal(cardC.querySelector("[data-fair-price]").textContent, "~320");
});

test("parchearTasacion retira data-sin-cifra y formatea precio con virgulilla tras parche correcto", async () => {
  const { estCard, fp } = createMockEstCard();
  fp.textContent = "…";
  fp.setAttribute("data-sin-cifra", "");
  assert.equal(fp.getAttribute("data-sin-cifra"), "");

  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };
  const meta = {
    name: "Torid",
    official_median: 357,
    wfm_avg: 7966,
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 },
  };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const tiers = calculateHybridTiers(meta, null);
  const appraisal = calculateAdvancedPredictivePrice(meta, stats, tiers, 1.0, weaponData, null);

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData,
    meta,
    basePrice: 357,
    precioTipico: 357,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(fp.textContent.startsWith("~"), true);
  assert.equal(fp.getAttribute("data-sin-cifra"), null);
});

test("parchearTasacion conserva la confianza si el chip de mercado falla", async () => {
  const { estCard, fp, ml, mk } = createMockEstCard();
  let tocado = false;
  Object.defineProperty(mk, "style", {
    configurable: true,
    get() {
      tocado = true;
      throw new Error("mercado roto");
    },
  });

  const weaponData = { name: "Torid", t: "Rifle", disposition: 1.4 };
  const meta = {
    name: "Torid",
    official_median: 357,
    wfm_avg: 7966,
    de_rerolled: { median: 450, pop: 12, stddev: 300, max_price: 3000 },
    de_unrolled: { median: 357, pop: 8 },
  };
  const stats = [
    { name: "Critical Chance", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Critical Damage", value: 120, isPositive: true, minIdeal: 50, maxIdeal: 150 },
    { name: "Zoom", value: 30, isPositive: false, minIdeal: 20, maxIdeal: 60 },
  ];
  const tiers = calculateHybridTiers(meta, null);
  const appraisal = calculateAdvancedPredictivePrice(meta, stats, tiers, 1.0, weaponData, null);

  await parchearTasacion({
    estCard,
    appraisal,
    weaponName: "Torid",
    weaponData,
    meta,
    basePrice: 357,
    precioTipico: 357,
    itemAttributes: stats,
    isEs: true,
    conComparables: false,
  });

  assert.equal(tocado, true);
  assert.equal(ml.innerHTML.includes("Confianza no disponible"), false);
  assert.equal(/Confianza (alta|media|baja)|Sin historial suficiente/.test(ml.innerHTML), true);
  assert.equal(fp.textContent.startsWith("~"), true);
});

test("parchearTasacion en error exterior pone raya en precio si estaba pendiente y conserva cifra si ya existia", async () => {
  const { estCard: cardPuntos, fp: fpPuntos, ml: mlPuntos } = createMockEstCard();
  fpPuntos.textContent = "…";
  await parchearTasacion({
    estCard: cardPuntos,
    appraisal: { adjustedScore: 70 },
    weaponName: "Torid",
    weaponData: null,
    meta: null,
    basePrice: 100,
    precioTipico: 100,
    itemAttributes: null,
    isEs: true,
    conComparables: false,
  });
  assert.equal(fpPuntos.textContent, "—");
  assert.equal(mlPuntos.innerHTML.includes("Confianza no disponible"), true);

  const { estCard: cardCifra, fp: fpCifra, ml: mlCifra } = createMockEstCard();
  fpCifra.textContent = "~120";
  await parchearTasacion({
    estCard: cardCifra,
    appraisal: { adjustedScore: 70 },
    weaponName: "Torid",
    weaponData: null,
    meta: null,
    basePrice: 100,
    precioTipico: 100,
    itemAttributes: null,
    isEs: true,
    conComparables: false,
  });
  assert.equal(fpCifra.textContent, "~120");
  assert.equal(mlCifra.innerHTML.includes("Confianza no disponible"), true);
});
