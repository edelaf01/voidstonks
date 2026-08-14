// realizable arcane price (R0 and max rank)
// motivated by Arcane Hot Shot advertising "R0 96" when 40 sellers asked ~23p: unbounded best-buy floors
// treated isolated speculative bids as sale price
// test cases use real API captures
import { test } from "node:test";
import assert from "node:assert/strict";

import { realizableR0, realizableMax } from "../deploy/js/services/vosfor.service.js";

test("el best-buy no puede superar al ask: puja alta por copias que se rankean", () => {
  // arcane_hot_shot captured from worker: 40 sellers at ~23p, but a buy order asks for R0 at 96p to rank it
  // up to R5 (bbm 2550)
  const hotShot = { pe: 23, v: 434, vm: 125.5, bb: 96 };

  const r0 = realizableR0(hotShot);
  assert.ok(r0 <= 23, `R0 no puede superar el ask (23p), salió ${r0}`);
  assert.ok(r0 > 0, "un arcano con mercado vivo no vale 0");
});

test("el mismo tope aplica al rango máximo", () => {
  // bbm 2550 vs 496 ask: without a cap the UI advertised 2550p for an R5
  const hotShotMax = { pem: 496, vm: 125.5, bbm: 2550 };

  const rMax = realizableMax(hotShotMax);
  assert.ok(rMax <= 496, `Rmax no puede superar el ask (496p), salió ${rMax}`);
});

test("mercado líquido: se cobra el ask íntegro", () => {
  // volume above threshold (5/day for R0) = no penalty
  assert.equal(realizableR0({ pe: 40, v: 30, vm: 10, bb: 12 }), 40);
});

test("mercado muerto: el ask se penaliza pero el best-buy rescata el suelo", () => {
  // without closed sales ask is discounted to 15%, but if someone buys at 60 that becomes the realizable
  // floor
  assert.equal(realizableR0({ pe: 100, v: 0, vm: 0, bb: 60 }), 60);
});

test("mercado muerto sin compradores: solo queda la fracción del ask", () => {
  assert.equal(realizableR0({ pe: 100, v: 0, vm: 0, bb: 0 }), 15);
});

test("sin datos de precio no se inventa valor", () => {
  assert.equal(realizableR0(null), 0);
  assert.equal(realizableR0({ pe: 0, v: 10, vm: 0, bb: 50 }), 0);
  assert.equal(realizableMax(null), 0);
});
