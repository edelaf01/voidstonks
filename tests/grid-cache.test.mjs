// Cuándo se tira la rejilla cacheada y se vuelve a detectar.
//
// El caso que motivó esto: al llegar al FINAL de la lista de inventario, el scroll se queda a
// media fila. La rejilla cacheada cae entre celdas, pero todavía acierta las filas que por
// casualidad cuadran, así que la condición vieja —exigir CERO aciertos— no saltaba nunca y la
// última página se leía torcida sin reajustarse sola.
import { test } from "node:test";
import assert from "node:assert/strict";
import { revisaRejillaCacheada } from "../deploy/js/utils/vision/grid_cache.js";

test("el final de la lista: acierta algunas y aun así hay que re-detectar", () => {
  // 18 celdas activas, la rejilla desalineada casa 4. Con la regla vieja (solo si 0) no saltaba.
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
  // Detectar cuesta un frame entero; si el problema no era la rejilla sino que la página tiene
  // poco que casar (mods, recursos), repetirlo en cada página se nota.
  assert.equal(revisaRejillaCacheada(4, 18, true).reDetectar, false);
});

test("una página buena rearma el reintento", () => {
  // Sin esto, una desalineación puntual dejaba al escáner sin segunda oportunidad el resto de
  // la sesión.
  const r = revisaRejillaCacheada(16, 18, true);
  assert.equal(r.yaReintentado, false);
  assert.equal(revisaRejillaCacheada(4, 18, r.yaReintentado).reDetectar, true);
});

test("con muy pocas celdas el porcentaje no decide", () => {
  // 1 de 3 es un tercio, pero con tres celdas eso no dice nada de la rejilla.
  assert.equal(revisaRejillaCacheada(1, 3, false).reDetectar, false);
  // Aunque ahí sigue valiendo el caso de CERO, que es inequívoco.
  assert.equal(revisaRejillaCacheada(0, 3, false).reDetectar, true);
});

test("sin celdas activas no se decide nada", () => {
  assert.deepEqual(revisaRejillaCacheada(0, 0, false), { reDetectar: false, yaReintentado: false });
});
