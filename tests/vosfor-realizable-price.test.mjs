import { test } from "node:test";
import assert from "node:assert/strict";

import { realizableR0, realizableMax } from "../deploy/js/services/vosfor.service.js";

test("el best-buy no puede superar al ask: puja alta por copias que se rankean", () => {
  const hotShot = { pe: 23, v: 434, vm: 125.5, bb: 96 };

  const r0 = realizableR0(hotShot);
  assert.ok(r0 <= 23, `R0 no puede superar el ask (23p), salió ${r0}`);
  assert.ok(r0 > 0, "un arcano con mercado vivo no vale 0");
});

test("el mismo tope aplica al rango máximo", () => {
  const hotShotMax = { pem: 496, vm: 125.5, bbm: 2550 };

  const rMax = realizableMax(hotShotMax);
  assert.ok(rMax <= 496, `Rmax no puede superar el ask (496p), salió ${rMax}`);
});

test("mercado líquido: se cobra el ask íntegro", () => {
  assert.equal(realizableR0({ pe: 40, v: 30, vm: 10, bb: 12 }), 40);
});

test("mercado muerto: el ask se penaliza pero el best-buy rescata el suelo", () => {
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
