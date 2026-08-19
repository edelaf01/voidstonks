// Probabilidades de la calculadora de Vosfor.
//
// Es el único número de esa pestaña que el usuario no puede verificar a ojo: un "72,3 %" mal
// calculado se lee igual de creíble que el bueno, y a partir de ahí decide si gasta 12.000 de
// Vosfor. Estaba entre 2600 líneas de render, donde no había forma de comprobarlo.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binomialGe,
  formatProbPct,
  targetSimProbabilities,
  calculateR5Realism,
} from "../deploy/js/utils/vosfor_math.js";

const casi = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// --- binomialGe --------------------------------------------------------------------------

test("con menos intentos que éxitos pedidos la probabilidad es 0", () => {
  assert.equal(binomialGe(5, 10, 0.5), 0);
});

// Casos con solución cerrada: si estos fallan, la recurrencia del binomio está mal.
test("coincide con la fórmula cerrada en los casos que se pueden calcular a mano", () => {
  // Al menos 1 éxito en n intentos = 1 - (1-p)^n
  casi(binomialGe(10, 1, 0.2), 1 - 0.8 ** 10);
  casi(binomialGe(3, 1, 0.5), 1 - 0.5 ** 3);
  // Todos los intentos aciertan = p^n
  casi(binomialGe(4, 4, 0.5), 0.5 ** 4);
  // Al menos 2 de 3 con p=0.5 -> 4/8
  casi(binomialGe(3, 2, 0.5), 0.5);
});

test("la probabilidad siempre cae entre 0 y 1", () => {
  for (const [n, k, p] of [[3000, 21, 0.01], [100, 50, 0.9], [21, 21, 0.999], [1, 1, 1]]) {
    const r = binomialGe(n, k, p);
    assert.ok(r >= 0 && r <= 1, `binomialGe(${n},${k},${p}) = ${r}`);
    assert.ok(Number.isFinite(r), "no puede salir NaN ni Infinity");
  }
});

// Calcular cada combinatoria por separado desborda: con las ~3000 tiradas de un objetivo
// normal, C(3000, 21) no cabe en un double y el resultado sale NaN.
test("aguanta las miles de tiradas de un objetivo real sin desbordar", () => {
  const r = binomialGe(3000, 21, 0.05 / 8);
  assert.ok(Number.isFinite(r), "NaN significa combinatoria desbordada");
  assert.ok(r > 0 && r < 1);
});

// p = 1 llega de un pack con un solo arcano de esa rareza. Sin el suelo del divisor, la
// recurrencia divide por cero.
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

// --- formatProbPct -----------------------------------------------------------------------

// Redondear 99.96 a "100.0" promete una certeza que no existe, y 0.04 a "0.0" dice que es
// imposible algo que puede pasar. Los dos extremos se marcan aparte a propósito.
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

// --- targetSimProbabilities --------------------------------------------------------------

/** Lee un porcentaje formateado, incluidos los marcadores de extremo (">99.9" / "<0.1"). */
const pct = (s) => (s === ">99.9" ? 99.95 : s === "<0.1" ? 0.05 : Number.parseFloat(s));

// La probabilidad que publica el pack es de la RAREZA, no del arcano: se reparte entre los que
// la comparten. Sin dividir, un pack con 8 legendarios promete 8 veces la suerte real.
test("la probabilidad del pack se reparte entre los arcanos de esa rareza", () => {
  const solo = targetSimProbabilities(10, 0.05, 1, 1);
  const entreOcho = targetSimProbabilities(10, 0.05, 8, 1);
  assert.ok(pct(solo.pAtLeastOnePct) > pct(entreOcho.pAtLeastOnePct),
    `${solo.pAtLeastOnePct} debería superar a ${entreOcho.pAtLeastOnePct}`);
});

test("cada pack son 3 tiradas, no una", () => {
  // 10 packs con p=0.05 y un solo arcano: 30 tiradas, no 10.
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

// --- calculateR5Realism ------------------------------------------------------------------

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

// Enseñar ceros haría creer que el cálculo dice algo; por debajo de un pack no hay nada que
// simular.
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

  // Sobra Vosfor para 5 packs y pico: no se cuenta el pack a medias.
  assert.equal(calculateR5Realism(1199, pack, data).pulls, 5);
});

test("una rareza sin arcanos en el pack sale a cero, no a NaN", () => {
  const sinLegendarios = { ...pack, items: ["rare1", "unc1"] };
  const r = calculateR5Realism(1000, sinLegendarios, data);
  assert.deepEqual(r.results.LEGENDARY, { expected: "0.0", probPct: "0.0", probRaw: 0, itemCount: 0 });
});

test("las copias esperadas reparten la probabilidad de la rareza entre sus arcanos", () => {
  const r = calculateR5Realism(200 * 100, pack, data); // 100 packs = 300 tiradas
  // 2 legendarios comparten el 5 %: 300 * 0.025 = 7.5 copias esperadas de cada uno.
  assert.equal(r.results.LEGENDARY.expected, "7.5");
  assert.equal(r.results.LEGENDARY.itemCount, 2);
  // El común está solo y se lleva el 50 %: 300 * 0.5 = 150.
  assert.equal(r.results.COMMON.expected, "150.0");
});

test("con muchísimo Vosfor el rango 5 de un común pasa a ser seguro y el de un legendario no", () => {
  const r = calculateR5Realism(200 * 200, pack, data); // 600 tiradas
  assert.ok(r.results.COMMON.probRaw > 0.99, `común: ${r.results.COMMON.probPct}`);
  assert.ok(r.results.LEGENDARY.probRaw < r.results.COMMON.probRaw, "un legendario no puede ser más fácil");
});

// Un pack sin tabla de tiradas es un dato incompleto del worker: se usan las proporciones
// típicas en vez de dejar la tarjeta en blanco.
test("un pack sin tabla de probabilidades cae a los valores por defecto", () => {
  const sinRolls = { ...pack, rolls: null };
  const r = calculateR5Realism(1000, sinRolls, data);
  assert.ok(r, "debe simular igual");
  assert.equal(r.results.COMMON.itemCount, 1);
  assert.ok(Number.parseFloat(r.results.COMMON.expected) > 0);
});
