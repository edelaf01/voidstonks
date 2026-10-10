import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();

const { faseDesdeBandas, rejillaDesdeMemoria, rejillaConMemoria, memoriaDeRejilla } = await import("../deploy/js/utils/vision/grid_memoria.js");
const { detectInventoryGrid } = await import("../deploy/js/utils/vision/grid_detect.js");
const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");

const CELDA = 222;
const filaDeBandas = (top) => [{ y0: Math.round(top + 0.14 * CELDA), y1: Math.round(top + 0.645 * CELDA) }, { y0: Math.round(top + 0.755 * CELDA), y1: Math.round(top + 0.92 * CELDA) }];
const MEMORIA = { cellW: 207, cellH: CELDA, cols: 6, gridX: 70 };
const IMG = { width: 1300, height: 858 };
const fixture = () => decodePng(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "_fixtures/inventory_arcanes_1920x1080.png")));

test("faseDesdeBandas: tres filas de icono y nombre dan su fase y ninguna rival cerca", () => {
  const a = faseDesdeBandas([77, 299, 521].flatMap(filaDeBandas), CELDA);
  assert.ok(Math.abs(a.fase - 77) <= 2, `fase ${a.fase}`);
  assert.equal(a.buenas, 6);
  assert.ok(a.rival < a.puntos * 0.75);
  assert.equal(faseDesdeBandas([], CELDA), null);
  assert.equal(faseDesdeBandas(filaDeBandas(0), 0), null);
});

test("rejillaDesdeMemoria: la geometría sale de la memoria y la fase y las filas de las bandas", () => {
  const trace = {};
  const r = rejillaDesdeMemoria([77, 299, 521].flatMap(filaDeBandas), MEMORIA, IMG, trace);
  assert.equal(r.cols, 6);
  assert.equal(r.cellW, 207);
  assert.equal(r.cellH, 222);
  assert.equal(r.gridX, 70);
  assert.ok(Math.abs(r.gridY - 77) <= 2);
  assert.equal(r.rows, 3);
  assert.equal(r.deMemoria, true);
  assert.equal(r.gridZone.x, 70);
  assert.equal(r.gridZone.w, Math.min(6 * 207, 1300 - 70));
  assert.equal(r.gridZone.h, Math.min(3 * CELDA, 858 - r.gridY));
  assert.ok(trace.memoria.puntos >= 1);
});

test("rejillaDesdeMemoria: una fila cortada por arriba más de 0.15 de celda no cuenta", () => {
  const trace = {};
  const bandas = [{ y0: 108, y1: 144 }, ...filaDeBandas(162), ...filaDeBandas(384)];
  const r = rejillaDesdeMemoria(bandas, MEMORIA, IMG, trace);
  assert.ok(Math.abs(r.gridY - 162) <= 2);
  assert.equal(r.rows, 2);
});

test("rejillaDesdeMemoria: con una sola banda o con dos fases igual de buenas no se inventa la rejilla", () => {
  assert.equal(rejillaDesdeMemoria([filaDeBandas(77)[0]], MEMORIA, IMG), null);
  const bandas = [0, 1, 2, 3].map((k) => ({ y0: Math.round(40 + k * CELDA / 2), y1: Math.round(40 + k * CELDA / 2 + 0.505 * CELDA) }));
  assert.equal(rejillaDesdeMemoria(bandas, MEMORIA, IMG), null);
});

test("rejillaConMemoria: una detección por bordes manda aunque no case con la memoria", () => {
  const calib = { cellW: 300, cellH: 320, cols: 4, gridX: 0 };
  assert.equal(rejillaConMemoria(calib, { bands: [77, 299, 521].flatMap(filaDeBandas) }, MEMORIA, IMG), calib);
  assert.equal(rejillaConMemoria(null, {}, null, IMG), null);
});

test("rejillaConMemoria: una rejilla anclada por color con otras columnas cede a la memoria; con la misma geometría se queda", () => {
  const trace = { bands: [77, 299, 521].flatMap(filaDeBandas) };
  const color3 = { colorAnchored: true, cellW: 207, cellH: 222, cols: 3, gridX: 600 };
  const r = rejillaConMemoria(color3, trace, MEMORIA, IMG);
  assert.equal(r.cols, 6);
  assert.equal(r.gridX, 70);
  assert.equal(r.deMemoria, true);
  const color6 = { ...color3, cols: 6, gridX: 70 };
  assert.equal(rejillaConMemoria(color6, trace, MEMORIA, IMG), color6);
  const dos = { dosFilas: true, cellW: 210, cellH: 225, cols: 2, gridX: 70 };
  assert.equal(rejillaConMemoria(dos, trace, MEMORIA, IMG), dos);
});

test("memoriaDeRejilla: solo recuerda detecciones por bordes", () => {
  const x = { cellW: 207, cellH: 222, cols: 6, gridX: 70, gridY: 5, rows: 4 };
  assert.deepEqual(memoriaDeRejilla(x), MEMORIA);
  assert.equal(memoriaDeRejilla({ ...x, colorAnchored: true }), null);
  assert.equal(memoriaDeRejilla({ ...x, dosFilas: true }), null);
  assert.equal(memoriaDeRejilla({ ...x, deMemoria: true }), null);
  assert.equal(memoriaDeRejilla(null), null);
});

test("VisionService: tras una página buena, bajar una fila en arcanos no deja sin rejilla, y la memoria va por contexto", () => {
  const img = fixture();
  const W = img.width, H = img.height;
  VisionService._memoriasRejilla.clear();
  try {
    const limpia = VisionService.detectGridAutoCalib(img, W, H, W, "INVENTORY_ARCANES");
    assert.ok(limpia && !limpia.deMemoria);
    const data = new Uint8ClampedArray(img.data);
    data.copyWithin(0, CELDA * W * 4);
    for (let i = (H - CELDA) * W * 4; i < data.length; i += 4) { data[i] = 8; data[i + 1] = 8; data[i + 2] = 16; data[i + 3] = 255; }
    const bajada = { width: W, height: H, data };
    assert.equal(detectInventoryGrid(bajada), null, "control: sin memoria el detector no saca rejilla");
    const r = VisionService.detectGridAutoCalib(bajada, W, H, W, "INVENTORY_ARCANES");
    assert.ok(r?.deMemoria);
    assert.equal(r.cols, limpia.cols);
    assert.equal(r.gridX, limpia.gridX);
    assert.ok(Math.abs(r.gridY - limpia.gridY) <= 4, `gridY ${r.gridY} frente a ${limpia.gridY}`);
    assert.equal(VisionService.detectGridAutoCalib(bajada, W, H, W, "INVENTORY"), null, "otra pestaña no hereda la memoria de arcanos");
    VisionService._memoriasRejilla.clear();
    assert.equal(VisionService.detectGridAutoCalib(bajada, W, H, W, "INVENTORY_ARCANES"), null);
  } finally {
    VisionService._memoriasRejilla.clear();
  }
});

test("VisionService: la memoria de rejillas no pasa de 8 entradas", () => {
  VisionService._memoriasRejilla.clear();
  try {
    const img = fixture();
    for (let k = 0; k < 10; k++) {
      VisionService.detectGridAutoCalib(img, img.width, img.height, img.width, `ambito${k}`);
    }
    assert.equal(VisionService._memoriasRejilla.size, 8);
    assert.ok(!VisionService._memoriasRejilla.has(`ambito0|${img.width}x${img.height}`));
    assert.ok(VisionService._memoriasRejilla.has(`ambito9|${img.width}x${img.height}`));
  } finally {
    VisionService._memoriasRejilla.clear();
  }
});
