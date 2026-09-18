import { test } from "node:test";
import assert from "node:assert/strict";
import { labelTop } from "../deploy/js/utils/vision/label_band.js";

const W = 240, H = 240;
function mascara() {
  const m = new Uint8Array(W * H);
  const pinta = (y0, y1, x0 = 60, x1 = 180) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; };
  const linea = (y0) => { for (let y = y0; y < y0 + 20; y++) for (let x = 60; x < 180; x++) if ((x >> 2) % 2 === 0) m[y * W + x] = 1; };
  return { m, pinta, linea };
}

test("tres líneas de rótulo bajo el arte: el corte cae justo encima de la primera", () => {
  const { m, pinta, linea } = mascara();
  pinta(20, 120, 40, 200);
  linea(142); linea(170); linea(198);
  const top = labelTop(m, W, H);
  assert.ok(top < 142 && top >= 120, `top=${top}`);
});

test("el arte que llega hasta el rótulo con trazos finos no lo arrastra", () => {
  // wire: 15 px/row down to first line (larkspur leaves 25-35 against 60-110 for a text line)
  const { m, linea } = mascara();
  for (let y = 30; y < 176; y++) for (let x = 50; x < 65; x++) m[y * W + x] = 1;
  linea(176); linea(204);
  const top = labelTop(m, W, H);
  assert.ok(top < 176 && top >= 150, `top=${top}`);
});

test("el borde inferior de la casilla no es una línea", () => {
  const { m, pinta, linea } = mascara();
  linea(200);
  pinta(232, 240, 0, W);
  const top = labelTop(m, W, H);
  assert.ok(top < 200 && top >= 180, `top=${top}`);
});

test("sin nada que parezca texto no se corta nada", () => {
  const { m, pinta } = mascara();
  pinta(100, 235, 20, 220);
  assert.equal(labelTop(m, W, H), 0);
  assert.equal(labelTop(new Uint8Array(W * H), W, H), 0);
});
