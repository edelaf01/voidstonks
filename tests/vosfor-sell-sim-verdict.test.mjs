// simulator verdict "Sell or dissolve?"
// previously computed inside the component using raw ask vs unadjusted vosfor with +-15% band, while row
// badges used realizable price and liquidity adjustments
// with high ask and zero sales the simulator said SELL while the badge said DISSOLVE
import { test } from "node:test";
import assert from "node:assert/strict";

import { sellSimVerdict } from "../deploy/js/services/vosfor.service.js";

const RARO = { vosfor: 24, maxRank: 5 };
const RATE = 0.3;

test("R5 con ask alto y sin ventas: el ask decía VENDER, el realizable dice DISOLVER", () => {
  // 300p asking price, 0 sales, no buyers: realizable = 15% of ask
  const muerto = { pe: 20, v: 0, vm: 0, bb: 0, pem: 300, bbm: 0, rm: 5 };
  const r = sellSimVerdict(RARO, muerto, { isMax: true, qty: 1, liqRate: RATE });

  assert.equal(r.sellValue, 45, "300 x 0,15");
  assert.equal(r.totalVosfor, 504, "21 copias x 24");
  assert.equal(r.dissolveValue, 504 * RATE * 0.75);
  assert.equal(r.verdict, "dissolve");
  // with raw ask (300 > 151 x 1.15) the old verdict was "sell"
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
  // 20 x 0.64 x 0.75 = 9.6: within 0.4 of 10, inside 8% band
  assert.equal(sellSimVerdict(meta, st, { isMax: false, qty: 1, liqRate: 0.64 }).verdict, "even");
  // 20 x 0.8 x 0.75 = 12: 2 off from 12, outside 8% band
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
