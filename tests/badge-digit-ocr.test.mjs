import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument, FakeCanvas } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Regresión del template-matching de badges (utils/badge_digit_ocr.js) sobre
// CAPTURAS REALES del inventario, corriendo el pipeline VisionService real
// (autogrid + tema + extractBadgeByColor) igual que en producción.
//
// Prototipo offline validado: template-match 33/35 vs Tesseract 30/35 sobre
// estas 2 mismas capturas. Este test fija esa cota como regresión y verifica
// explícitamente los casos que Tesseract fallaba (dígitos aislados 4/8/9 que
// leía vacíos) y los multi-dígito (10, 19).
//
// Se salta entero si la carpeta de capturas del usuario no existe (no se
// commitea ni se distribuye con el repo).
// ===========================================================================

installFakeDocument();
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { readBadgeDigits } = await import("../deploy/js/utils/vision/badge_digit_ocr.js");

const DIR = "/home/ppsoy/Imágenes/Capturas de pantalla/inventario";
const hasCaptures = fs.existsSync(DIR);

// Verdad de terreno (fila x col, "" = sin badge en esa celda).
const GT = {
  "214630.png": [["4", "3", "3", "3", "3", ""], ["2", "2", "8", "4", "2", "2"], ["3", "2", "5", "2", "3", "2"]],
  "215138.png": [["2", "10", "9", "6", "2", "2"], ["2", "4", "2", "6", "8", "19"], ["6", "2", "4", "3", "5", "6"]],
};
const IMGS = {
  "214630.png": "Captura de pantalla_20260714_214630.png",
  "215138.png": "Captura de pantalla_20260714_215138.png",
};

function badgesForImage(tag) {
  const raw = decodePng(fs.readFileSync(path.join(DIR, IMGS[tag])));
  const snap = new FakeCanvas();
  snap.width = raw.width; snap.height = raw.height; snap._data.set(raw.data);
  const calib = VisionService.detectGridAutoCalib(raw, raw.width, raw.height);
  const theme = VisionService.detectThemeFromSnapshot(snap, calib.gridZone.x, calib.gridZone.y, calib.gridZone.w, calib.gridZone.h);
  const grid = VisionService.buildAutoGrid(snap, calib.gridZone, theme, calib);
  const out = [];
  for (const cell of grid.cellRects) {
    const badge = VisionService.extractBadgeByColor(snap, cell, grid.cellW, grid.cellH, theme);
    out.push({ r: cell.r, c: cell.c, badge });
  }
  return out;
}

test("template-match de badges: precisión global sobre las 2 capturas (>= 32/35)", { skip: !hasCaptures && "carpeta de capturas no disponible" }, () => {
  let ok = 0, total = 0;
  const misses = [];
  for (const tag of Object.keys(GT)) {
    const cells = badgesForImage(tag);
    for (const { r, c, badge } of cells) {
      const gt = GT[tag][r]?.[c];
      if (!gt) continue; // celdas sin badge no cuentan
      total++;
      const read = readBadgeDigits(badge);
      if (read === gt) ok++;
      else misses.push(`${tag} r${r}c${c}: esperado "${gt}" leído "${read}"`);
    }
  }
  assert.equal(total, 35, `verdad de terreno debería cubrir 35 celdas con badge, cubrió ${total}`);
  assert.ok(ok >= 32, `template-match ${ok}/${total} (< 32) — fallos: ${misses.join("; ")}`);
});

// Casos puntuales que Tesseract fallaba en vivo (dígitos aislados sin línea
// base, que Tesseract lee como cadena vacía) y deben acertar con el matching.
const SPECIFIC_CASES = [
  { tag: "214630.png", r: 0, c: 0, name: "Odonata BP (dígito 4 + icono de fundición)", expect: "4" },
  { tag: "215138.png", r: 0, c: 2, name: "Corvas Stock", expect: "9" },
  { tag: "215138.png", r: 1, c: 4, name: "Dakra Handle", expect: "8" },
  { tag: "215138.png", r: 0, c: 1, name: "multi-dígito 10", expect: "10" },
  { tag: "215138.png", r: 1, c: 5, name: "multi-dígito 19", expect: "19" },
];

for (const kase of SPECIFIC_CASES) {
  test(`template-match: ${kase.name} (${kase.tag} r${kase.r}c${kase.c}) = ${kase.expect}`, { skip: !hasCaptures && "carpeta de capturas no disponible" }, () => {
    const cells = badgesForImage(kase.tag);
    const cell = cells.find((x) => x.r === kase.r && x.c === kase.c);
    assert.ok(cell, "celda debe existir en la rejilla detectada");
    assert.equal(readBadgeDigits(cell.badge), kase.expect);
  });
}

// ===========================================================================
// Regresión "checkmark/arte dentro del crop" (fixture Ballistica/Banshee, que
// está en tests/_fixtures y NO depende de la carpeta del usuario).
//
// En algunas celdas extractBadgeByColor deja el checkmark ✓ (círculo con check)
// o arte/icono de fundición dentro del crop, junto al dígito. El template los
// puntúa bajo (~0.48 contra "9") mientras el dígito real puntúa ≥0.77; deben
// DESCARTARSE, no leerse como un dígito extra. Antes esto daba "93"/"36" para un
// badge cuya cantidad real es 3 (reportado en vivo: "ballistica detecta 36").
// ===========================================================================

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), "_fixtures", "inventory_ballistica_banshee_2531x1412.png");
const FIX_THEME = { name: "Default", r: 227, g: 128, b: 20, actualR: 246, actualG: 129, actualB: 3 };
const FIX_GRID = { gx: 87, gy: 281, cellW: 277, cellH: 296, dy: -44 };

test("readBadgeDigits descarta el checkmark del crop (Ballistica BP = 3, no 93/36)", { skip: !fs.existsSync(FIXTURE) && "sin fixture" }, () => {
  const raw = decodePng(fs.readFileSync(FIXTURE));
  const cell = { sx: FIX_GRID.gx + 1 * FIX_GRID.cellW, sy: FIX_GRID.gy + 2 * FIX_GRID.cellH + FIX_GRID.dy };
  const badge = VisionService.extractBadgeByColor(raw, cell, FIX_GRID.cellW, FIX_GRID.cellH, FIX_THEME);
  assert.ok(badge, "debe extraer un badge");
  assert.equal(readBadgeDigits(badge), "3", "el checkmark/arte no debe leerse como dígito extra");
});
