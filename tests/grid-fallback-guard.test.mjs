import { test } from "node:test";
import assert from "node:assert/strict";
import { isImplausibleFallbackGrid } from "../deploy/js/utils/vision/grid_detect.js";

// Rechazo de calibraciones manuales guardadas basura como fallback del auto-grid.
// Datos reales: la detección automática sobre la captura de inventario 2531x1412 da
// zona (56,254,1662,873) celda 277x291 6 columnas (confianza 0.9). La calibración
// manual basura observada en vivo era zona (10,4,2550,1389) celda 510x463 3x5.

test("acepta la rejilla real detectada (6x3, celdas ~11% ancho)", () => {
  const real = { gridZone: { x: 56, y: 254, w: 1662, h: 873 }, cellW: 277, cellH: 291, cols: 6, rows: 3 };
  assert.equal(isImplausibleFallbackGrid(real, 2531, 1412), false);
});

test("rechaza la calibración manual basura (zona = pantalla completa, celdas enormes)", () => {
  const junk = { gridZone: { x: 10, y: 4, w: 2550, h: 1389 }, cellW: 510, cellH: 463, cols: 5, rows: 3 };
  assert.equal(isImplausibleFallbackGrid(junk, 2548, 1390), true);
});

test("rechaza zona que invade el panel de venta (>85% del ancho)", () => {
  const wide = { gridZone: { x: 40, y: 250, w: 2300, h: 870 }, cellW: 280, cellH: 290 };
  assert.equal(isImplausibleFallbackGrid(wide, 2531, 1412), true);
});

test("rechaza celdas demasiado anchas aunque la zona sea estrecha (pocas columnas)", () => {
  const fewCols = { gridZone: { x: 56, y: 254, w: 900, h: 873 }, cellW: 450, cellH: 291 };
  assert.equal(isImplausibleFallbackGrid(fewCols, 2531, 1412), true);
});

test("null / sin zona / sin dims -> implausible", () => {
  assert.equal(isImplausibleFallbackGrid(null, 2531, 1412), true);
  assert.equal(isImplausibleFallbackGrid({}, 2531, 1412), true);
  assert.equal(isImplausibleFallbackGrid({ gridZone: { w: 0, h: 0 } }, 2531, 1412), true);
  assert.equal(isImplausibleFallbackGrid({ gridZone: { w: 1662, h: 873 } }, 0, 0), true);
});
