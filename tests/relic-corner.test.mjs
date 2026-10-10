import { test } from "node:test";
import assert from "node:assert/strict";

import { esquinaDeCasilla } from "../deploy/js/utils/vision/relic_corner.js";

const ANCLA = { x: 150, y: 250 };

function lector(pinta, w = 300, h = 300) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = pinta(x - ANCLA.x, y - ANCLA.y), i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return (x0, y0, cw, ch) => {
    if (x0 < 0 || y0 < 0 || x0 + cw > w || y0 + ch > h) return null;
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let j = 0; j < ch; j++) out.set(data.subarray(((y0 + j) * w + x0) * 4, ((y0 + j) * w + x0 + cw) * 4), j * cw * 4);
    return { width: cw, height: ch, data: out };
  };
}

const icono = (brillo) => (dx, dy) => (Math.abs(dx) <= 35 && dy >= -140 && dy <= -60 ? brillo : null);
const contador = (dx, dy) => (dy >= -180 && dy <= -158 && ((dx >= -90 && dx <= -86) || (dx >= -70 && dx <= -66)) ? 230 : null);
const ojo = (dx, dy) => {
  const r = Math.hypot(dx + 65, dy + 169);
  return (r >= 9 && r <= 12) || r <= 3 ? 220 : null;
};
const capas = (...fs) => (dx, dy) => fs.reduce((v, f) => v ?? f(dx, dy), null) ?? 40;

test("una casilla sin contador y con el icono encendido tiene una copia", () => {
  assert.equal(esquinaDeCasilla(lector(capas(icono(200))), ANCLA), "vacia");
});

test("el fondo animado no cuenta como contador", () => {
  const ruido = (dx, dy) => 40 + ((dx * 7 + dy * 13) % 9);
  assert.equal(esquinaDeCasilla(lector(capas(icono(200), ruido)), ANCLA), "vacia");
});

test("sin contador pero con el icono apagado no se decide", () => {
  assert.equal(esquinaDeCasilla(lector(capas(icono(60))), ANCLA), null);
});

test("un contador que el OCR no leyó no pasa por una copia", () => {
  assert.equal(esquinaDeCasilla(lector(capas(contador, icono(200))), ANCLA), null);
  assert.equal(esquinaDeCasilla(lector(capas(contador, icono(60))), ANCLA), null);
});

test("el ojo con el icono apagado es una reliquia que ya no tienes", () => {
  assert.equal(esquinaDeCasilla(lector(capas(ojo, icono(60))), ANCLA), "ojo");
});

test("el ojo con el icono encendido no se cree", () => {
  assert.equal(esquinaDeCasilla(lector(capas(ojo, icono(200))), ANCLA), null);
});

test("una casilla pegada al borde del recorte no se lee", () => {
  assert.equal(esquinaDeCasilla(lector(capas(icono(200))), { x: 20, y: 20 }), null);
});
