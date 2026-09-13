// where a MISSION COMPLETE cell's label starts, from the mask
// in gold themes the icon art has the theme colour and fell into the mask, so tesseract read garbage over
// a clean name: the cut must sit above the first label line and ignore thin art strokes and the cell's
// bottom edge
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelTop } from "../deploy/js/utils/vision/label_band.js";

const W = 240, H = 240;
function mascara() {
  const m = new Uint8Array(W * H);
  const pinta = (y0, y1, x0 = 60, x1 = 180) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; };
  // one text line: 20 dense rows (letters) with gaps between glyphs
  const linea = (y0) => { for (let y = y0; y < y0 + 20; y++) for (let x = 60; x < 180; x++) if ((x >> 2) % 2 === 0) m[y * W + x] = 1; };
  return { m, pinta, linea };
}

test("tres líneas de rótulo bajo el arte: el corte cae justo encima de la primera", () => {
  const { m, pinta, linea } = mascara();
  pinta(20, 120, 40, 200);            // solid art on top
  linea(142); linea(170); linea(198);  // label at 0.59 / 0.71 / 0.83
  const top = labelTop(m, W, H);
  assert.ok(top < 142 && top >= 120, `top=${top}`);
});

test("el arte que llega hasta el rótulo con trazos finos no lo arrastra", () => {
  // wire: 15 pixels per row down to the first line (larkspur leaves 25-35 against 60-110 for a text line)
  const { m, linea } = mascara();
  for (let y = 30; y < 176; y++) for (let x = 50; x < 65; x++) m[y * W + x] = 1;
  linea(176); linea(204);
  const top = labelTop(m, W, H);
  assert.ok(top < 176 && top >= 150, `top=${top}`);
});

test("el borde inferior de la casilla no es una línea", () => {
  const { m, pinta, linea } = mascara();
  linea(200);            // one line ("Endo")
  pinta(232, 240, 0, W); // gold border at the bottom
  const top = labelTop(m, W, H);
  assert.ok(top < 200 && top >= 180, `top=${top}`);
});

test("sin nada que parezca texto no se corta nada", () => {
  const { m, pinta } = mascara();
  pinta(100, 235, 20, 220); // one huge blob (art over the name)
  assert.equal(labelTop(m, W, H), 0);
  assert.equal(labelTop(new Uint8Array(W * H), W, H), 0);
});
