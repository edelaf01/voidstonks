import { test } from "node:test";
import assert from "node:assert/strict";
import { NW, NH, DIGIT_TEMPLATES, segmentDigits, readBadgeDigits, iou } from "../deploy/js/utils/vision/badge_digit_ocr.js";

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
  assert.equal(segmentDigits(canvas).length, 1);
  assert.equal(readBadgeDigits(canvas), "");
});

test("readBadgeDigits: mota de ruido demasiado pequeña/baja no cuenta como dígito", () => {
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

test("entre 5 y 6 decide por donde las plantillas difieren, no por el IoU global", () => {
  for (const d of ["5", "6", "3", "8", "0"]) {
    const cvs = canvasFromDigits(NW + 4, NH + 4, [{ x: 2, y: 2, bmp: DIGIT_TEMPLATES[d] }]);
    assert.equal(readBadgeDigits(cvs), d, `la plantilla de ${d} debe leerse como ${d}`);
  }
});

test("badgePlausible: una a tres cifras y nada más", async () => {
  const { badgePlausible } = await import("../deploy/js/utils/vision/badge_digit_ocr.js");
  for (const ok of ["2", "27", "127", " 48 "]) assert.equal(badgePlausible(ok), true, ok);
  for (const mal of ["85603", "1234", "", null, "Ø", "2 7", "a7"]) assert.equal(badgePlausible(mal), false, String(mal));
});
