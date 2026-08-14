import { test } from "node:test";
import assert from "node:assert/strict";
import { NW, NH, DIGIT_TEMPLATES, segmentDigits, readBadgeDigits, iou } from "../deploy/js/utils/vision/badge_digit_ocr.js";

// ===========================================================================
// Tests unitarios PUROS de badge_digit_ocr.js con bitmaps sintéticos (sin
// imágenes ni pipeline real): construyen un canvasLike ({width,height,data}
// RGBA blanco/negro) a mano a partir de las propias DIGIT_TEMPLATES para
// verificar segmentación, IoU y rechazo de forma aislada del resto del
// pipeline (grid/tema/crop), que ya se cubre en badge-digit-ocr.test.mjs.
// ===========================================================================

// Dibuja uno o más bitmaps NW×NH sobre un canvas blanco de w×h en las
// posiciones dadas (negro = dígito, blanco = fondo).
function canvasFromDigits(w, h, placements) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const { x, y, bmp } of placements) {
    for (let yy = 0; yy < NH; yy++) {
      for (let xx = 0; xx < NW; xx++) {
        if (!bmp[yy * NW + xx]) continue;
        const px = x + xx, py = y + yy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const o = (py * w + px) * 4;
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
      }
    }
  }
  return { width: w, height: h, data };
}

test("iou: bitmaps idénticos dan 1, disjuntos dan 0", () => {
  const a = new Uint8Array([1, 1, 0, 0]);
  const b = new Uint8Array([1, 1, 0, 0]);
  const c = new Uint8Array([0, 0, 1, 1]);
  assert.equal(iou(a, b), 1);
  assert.equal(iou(a, c), 0);
});

test("segmentDigits: canvas vacío (todo blanco) no produce componentes", () => {
  const blank = { width: NW, height: NH, data: new Uint8ClampedArray(NW * NH * 4).fill(255) };
  assert.deepEqual(segmentDigits(blank), []);
});

test("segmentDigits: null/undefined no rompe, devuelve []", () => {
  assert.deepEqual(segmentDigits(null), []);
  assert.deepEqual(segmentDigits(undefined), []);
});

for (const digit of "0123456789") {
  test(`readBadgeDigits: glifo idéntico a la plantilla "${digit}" se lee como "${digit}"`, () => {
    const canvas = canvasFromDigits(NW, NH, [{ x: 0, y: 0, bmp: DIGIT_TEMPLATES[digit] }]);
    assert.equal(readBadgeDigits(canvas), digit);
  });
}

test("readBadgeDigits: dos dígitos lado a lado se leen en orden izquierda->derecha (1,9 -> \"19\")", () => {
  const gap = 4;
  const w = NW * 2 + gap;
  const canvas = canvasFromDigits(w, NH, [
    { x: 0, y: 0, bmp: DIGIT_TEMPLATES["1"] },
    { x: NW + gap, y: 0, bmp: DIGIT_TEMPLATES["9"] },
  ]);
  assert.equal(readBadgeDigits(canvas), "19");
});

test("readBadgeDigits: dos dígitos lado a lado en orden inverso mantiene el orden espacial (9,1 -> \"91\")", () => {
  const gap = 4;
  const w = NW * 2 + gap;
  const canvas = canvasFromDigits(w, NH, [
    { x: 0, y: 0, bmp: DIGIT_TEMPLATES["9"] },
    { x: NW + gap, y: 0, bmp: DIGIT_TEMPLATES["1"] },
  ]);
  assert.equal(readBadgeDigits(canvas), "91");
});

test("readBadgeDigits: glifo ruidoso (checkerboard, muy distinto de cualquier dígito) se RECHAZA (\"\")", () => {
  const w = NW, h = NH;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x + y) % 2 !== 0) continue;
      const o = (y * w + x) * 4;
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
    }
  }
  const canvas = { width: w, height: h, data };
  // El checkerboard SÍ segmenta (1 componente conexo vía 8-conn), pero su IoU
  // contra las 10 plantillas queda por debajo de MIN_IOU (~0.35-0.38 medido) -> "".
  assert.equal(segmentDigits(canvas).length, 1);
  assert.equal(readBadgeDigits(canvas), "");
});

test("readBadgeDigits: mota de ruido demasiado pequeña/baja no cuenta como dígito", () => {
  // Un blob de 2x2 en la esquina: no llega a área>=15 ni a alto>=0.4*H.
  const w = NW, h = NH;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const o = (y * w + x) * 4;
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
    }
  }
  const canvas = { width: w, height: h, data };
  assert.deepEqual(segmentDigits(canvas), []);
  assert.equal(readBadgeDigits(canvas), "");
});
