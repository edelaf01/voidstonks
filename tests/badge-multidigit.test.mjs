import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// 3-digit badges (relic counts from 87 to 119) and resolution independence of the reading
// skipped when the user's capture is missing

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { readBadgeDigits } = await import("../deploy/js/utils/vision/badge_digit_ocr.js");

const IMG = "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/reliquias3.png";
const hasCapture = fs.existsSync(IMG);

// ground truth read from the capture (INVENTORY/SELL, RELICS tab)
const GT = [
  ["119", "117", "113", "111", "109", "108"],
  ["108", "106", "104", "103", "103", "102"],
  ["102", "100", "97", "95", "93", "87"],
];

// bilinear downscale to mimic a lower resolution stream
function downscale(src, factor) {
  const W = Math.round(src.width * factor), H = Math.round(src.height * factor);
  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx0 = x / factor, sy0 = y / factor;
      const x0 = Math.floor(sx0), y0 = Math.floor(sy0);
      const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
      const fx = sx0 - x0, fy = sy0 - y0;
      for (let ch = 0; ch < 4; ch++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + ch];
        const p10 = src.data[(y0 * src.width + x1) * 4 + ch];
        const p01 = src.data[(y1 * src.width + x0) * 4 + ch];
        const p11 = src.data[(y1 * src.width + x1) * 4 + ch];
        out.data[(y * W + x) * 4 + ch] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return out;
}

function readAll(img) {
  const snap = new FakeCanvas();
  snap.width = img.width; snap.height = img.height; snap._data.set(img.data);
  const calib = VisionService.detectGridAutoCalib(img, img.width, img.height);
  const theme = VisionService.detectThemeFromSnapshot(
    snap, calib.gridZone.x, calib.gridZone.y, calib.gridZone.w, calib.gridZone.h);
  const grid = VisionService.buildAutoGrid(snap, calib.gridZone, theme, calib);
  const misses = [];
  let total = 0;
  for (const cell of grid.cellRects) {
    const gt = GT[cell.r]?.[cell.c];
    if (gt === undefined) continue;
    total++;
    // same chain as the live scanner: brightness first, the theme color fallback only when it finds no digit
    let read = readBadgeDigits(VisionService.extractBadgeBright(snap, cell, grid.cellW, grid.cellH));
    if (!/\d/.test(read)) {
      const alt = VisionService.extractBadgeByColor(snap, cell, grid.cellW, grid.cellH, theme);
      if (alt) {
        const altRead = readBadgeDigits(alt);
        if (/\d/.test(altRead)) read = altRead;
      }
    }
    if (read !== gt) misses.push(`r${cell.r}c${cell.c} ${gt}->"${read}"`);
  }
  return { total, misses };
}

test("badges de 3 cifras: 18/18 a resolución nativa (1440p)",
  { skip: !hasCapture && "captura no disponible" }, () => {
    const raw = decodePng(fs.readFileSync(IMG));
    const { total, misses } = readAll(raw);
    assert.equal(total, 18, "deben evaluarse las 18 celdas con badge");
    assert.deepEqual(misses, [], `fallos: ${misses.join(" ")}`);
  });

test("badges de 3 cifras: la ruta por BRILLO sola ya lee las 3 cifras (sin respaldo)",
  { skip: !hasCapture && "captura no disponible" }, () => {
    const raw = decodePng(fs.readFileSync(IMG));
    const snap = new FakeCanvas();
    snap.width = raw.width; snap.height = raw.height; snap._data.set(raw.data);
    const calib = VisionService.detectGridAutoCalib(raw, raw.width, raw.height);
    const theme = VisionService.detectThemeFromSnapshot(
      snap, calib.gridZone.x, calib.gridZone.y, calib.gridZone.w, calib.gridZone.h);
    const grid = VisionService.buildAutoGrid(snap, calib.gridZone, theme, calib);
    const misses = [];
    for (const cell of grid.cellRects) {
      const gt = GT[cell.r]?.[cell.c];
      if (gt === undefined) continue;
      const read = readBadgeDigits(VisionService.extractBadgeBright(snap, cell, grid.cellW, grid.cellH));
      if (read !== gt) misses.push(`r${cell.r}c${cell.c} ${gt}->"${read}"`);
    }
    assert.deepEqual(misses, [], `la ruta de brillo falla en: ${misses.join(" ")}`);
  });

for (const [label, factor] of [["1080p", 0.75], ["900p", 0.625], ["720p", 0.5]]) {
  test(`badges de 3 cifras: 18/18 con el stream escalado a ${label}`,
    { skip: !hasCapture && "captura no disponible" }, () => {
      const raw = decodePng(fs.readFileSync(IMG));
      const { total, misses } = readAll(downscale(raw, factor));
      assert.equal(total, 18, "deben evaluarse las 18 celdas con badge");
      assert.deepEqual(misses, [], `fallos: ${misses.join(" ")}`);
    });
}
