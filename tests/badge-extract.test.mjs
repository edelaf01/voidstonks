import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

// ===========================================================================
// Regresión de extractBadgeByColor sobre una CAPTURA REAL del inventario
// (tests/_fixtures/inventory_ballistica_banshee_2531x1412.png).
//
// Bugs cubiertos (verdad de terreno de la sesión en vivo del 2026-07-13):
//   BUG 1 — (r2,c1) Ballistica Prime Blueprint, badge real = 3, leído "31":
//     las líneas verticales finas del arte del plano (mástiles, x≈77 del crop)
//     tienen exactamente la firma de forma de un "1" (ar≈0.06) y a escala de
//     captura en vivo superan el alto mínimo del filtro de forma.
//   BUG 2 — (r2,c5) Banshee Prime Blueprint, badge real = 9, leído "Ø" (qty 1):
//     un bloque alto de arte brillante (bbox [60,27]-[96,85], h/safeH=0.686)
//     pasaba el filtro de forma y estiraba el crop final a todo el ancho.
// Fix: filtro de BANDA en vision.service.js — todo superviviente cuyo centro
// vertical se aleja del centro del superviviente más brillante (checkmark o
// dígito) más de 0.5*min(alturas) es arte y se borra (hardErased).
//
// Se verifican las etapas de PÍXELES (qué componentes sobreviven, geometría del
// crop final) y la lectura con el lector de PRODUCCIÓN (readBadgeDigits).
// ===========================================================================

installFakeDocument(); // antes del import dinámico: vision.service.js crea canvases al cargar
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
const { readBadgeDigits } = await import("../deploy/js/utils/vision/badge_digit_ocr.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "_fixtures", "inventory_ballistica_banshee_2531x1412.png");

// Auto-grid detectada en esta captura: zona (87,281), celda 277x296, phase dy=-44.
const GRID = { gx: 87, gy: 281, cellW: 277, cellH: 296, dy: -44 };

// Tema medido por detectThemeFromSnapshot sobre el header de esta misma captura
// (Default, color real en pantalla rgb(246,129,3)) — valor fijado por el harness offline.
const THEME = { name: "Default", r: 227, g: 128, b: 20, actualR: 246, actualG: 129, actualB: 3 };

// safeW/safeH que usa extractBadgeByColor con esta celda: 97 x 86
// cropW/cropH bajaron (de 56-69 x ~42 a 29-56 x 33-40) al pasar la selección de componentes a
// anclarse en el checkmark: el recorte que se devuelve es ahora SOLO el número, sin el checkmark
// delante. Es el cambio que llevó los badges de 86/96 a 94/96 sobre seis resoluciones
// (ver utils/vision/badge_anchor.js y tests/scanner-reescalado.test.mjs).
const CELLS = [
  { name: "r2c1 Ballistica Prime BP", r: 2, c: 1, qty: "3", cropW: 56, cropH: 40 },
  { name: "r2c5 Banshee Prime BP", r: 2, c: 5, qty: "9", cropW: 30, cropH: 34 },
  { name: "r0c2 Astilla Prime BP", r: 0, c: 2, qty: "3", cropW: 30, cropH: 33 },
  { name: "r1c2 Atlas Prime BP", r: 1, c: 2, qty: "11", cropW: 41, cropH: 33 },
  { name: "r2c2 Banshee Prime Chassis", r: 2, c: 2, qty: "3", cropW: 29, cropH: 33 },
  { name: "r2c4 Banshee Prime Systems", r: 2, c: 4, qty: "2", cropW: 30, cropH: 33 },
];

const snapshot = decodePng(fs.readFileSync(FIXTURE));

function cellAt(r, c) {
  return { sx: GRID.gx + c * GRID.cellW, sy: GRID.gy + r * GRID.cellH + GRID.dy };
}

function extract(snap, r, c) {
  return VisionService.extractBadgeByColor(snap, cellAt(r, c), GRID.cellW, GRID.cellH, THEME);
}

// ===========================================================================
// Etapas de píxeles: geometría del crop final por celda
// ===========================================================================

for (const cell of CELLS) {
  test(`extractBadgeByColor píxeles: ${cell.name} (qty real ${cell.qty})`, () => {
    const badge = extract(snapshot, cell.r, cell.c);
    assert.ok(badge, "debe devolver un canvas de badge");
    assert.ok(Math.abs(badge.cropH - cell.cropH) <= 3, `cropH ${badge.cropH} debería ser ~${cell.cropH}`);
    // Ancho: SOLO los dígitos, sin arte del ítem. Pre-fix Banshee BP daba 97 (todo el ancho
    // del crop, arte incluido) — la cota <70 es la regresión de BUG 2.
    assert.ok(Math.abs(badge.cropW - cell.cropW) <= 3, `cropW ${badge.cropW} debería ser ~${cell.cropW}`);
    assert.ok(badge.cropW < 70, `cropW ${badge.cropW} no debe alcanzar el arte del ítem (pre-fix: 97)`);
  });
}

// ===========================================================================
// BUG 1 (mecanismo): línea vertical fina de arte a la derecha del dígito.
// En el fixture la línea (x=77 del crop, y 14-25, h=12) no llega al alto mínimo
// del filtro de forma, pero en vivo sí lo superaba → "31". Se alarga la línea
// pintándola con el color del tema hasta h=18 (pasa forma, luma y posicional)
// y se comprueba que el filtro de banda la borra igualmente.
// ===========================================================================

test("extractBadgeByColor: línea de arte alargada junto al 3 de Ballistica no entra al crop (BUG 1)", () => {
  const snap = { width: snapshot.width, height: snapshot.height, data: snapshot.data.slice() };
  const { sx, sy } = cellAt(2, 1);
  const lineX = sx + 77;              // columna de la línea de arte en la captura real
  for (let y = sy - 12 + 26; y <= sy - 12 + 31; y++) { // alarga de y=25 a y=31 del crop
    const o = (y * snap.width + lineX) * 4;
    snap.data[o] = THEME.actualR; snap.data[o + 1] = THEME.actualG; snap.data[o + 2] = THEME.actualB;
  }
  const badge = extract(snap, 2, 1);
  assert.ok(badge, "debe devolver un canvas de badge");
  assert.ok(badge.cropW < 70, `cropW ${badge.cropW}: la línea de arte (x=77) habría estirado el crop a ~86`);
});

// ===========================================================================
// Lectura real de las mismas 6 celdas.
//
// Con el LECTOR DE PRODUCCIÓN (readBadgeDigits, template-matching), no con el binario
// `tesseract`: los badges dejaron de pasar por Tesseract cuando se midió que fallaba en
// dígitos aislados (30/35 frente a 33/35). Comprobarlos con el CLI medía una ruta que la
// app ya no ejecuta —y con el recorte anclado, que va tan ceñido al número, el CLI devuelve
// cadena vacía en varias mientras el matcher las acierta todas—.
// ===========================================================================

for (const cell of CELLS) {
  test(`badge leído: ${cell.name} -> ${cell.qty}`, () => {
    const badge = extract(snapshot, cell.r, cell.c);
    assert.ok(badge, "debe devolver un canvas de badge");
    assert.equal(readBadgeDigits(badge), cell.qty);
  });
}
