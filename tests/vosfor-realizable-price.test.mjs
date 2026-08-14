// Precio realizable de un arcano (R0 y rango máximo).
//
// Caso real que motivó estos tests: el panel PIX anunciaba "R0 96" para Arcane Hot Shot
// cuando había 40 vendedores pidiendo ~23p. La causa era que el suelo de best-buy no
// estaba acotado: WFM tiene compradores que pujan muy por encima del ask por una copia
// R0 (pagan de más para rankearla a R5, que vale ~500p), y esa puja aislada se tomaba
// como precio de venta. Los datos de cada caso son capturas de la API, no inventados.
import { test } from "node:test";
import assert from "node:assert/strict";

import { realizableR0, realizableMax } from "../deploy/js/services/vosfor.service.js";

test("el best-buy no puede superar al ask: puja alta por copias que se rankean", () => {
  // arcane_hot_shot, capturado del worker: 40 vendedores a ~23p, pero alguien
  // compra R0 a 96p para subirlo a R5 (bbm 2550).
  const hotShot = { pe: 23, v: 434, vm: 125.5, bb: 96 };

  const r0 = realizableR0(hotShot);
  assert.ok(r0 <= 23, `R0 no puede superar el ask (23p), salió ${r0}`);
  assert.ok(r0 > 0, "un arcano con mercado vivo no vale 0");
});

test("el mismo tope aplica al rango máximo", () => {
  // bbm 2550 contra un ask de 496: sin tope, el panel prometía 2550p por un R5.
  const hotShotMax = { pem: 496, vm: 125.5, bbm: 2550 };

  const rMax = realizableMax(hotShotMax);
  assert.ok(rMax <= 496, `Rmax no puede superar el ask (496p), salió ${rMax}`);
});

test("mercado líquido: se cobra el ask íntegro", () => {
  // Volumen por encima del umbral (5/día en R0) = sin penalización.
  assert.equal(realizableR0({ pe: 40, v: 30, vm: 10, bb: 12 }), 40);
});

test("mercado muerto: el ask se penaliza pero el best-buy rescata el suelo", () => {
  // Sin ventas cerradas el ask cuenta un 15%, pero si alguien compra a 60 ese es el
  // precio realizable. Este rescate es la razón de ser del suelo: no debe perderse.
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
