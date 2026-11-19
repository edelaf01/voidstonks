import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binomialGe,
  formatProbPct,
  targetSimProbabilities,
  copiesForMaxRank,
  maxRankOf,
} from "../deploy/js/utils/vosfor_math.js";

const casi = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("con menos intentos que éxitos pedidos la probabilidad es 0", () => {
  assert.equal(binomialGe(5, 10, 0.5), 0);
});

test("coincide con la fórmula cerrada en los casos que se pueden calcular a mano", () => {
  casi(binomialGe(10, 1, 0.2), 1 - 0.8 ** 10);
  casi(binomialGe(3, 1, 0.5), 1 - 0.5 ** 3);
  casi(binomialGe(4, 4, 0.5), 0.5 ** 4);
  casi(binomialGe(3, 2, 0.5), 0.5);
});

test("la probabilidad siempre cae entre 0 y 1", () => {
  for (const [n, k, p] of [[3000, 21, 0.01], [100, 50, 0.9], [21, 21, 0.999], [1, 1, 1]]) {
    const r = binomialGe(n, k, p);
    assert.ok(r >= 0 && r <= 1, `binomialGe(${n},${k},${p}) = ${r}`);
    assert.ok(Number.isFinite(r), "no puede salir NaN ni Infinity");
  }
});

test("aguanta las miles de tiradas de un objetivo real sin desbordar", () => {
  const r = binomialGe(3000, 21, 0.05 / 8);
  assert.ok(Number.isFinite(r), "NaN significa combinatoria desbordada");
  assert.ok(r > 0 && r < 1);
});

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

const pct = (s) => (s === ">99.9" ? 99.95 : s === "<0.1" ? 0.05 : Number.parseFloat(s));

test("la probabilidad del pack se reparte entre los arcanos de esa rareza", () => {
  const solo = targetSimProbabilities(10, 0.05, 1, 1);
  const entreOcho = targetSimProbabilities(10, 0.05, 8, 1);
  assert.ok(pct(solo.pAtLeastOnePct) > pct(entreOcho.pAtLeastOnePct),
    `${solo.pAtLeastOnePct} debería superar a ${entreOcho.pAtLeastOnePct}`);
});

test("cada pack son 3 tiradas, no una", () => {
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

test("las copias del rango máximo son triangulares: 21 para R5, 10 para R3, 21 si no consta", () => {
  assert.equal(copiesForMaxRank({ maxRank: 5 }), 21);
  assert.equal(copiesForMaxRank({ maxRank: 3 }), 10);
  assert.equal(copiesForMaxRank({}), 21);
  assert.equal(copiesForMaxRank(null), 21);
  assert.equal(maxRankOf({ maxRank: 9 }), 5);
  assert.equal(maxRankOf({ maxRank: 0 }), 1);
});
