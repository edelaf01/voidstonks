// Veredicto del simulador "¿Vender o disolver?".
//
// El simulador calculaba lo suyo en el componente: ask crudo por cantidad contra el Vosfor a
// la tasa sin ajustar, banda ±15%. El badge de cada fila (arcaneVerdict) usa el precio
// realizable, la tasa ajustada por liquidez y el descuento por apuesta. Con un R5 de ask alto
// y 0 ventas el simulador decía VENDER y la fila de ese mismo arcano DISOLVER.
import { test } from "node:test";
import assert from "node:assert/strict";

import { sellSimVerdict } from "../deploy/js/services/vosfor.service.js";

const RARO = { vosfor: 24, maxRank: 5 };
const RATE = 0.3;

test("R5 con ask alto y sin ventas: el ask decía VENDER, el realizable dice DISOLVER", () => {
  // 300p pedidos, 0 ventas, nadie comprando: realizable = 15% del ask.
  const muerto = { pe: 20, v: 0, vm: 0, bb: 0, pem: 300, bbm: 0, rm: 5 };
  const r = sellSimVerdict(RARO, muerto, { isMax: true, qty: 1, liqRate: RATE });

  assert.equal(r.sellValue, 45, "300 x 0,15");
  assert.equal(r.totalVosfor, 504, "21 copias x 24");
  assert.equal(r.dissolveValue, 504 * RATE * 0.75);
  assert.equal(r.verdict, "dissolve");
  // Con el ask crudo (300 > 151 x 1,15) el veredicto viejo era "sell".
  assert.ok(300 > 504 * RATE * 1.15);
});

test("mercado líquido: se cobra el ask íntegro y vender gana", () => {
  const vivo = { pe: 40, v: 30, vm: 10, bb: 12 };
  const r = sellSimVerdict(RARO, vivo, { isMax: false, qty: 3, liqRate: RATE });
  assert.equal(r.unitRealizable, 40);
  assert.equal(r.sellValue, 120);
  assert.equal(r.totalVosfor, 72);
  assert.equal(r.verdict, "sell");
});

test("la banda de 'parejo' es la misma que la del badge por fila (8%)", () => {
  const st = { pe: 10, v: 30, vm: 0, bb: 0 };           // realizable 10
  const meta = { vosfor: 20, maxRank: 5 };
  // 20 x 0,64 x 0,75 = 9,6: a 0,4 de 10, dentro del 8%.
  assert.equal(sellSimVerdict(meta, st, { isMax: false, qty: 1, liqRate: 0.64 }).verdict, "even");
  // 20 x 0,8 x 0,75 = 12: a 2 de 12, fuera del 8%.
  assert.equal(sellSimVerdict(meta, st, { isMax: false, qty: 1, liqRate: 0.8 }).verdict, "dissolve");
});

test("sin mercado no hay nada que vender: disolver", () => {
  const r = sellSimVerdict(RARO, { pe: 0, v: 0, vm: 0, bb: 0 }, { isMax: false, qty: 5, liqRate: RATE });
  assert.equal(r.sellValue, 0);
  assert.equal(r.verdict, "dissolve");
});

test("sin tasa de pack todavía el veredicto queda pendiente, no en falso DISOLVER", () => {
  const r = sellSimVerdict(RARO, { pe: 40, v: 30, vm: 10, bb: 12 }, { isMax: false, qty: 1, liqRate: 0 });
  assert.equal(r.dissolveValue, null);
  assert.equal(r.verdict, "pending");
});

test("a rango máximo cada unidad son las copias que cuesta fusionarla, según el arcano", () => {
  const st = { pe: 5, v: 10, vm: 5, bb: 0, pem: 60, bbm: 0, rm: 3 };
  const r = sellSimVerdict({ vosfor: 36, maxRank: 3 }, st, { isMax: true, qty: 2, liqRate: RATE });
  assert.equal(r.copiesMax, 10);
  assert.equal(r.copiesPerUnit, 10);
  assert.equal(r.totalVosfor, 2 * 10 * 36);
});

test("sin meta o sin stats no hay simulación", () => {
  assert.equal(sellSimVerdict(null, { pe: 10 }, { isMax: false, qty: 1, liqRate: RATE }), null);
  assert.equal(sellSimVerdict(RARO, null, { isMax: false, qty: 1, liqRate: RATE }), null);
});
