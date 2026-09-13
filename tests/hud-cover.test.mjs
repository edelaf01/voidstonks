// Dónde termina la cabecera del inventario, medido en el margen sobre la primera fila.
//
// Al final de la lista la primera fila queda bajo los iconos y su badge se leía como basura
// ("Trumna BDG 86") o como nada. La altura del HUD cambia con la escala de interfaz: se mide una
// vez por sesión en la franja sin cards que el recorte deja sobre la primera fila, y después cada
// página salta la fila 0 si su badge arranca por encima de ese borde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { brightColumnCoverage, hudBottom } from "../deploy/js/utils/vision/hud_cover.js";

const W = 600, H = 400;

function lienzo() {
  const px = new Uint8ClampedArray(W * H * 4).fill(30);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const pinta = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 230; } };
  const snapshot = { height: H, getContext: () => ({ getImageData: (x, y, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) data.set(px.subarray(((y + yy) * W + x) * 4, ((y + yy) * W + x + w) * 4), yy * w * 4);
    return { data, width: w, height: h };
  } }) };
  return { px, pinta, snapshot };
}
const badges = (pinta, top) => { for (let c = 0; c < 6; c++) pinta(c * 100 + 8, c * 100 + 28, top + 4, top + 12); };
// Fila de iconos: 40 trazos de 4 px separados 8 px, como los glifos de los iconos de categoría
// (cubren un tercio del ancho y alternan sin parar).
const iconos = (pinta, y0, y1) => { for (let k = 0; k < 40; k++) pinta(30 + k * 12, 34 + k * 12, y0, y1); };

test("mide qué parte del ancho tiene algo claro", () => {
  const { snapshot, pinta } = lienzo();
  pinta(0, 150, 0, 4);
  assert.equal(brightColumnCoverage(snapshot.getContext().getImageData(0, 0, W, 4)), 0.25);
  assert.equal(brightColumnCoverage({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), 0);
});

test("el borde del HUD es la banda MÁS BAJA que cubre casi todo el ancho", () => {
  const { snapshot, pinta } = lienzo();
  iconos(pinta, 10, 16);     // pestañas
  iconos(pinta, 40, 46);     // fila de iconos, más abajo
  badges(pinta, 60);         // badges de una fila: poco ancho, no cuentan
  assert.equal(hudBottom(snapshot.getContext().getImageData(0, 0, W, 100)), 48);
  const { snapshot: vacio } = lienzo();
  assert.equal(hudBottom(vacio.getContext().getImageData(0, 0, W, 100)), null);
});

test("un tema oscuro también cuenta: lo claro es relativo al fondo de la banda", () => {
  const { snapshot, px } = lienzo();
  // Iconos rojo oscuro (luma ~95, medido en el tema Stalker) sobre fondo casi negro.
  for (let k = 0; k < 40; k++) for (let y = 20; y < 26; y++) for (let x = 30 + k * 12; x < 34 + k * 12; x++) { const i = (y * W + x) * 4; px[i] = 200; px[i + 1] = 50; px[i + 2] = 55; }
  assert.equal(hudBottom(snapshot.getContext().getImageData(0, 0, W, 60)), 30);
});
