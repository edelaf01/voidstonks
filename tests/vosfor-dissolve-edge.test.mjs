// Orden de "Mejor Disolver": cuánto mejor sale disolver una copia que quedársela.
//
// El ranking ordenaba por `meta.vosfor`, el vosfor que rinde el arcano al disolverlo. Ese
// número es casi constante por rareza (61 de los raros dan exactamente 24), así que la
// pestaña ordenaba por una constante: el primero de la lista no era el mejor candidato, era
// el que cayera primero en el empate, y un arcano con un R5 de 500p salía por delante de uno
// sin mercado ninguno. Lo que decide es el coste de oportunidad, no el rendimiento.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dissolveEdge } from "../deploy/js/services/vosfor.service.js";

const RATE = 0.1;                                  // plat por vosfor del mejor pack ajustado
const RARO = { vosfor: 24, maxRank: 5 };           // 21 copias para el rango máximo

// Mismo vosfor (24) y mercados opuestos: es el caso que el orden viejo no distinguía.
const SIN_MERCADO = { pe: 0, v: 0, vm: 0, pem: 0, rm: 0 };
const R5_CARO = { pe: 20, v: 5, vm: 5, bb: 18, pem: 500, rm: 5, bbm: 400 };

test("sin mercado a ningún rango no hay nada que perder: va primero", () => {
  const muerto = dissolveEdge(RARO, SIN_MERCADO, RATE);
  assert.equal(muerto.edge, Infinity);
  assert.equal(muerto.keepValue, 0);
});

test("con el MISMO vosfor, el que tiene R5 caro queda muy por detrás del que no tiene mercado", () => {
  const muerto = dissolveEdge(RARO, SIN_MERCADO, RATE);
  const caro = dissolveEdge(RARO, R5_CARO, RATE);

  assert.ok(caro.edge < 1, `con un R5 de 500p disolver no puede compensar: ${caro.edge}`);
  assert.ok(muerto.edge > caro.edge, "el de mercado muerto tiene que ordenar por delante");
  // El vosfor que rinden es idéntico: si el orden saliera de ahí, empatarían.
  assert.equal(muerto.dissolveValue, caro.dissolveValue);
});

test("quedársela vale su parte de un R{max}, repartida entre las copias que cuesta", () => {
  const caro = dissolveEdge(RARO, R5_CARO, RATE);
  assert.equal(caro.copiesMax, 21);
  // 500p el R5 / 21 copias = 23,8p por copia, por encima de los 20p de venderla suelta.
  assert.ok(caro.keepValue > 23.8 && caro.keepValue < 23.82, `salió ${caro.keepValue}`);
});

test("si la copia suelta rinde más que su parte del R{max}, manda la suelta", () => {
  const r5Barato = { ...R5_CARO, pem: 200, bbm: 150 };
  const d = dissolveEdge(RARO, r5Barato, RATE);
  // 200/21 = 9,5p por copia contra 20p vendiéndola suelta.
  assert.equal(d.keepValue, 20);
});

test("el múltiplo es por copia: un arcano de 10 copias reparte su R{max} entre 10", () => {
  const fusionCorta = { vosfor: 24, maxRank: 3 };
  const d = dissolveEdge(fusionCorta, { ...R5_CARO, rm: 3 }, RATE);
  assert.equal(d.copiesMax, 10);
  assert.ok(d.keepValue === 50, `500/10 = 50 por copia, salió ${d.keepValue}`);
});

test("el descuento por apostar se aplica al valor de disolver", () => {
  const d = dissolveEdge(RARO, SIN_MERCADO, RATE);
  // 24 vosfor x 0,1 pl/vosfor x 0,75 de certeza
  assert.equal(d.dissolveValue, 24 * RATE * 0.75);
});

test("un arcano que no se disuelve, o sin tasa de pack todavía, sale de la lista", () => {
  assert.equal(dissolveEdge({ vosfor: 0, maxRank: 5 }, R5_CARO, RATE), null);
  assert.equal(dissolveEdge(RARO, R5_CARO, 0), null);
  assert.equal(dissolveEdge(RARO, null, RATE), null);
  assert.equal(dissolveEdge(null, R5_CARO, RATE), null);
});
