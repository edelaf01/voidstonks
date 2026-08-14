import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Regresión de badges de 3 CIFRAS (inventario de reliquias con cantidades de
// 87 a 119) y de la INDEPENDENCIA DE RESOLUCIÓN de la lectura.
//
// Motivo: el badge se leía truncado ("119"→"11") y varios umbrales del pipeline
// estaban en píxeles ABSOLUTOS (área mínima de componente, borrado de líneas de
// borde, padding superior), así que se comportaban distinto según la resolución
// del cliente — el escáner en vivo puede recibir el stream a 1080p, 1440p o 4K.
// Aquí se fija que las 18 celdas se leen bien a resolución nativa Y escaladas.
//
// Se salta si la captura del usuario no está (no se commitea con el repo).
// ===========================================================================

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { readBadgeDigits } = await import("../deploy/js/utils/vision/badge_digit_ocr.js");

const IMG = "/home/ppsoy/Imágenes/Capturas de pantalla/nofunciona/reliquias3.png";
const hasCapture = fs.existsSync(IMG);

// Verdad de terreno leída de la captura (INVENTORY/SELL, pestaña RELICS).
const GT = [
  ["119", "117", "113", "111", "109", "108"],
  ["108", "106", "104", "103", "103", "102"],
  ["102", "100", "97", "95", "93", "87"],
];

// Reescalado bilineal para simular el stream a menor resolución.
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
    // MISMA CADENA que el scanner en vivo (scanner.service.js): primero la lectura por
    // BRILLO y, sólo si no saca ningún dígito, el respaldo por color de tema. Probar
    // únicamente extractBadgeByColor daba 18/18 mientras la app fallaba 4/18, porque la
    // ruta que corre de verdad es la de brillo — el bug de las 3 cifras vivía ahí.
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

// Regresión directa del bug: extractBadgeBright recortaba 0.40·cellW (111px con cellW=277),
// suficiente para checkmark + 2 dígitos pero NO para la 3ª cifra, que empieza hacia x115.
// Resultado: "119"→"11", "129"→"12" en TODOS los badges de 3 cifras (4/18 aciertos), mientras
// la ruta por color acertaba 18/18 — por eso el fallo no aparecía probando sólo esa rama.
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

// El escáner en vivo puede recibir el stream escalado; los umbrales del pipeline
// deben ser relativos al tamaño de celda para que la lectura no dependa de ello.
for (const [label, factor] of [["1080p", 0.75], ["900p", 0.625], ["720p", 0.5]]) {
  test(`badges de 3 cifras: 18/18 con el stream escalado a ${label}`,
    { skip: !hasCapture && "captura no disponible" }, () => {
      const raw = decodePng(fs.readFileSync(IMG));
      const { total, misses } = readAll(downscale(raw, factor));
      assert.equal(total, 18, "deben evaluarse las 18 celdas con badge");
      assert.deepEqual(misses, [], `fallos: ${misses.join(" ")}`);
    });
}
