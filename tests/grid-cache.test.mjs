import { test } from "node:test";
import assert from "node:assert/strict";
import { revisaRejillaCacheada } from "../deploy/js/utils/vision/grid_cache.js";

test("el final de la lista: acierta algunas y aun así hay que re-detectar", () => {
  const r = revisaRejillaCacheada(4, 18, false);
  assert.equal(r.reDetectar, true);
  assert.equal(r.yaReintentado, true, "hay que recordarlo para no re-detectar en bucle");
});

test("una página normal no dispara nada", () => {
  assert.deepEqual(revisaRejillaCacheada(16, 18, false), { reDetectar: false, yaReintentado: false });
});

test("cero aciertos sigue re-detectando, como antes", () => {
  assert.equal(revisaRejillaCacheada(0, 18, false).reDetectar, true);
});

test("no se re-detecta dos veces seguidas por lo mismo", () => {
  assert.equal(revisaRejillaCacheada(4, 18, true).reDetectar, false);
});

test("una página buena rearma el reintento", () => {
  const r = revisaRejillaCacheada(16, 18, true);
  assert.equal(r.yaReintentado, false);
  assert.equal(revisaRejillaCacheada(4, 18, r.yaReintentado).reDetectar, true);
});

test("con muy pocas celdas el porcentaje no decide", () => {
  assert.equal(revisaRejillaCacheada(1, 3, false).reDetectar, false);
  assert.equal(revisaRejillaCacheada(0, 3, false).reDetectar, true);
});

test("sin celdas activas no se decide nada", () => {
  assert.deepEqual(revisaRejillaCacheada(0, 0, false), { reDetectar: false, yaReintentado: false });
});
