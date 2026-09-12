import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binomialGe,
  formatProbPct,
  targetSimProbabilities,
  calculateR5Realism,
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

  assert.equal(calculateR5Realism(1199, pack, data).pulls, 5);
});

test("una rareza sin arcanos en el pack sale a cero, no a NaN", () => {
  const sinLegendarios = { ...pack, items: ["rare1", "unc1"] };
  const r = calculateR5Realism(1000, sinLegendarios, data);
  assert.deepEqual(r.results.LEGENDARY, { expected: "0.0", probPct: "0.0", probRaw: 0, itemCount: 0, copies: 0, ranks: [] });
});

test("las copias del rango máximo son triangulares: 21 para R5, 10 para R3, 21 si no consta", () => {
  assert.equal(copiesForMaxRank({ maxRank: 5 }), 21);
  assert.equal(copiesForMaxRank({ maxRank: 3 }), 10);
  assert.equal(copiesForMaxRank({}), 21);
  assert.equal(copiesForMaxRank(null), 21);
  assert.equal(maxRankOf({ maxRank: 9 }), 5);
  assert.equal(maxRankOf({ maxRank: 0 }), 1);
});

// cetus, fortuna and necralisk mix 21-copy arcanes with 10-copy ones within the same rarity
test("una rareza con arcanos de 10 y de 21 copias da una probabilidad por rango", () => {
  const mixto = {
    ...pack,
    items: ["rare1", "rare3"],
  };
  const datos = { arcanes: { rare1: { rarity: "RARE", maxRank: 5 }, rare3: { rarity: "RARE", maxRank: 3 } } };
  const r = calculateR5Realism(200 * 100, mixto, datos);

  assert.deepEqual(r.results.RARE.ranks.map((k) => [k.maxRank, k.copies, k.itemCount]), [[5, 21, 1], [3, 10, 1]]);
  const [r5, r3] = r.results.RARE.ranks;
  assert.ok(r3.probRaw > r5.probRaw, `10 copias (${r3.probPct}) tiene que ser más fácil que 21 (${r5.probPct})`);
  assert.equal(r3.probRaw, binomialGe(300, 10, 0.075));
  assert.equal(r5.probRaw, binomialGe(300, 21, 0.075));
  assert.equal(r.results.RARE.probRaw, r5.probRaw);
  assert.equal(r.results.RARE.copies, 21);
});

test("con pocas tiradas, el R3 de 10 copias sale viable donde el R5 fijo lo daba por perdido", () => {
  const soloR3 = { ...pack, items: ["pax"] };
  const datos = { arcanes: { pax: { rarity: "RARE", maxRank: 3 } } };
  const r = calculateR5Realism(200 * 40, soloR3, datos);
  assert.ok(r.results.RARE.probRaw > 0.95, `10 copias con 18 esperadas: ${r.results.RARE.probPct}`);
  assert.ok(binomialGe(120, 21, 0.15) < 0.3, "con 21 fijas habría salido inviable");
  assert.equal(r.results.RARE.copies, 10);
});

test("las copias esperadas reparten la probabilidad de la rareza entre sus arcanos", () => {
  const r = calculateR5Realism(200 * 100, pack, data);
  assert.equal(r.results.LEGENDARY.expected, "7.5");
  assert.equal(r.results.LEGENDARY.itemCount, 2);
  assert.equal(r.results.COMMON.expected, "150.0");
});

test("con muchísimo Vosfor el rango 5 de un común pasa a ser seguro y el de un legendario no", () => {
  const r = calculateR5Realism(200 * 200, pack, data);
  assert.ok(r.results.COMMON.probRaw > 0.99, `común: ${r.results.COMMON.probPct}`);
  assert.ok(r.results.LEGENDARY.probRaw < r.results.COMMON.probRaw, "un legendario no puede ser más fácil");
});

test("un pack sin tabla de probabilidades cae a los valores por defecto", () => {
  const sinRolls = { ...pack, rolls: null };
  const r = calculateR5Realism(1000, sinRolls, data);
  assert.ok(r, "debe simular igual");
  assert.equal(r.results.COMMON.itemCount, 1);
  assert.ok(Number.parseFloat(r.results.COMMON.expected) > 0);
});
