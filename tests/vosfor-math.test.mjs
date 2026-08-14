// Vosfor calculator probabilities
// users cannot verify "72.3 %" at a glance before spending 12,000 Vosfor, so calculations extracted from
// 2600 lines of UI render are pinned here

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binomialGe,
  formatProbPct,
  targetSimProbabilities,
  calculateR5Realism,
} from "../deploy/js/utils/vosfor_math.js";

const casi = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("con menos intentos que éxitos pedidos la probabilidad es 0", () => {
  assert.equal(binomialGe(5, 10, 0.5), 0);
});

// closed-form cases: if these fail, the binomial recurrence is broken
test("coincide con la fórmula cerrada en los casos que se pueden calcular a mano", () => {
  // at least 1 success in n attempts = 1 - (1-p)^n
  casi(binomialGe(10, 1, 0.2), 1 - 0.8 ** 10);
  casi(binomialGe(3, 1, 0.5), 1 - 0.5 ** 3);
  // all attempts succeed = p^n
  casi(binomialGe(4, 4, 0.5), 0.5 ** 4);
  // at least 2 of 3 with p=0.5 -> 4/8
  casi(binomialGe(3, 2, 0.5), 0.5);
});

test("la probabilidad siempre cae entre 0 y 1", () => {
  for (const [n, k, p] of [[3000, 21, 0.01], [100, 50, 0.9], [21, 21, 0.999], [1, 1, 1]]) {
    const r = binomialGe(n, k, p);
    assert.ok(r >= 0 && r <= 1, `binomialGe(${n},${k},${p}) = ${r}`);
    assert.ok(Number.isFinite(r), "no puede salir NaN ni Infinity");
  }
});

// computing combinations individually overflows: for ~3000 rolls of a typical target, C(3000, 21) exceeds
// double precision and yields NaN
test("aguanta las miles de tiradas de un objetivo real sin desbordar", () => {
  const r = binomialGe(3000, 21, 0.05 / 8);
  assert.ok(Number.isFinite(r), "NaN significa combinatoria desbordada");
  assert.ok(r > 0 && r < 1);
});

// p = 1 happens with single-arcane rarity packs: without the divisor floor, recurrence divides by zero
test("una probabilidad de 1 no rompe la recurrencia", () => {
  const r = binomialGe(10, 5, 1);
  assert.ok(Number.isFinite(r), `salió ${r}`);
  casi(r, 1, 1e-6);
});

test("más intentos nunca bajan la probabilidad", () => {
  let anterior = 0;
  for (const n of [21, 50, 100, 500, 3000]) {
    const r = binomialGe(n, 21, 0.01);
    assert.ok(r >= anterior, `con ${n} tiradas bajó: ${r} < ${anterior}`);
    anterior = r;
  }
});

// rounding 99.96 to "100.0" promises non-existent certainty and 0.04 to "0.0" implies impossibility: both
// bounds are flagged explicitly
test("los extremos se marcan, no se redondean a certeza", () => {
  assert.equal(formatProbPct(0.9996), ">99.9");
  assert.equal(formatProbPct(0.0004), "<0.1");
  assert.equal(formatProbPct(1), "100.0", "1 exacto sí es certeza");
  assert.equal(formatProbPct(0), "0.0");
});

test("el resto se formatea con un decimal", () => {
  assert.equal(formatProbPct(0.5), "50.0");
  assert.equal(formatProbPct(0.723), "72.3");
});

/** parses formatted percentage including boundary markers (">99.9" / "<0.1") */
const pct = (s) => (s === ">99.9" ? 99.95 : s === "<0.1" ? 0.05 : Number.parseFloat(s));

// pack drop rate is per RARITY, not per arcane: it splits across arcanes sharing that tier, otherwise an
// 8-legendary pack promises 8x real odds
test("la probabilidad del pack se reparte entre los arcanos de esa rareza", () => {
  const solo = targetSimProbabilities(10, 0.05, 1, 1);
  const entreOcho = targetSimProbabilities(10, 0.05, 8, 1);
  assert.ok(pct(solo.pAtLeastOnePct) > pct(entreOcho.pAtLeastOnePct),
    `${solo.pAtLeastOnePct} debería superar a ${entreOcho.pAtLeastOnePct}`);
});

test("cada pack son 3 tiradas, no una", () => {
  // 10 packs at p=0.05 and a single arcane: 30 rolls, not 10
  const r = targetSimProbabilities(10, 0.05, 1, 1);
  assert.equal(r.pAtLeastOnePct, formatProbPct(1 - 0.95 ** 30));
});

test("pedir más copias nunca sube la probabilidad", () => {
  const una = pct(targetSimProbabilities(100, 0.15, 3, 1).pTargetPct);
  const veintiuna = pct(targetSimProbabilities(100, 0.15, 3, 21).pTargetPct);
  assert.ok(veintiuna <= una, `21 copias (${veintiuna}) no puede ser más fácil que 1 (${una})`);
});

test("sin arcanos de esa rareza no se divide por cero", () => {
  const r = targetSimProbabilities(10, 0.05, 0, 1);
  assert.ok(!r.pAtLeastOnePct.includes("NaN"), r.pAtLeastOnePct);
});

const pack = {
  cost: { vosfor: 200 },
  rolls: [{ LEGENDARY: 0.05, RARE: 0.15, UNCOMMON: 0.3, COMMON: 0.5 }],
  items: ["leg1", "leg2", "rare1", "unc1", "com1"],
};
const data = {
  arcanes: {
    leg1: { rarity: "LEGENDARY" }, leg2: { rarity: "LEGENDARY" },
    rare1: { rarity: "RARE" }, unc1: { rarity: "UNCOMMON" }, com1: { rarity: "COMMON" },
  },
};

// showing zeroes would look like meaningful data: with less Vosfor than one pack costs there is nothing to
// simulate
test("con menos Vosfor del que cuesta un pack no se simula nada", () => {
  assert.equal(calculateR5Realism(199, pack, data), null);
  assert.equal(calculateR5Realism(0, pack, data), null);
  assert.equal(calculateR5Realism(5000, null, data), null);
  assert.equal(calculateR5Realism(5000, pack, null), null);
});

test("las tiradas salen de dividir el Vosfor entre el coste, y cada pack son 3", () => {
  const r = calculateR5Realism(1000, pack, data);
  assert.equal(r.pulls, 5, "1000 / 200");
  assert.equal(r.totalRolls, 15);

  // extra Vosfor for partial packs is ignored: only whole packs count
  assert.equal(calculateR5Realism(1199, pack, data).pulls, 5);
});

test("una rareza sin arcanos en el pack sale a cero, no a NaN", () => {
  const sinLegendarios = { ...pack, items: ["rare1", "unc1"] };
  const r = calculateR5Realism(1000, sinLegendarios, data);
  assert.deepEqual(r.results.LEGENDARY, { expected: "0.0", probPct: "0.0", probRaw: 0, itemCount: 0 });
});

test("las copias esperadas reparten la probabilidad de la rareza entre sus arcanos", () => {
  const r = calculateR5Realism(200 * 100, pack, data); // 100 packs = 300 rolls
  // 2 legendaries share 5 %: 300 * 0.025 = 7.5 expected copies each
  assert.equal(r.results.LEGENDARY.expected, "7.5");
  assert.equal(r.results.LEGENDARY.itemCount, 2);
  // the common is alone and gets 50 %: 300 * 0.5 = 150
  assert.equal(r.results.COMMON.expected, "150.0");
});

test("con muchísimo Vosfor el rango 5 de un común pasa a ser seguro y el de un legendario no", () => {
  const r = calculateR5Realism(200 * 200, pack, data); // 600 rolls
  assert.ok(r.results.COMMON.probRaw > 0.99, `común: ${r.results.COMMON.probPct}`);
  assert.ok(r.results.LEGENDARY.probRaw < r.results.COMMON.probRaw, "un legendario no puede ser más fácil");
});

// pack missing drop tables represents incomplete worker data: falls back to default proportions instead of
// leaving cards blank
test("un pack sin tabla de probabilidades cae a los valores por defecto", () => {
  const sinRolls = { ...pack, rolls: null };
  const r = calculateR5Realism(1000, sinRolls, data);
  assert.ok(r, "debe simular igual");
  assert.equal(r.results.COMMON.itemCount, 1);
  assert.ok(Number.parseFloat(r.results.COMMON.expected) > 0);
});
