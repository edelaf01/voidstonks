// when the cached grid is dropped and detected again
// at the END of the inventory list the scroll stops mid row: the cached grid falls between cells but still
// hits the rows that happen to line up, so requiring ZERO hits never fired
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
  // detecting costs a whole frame; when the page just has little to match (mods, resources), repeating it on
  // every page shows
  assert.equal(revisaRejillaCacheada(4, 18, true).reDetectar, false);
});

test("una página buena rearma el reintento", () => {
  // without this, one misalignment left the scanner with no second chance for the rest of the session
  const r = revisaRejillaCacheada(16, 18, true);
  assert.equal(r.yaReintentado, false);
  assert.equal(revisaRejillaCacheada(4, 18, r.yaReintentado).reDetectar, true);
});

test("con muy pocas celdas el porcentaje no decide", () => {
  // 1 of 3 is a third, but with three cells that says nothing about the grid
  assert.equal(revisaRejillaCacheada(1, 3, false).reDetectar, false);
  assert.equal(revisaRejillaCacheada(0, 3, false).reDetectar, true);
});

test("sin celdas activas no se decide nada", () => {
  assert.deepEqual(revisaRejillaCacheada(0, 0, false), { reDetectar: false, yaReintentado: false });
});
