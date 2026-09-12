// "Comprar para Vosfor": cuánto Vosfor sacas por platino comprando el arcano para disolverlo.
//
// Es la operación inversa a vender, y por eso NO puede usar el precio realizable: ahí el ask
// se pondera a la baja por liquidez para no prometer una venta que nadie te hará. Comprando
// pasa lo contrario, pagas lo que piden, así que la ratio sale del ask crudo.
import { test } from "node:test";
import assert from "node:assert/strict";

import { vosforPerPlat } from "../deploy/js/services/vosfor.service.js";

test("la ratio es el vosfor que rinde entre lo que cuesta comprarlo", () => {
  // Un común de 24 vosfor a 6p: 4 de vosfor por cada platino.
  const r = vosforPerPlat({ vosfor: 24 }, { pe: 6, s: 30 });
  assert.equal(r.ratio, 4);
  assert.equal(r.buyPrice, 6);
});

test("traduce la ratio a lo que cuesta juntar un pack de Loid (200 vosfor)", () => {
  const r = vosforPerPlat({ vosfor: 24 }, { pe: 6, s: 30 });
  // 200/24 = 8,33 copias x 6p
  assert.ok(r.platPerPack > 49.9 && r.platPerPack < 50.1, `salió ${r.platPerPack}`);
});

test("el caro rinde menos que el barato aunque dé el mismo vosfor", () => {
  const barato = vosforPerPlat({ vosfor: 24 }, { pe: 6, s: 30 });
  const caro = vosforPerPlat({ vosfor: 24 }, { pe: 48, s: 30 });
  assert.ok(barato.ratio > caro.ratio);
  assert.equal(caro.ratio, 0.5);
});

test("cuenta los vendedores: una ratio irrepetible no es una fuente de Vosfor", () => {
  const r = vosforPerPlat({ vosfor: 24 }, { pe: 2, s: 1 });
  assert.equal(r.sellers, 1);
});

test("sin ask no hay compra, y un arcano que no se disuelve no entra", () => {
  assert.equal(vosforPerPlat({ vosfor: 24 }, { pe: 0, s: 0 }), null);
  assert.equal(vosforPerPlat({ vosfor: 0 }, { pe: 6, s: 30 }), null);
  assert.equal(vosforPerPlat({ vosfor: 24 }, null), null);
  assert.equal(vosforPerPlat(null, { pe: 6 }), null);
});

test("usa el ask crudo, no el precio realizable: comprando no hay descuento por liquidez", () => {
  // Mercado muerto (0 ventas/día): realizableR0 recortaría el ask al 15%, pero el que
  // compra paga los 10p que piden.
  const muerto = vosforPerPlat({ vosfor: 24 }, { pe: 10, s: 3, v: 0, vm: 0 });
  assert.equal(muerto.buyPrice, 10);
  assert.equal(muerto.ratio, 2.4);
});
