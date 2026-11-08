import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./_helpers/png.mjs";
import { installFakeDocument } from "./_helpers/fake-canvas.mjs";

installFakeDocument();

const { faseDesdeBandas, rejillaDesdeMemoria, rejillaConMemoria, memoriaDeRejilla, rejillaDeBusqueda } = await import("../deploy/js/utils/vision/grid_memoria.js");
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

test("rejillaDeBusqueda con bandas devuelve geometria esperada", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const r = rejillaDeBusqueda([{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }], M, img);
  assert.equal(r.gridY, -6);
  assert.equal(r.cellH, 222);
  assert.equal(r.cellW, 208);
  assert.equal(r.cols, 6);
  assert.equal(r.rows, 3);
  assert.equal(r.deBusqueda, true);
  assert.equal(r.deMemoria, true);
  assert.deepEqual(r.gridZone, { x: 0, y: -6, w: 1248, h: 666 });
});

test("rejillaDeBusqueda con icono fuera de ventana devuelve null", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const r = rejillaDeBusqueda([{ y0: 30, y1: 143 }], M, img);
  assert.equal(r, null);
});

test("rejillaDeBusqueda con banda en tercera fila devuelve null", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const r = rejillaDeBusqueda([{ y0: 58, y1: 198 }, { y0: 500, y1: 627 }], M, img);
  assert.equal(r, null);
});

test("rejillaDeBusqueda con bandas vacias o null devuelve null", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  assert.equal(rejillaDeBusqueda([], M, img), null);
  assert.equal(rejillaDeBusqueda(null, M, img), null);
});

test("rejillaDeBusqueda con alto insuficiente devuelve null", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 300 };
  const r = rejillaDeBusqueda([{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }], M, img);
  assert.equal(r, null);
});

test("rejillaDeBusqueda calcula cellH a partir de cellW y no de la memoria", () => {
  const M = { cellW: 208, cellH: 231, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const r = rejillaDeBusqueda([{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }], M, img);
  assert.equal(r.cellH, 222);
  assert.equal(r.gridY, -6);
});

test("rejillaDeBusqueda rellena trace.memoria solo cuando la rejilla es valida", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const traceValido = {};
  rejillaDeBusqueda([{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }], M, img, traceValido);
  assert.deepEqual(traceValido.memoria, { busqueda: true, gridY: -6, cellH: 222 });
  const traceInvalido = {};
  rejillaDeBusqueda([{ y0: 30, y1: 143 }], M, img, traceInvalido);
  assert.equal(traceInvalido.memoria, undefined);
});

test("rejillaDeBusqueda respeta exactamente las fronteras de la ventana de gridY", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const entraMenos33 = rejillaDeBusqueda([{ y0: 100, y1: 171 }], M, img);
  assert.equal(entraMenos33?.gridY, -33);
  const fueraMenos34 = rejillaDeBusqueda([{ y0: 100, y1: 170 }], M, img);
  assert.equal(fueraMenos34, null);
  const entra55 = rejillaDeBusqueda([{ y0: 100, y1: 259 }], M, img);
  assert.equal(entra55?.gridY, 55);
  const fuera56 = rejillaDeBusqueda([{ y0: 100, y1: 260 }], M, img);
  assert.equal(fuera56, null);
});

test("rejillaConMemoria sin memoria devuelve calib con conBusqueda true", () => {
  const calib = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const res = rejillaConMemoria(calib, { bands: [{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }] }, null, img, true);
  assert.equal(res, calib);
});

test("rejillaConMemoria devuelve deBusqueda solo cuando conBusqueda es true", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const bands = [{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }];
  const rTrue = rejillaConMemoria(null, { bands }, M, img, true);
  assert.equal(rTrue?.deBusqueda, true);
  const rFalse = rejillaConMemoria(null, { bands }, M, img, false);
  assert.equal(rFalse?.deBusqueda, undefined);
});

test("rejillaConMemoria con calib incompatible sustituye por deBusqueda o mantiene calib", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const calib = { cellW: 174, cellH: 254, cols: 3, rows: 3, gridX: 0, gridY: 0 };
  const bands = [{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }];
  const rTrue = rejillaConMemoria(calib, { bands }, M, img, true);
  assert.equal(rTrue?.deBusqueda, true);
  const rFalse = rejillaConMemoria(calib, { bands }, M, img, false);
  assert.equal(rFalse, calib);
});

test("rejillaConMemoria con calib coincidente devuelve la misma referencia", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const calib = { cellW: 208, cellH: 222, cols: 6, rows: 3, gridX: 0, gridY: 0 };
  const bands = [{ y0: 58, y1: 198 }, { y0: 883, y1: 892 }];
  const res = rejillaConMemoria(calib, { bands }, M, img, true);
  assert.equal(res, calib);
});

test("rejillaConMemoria sin banda valida devuelve null con y sin busqueda", () => {
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  const img = { width: 1248, height: 897 };
  const bands = [{ y0: 30, y1: 143 }];
  const rTrue = rejillaConMemoria(null, { bands }, M, img, true);
  const rFalse = rejillaConMemoria(null, { bands }, M, img, false);
  assert.equal(rTrue, null);
  assert.equal(rFalse, null);
});

test("con tres filas de nombres la rejilla de busqueda no se usa y coincide con la deteccion sin busqueda", () => {
  const bands = [77, 299, 521].flatMap(filaDeBandas);
  const rTrue = rejillaConMemoria(null, { bands }, MEMORIA, IMG, true);
  const rFalse = rejillaConMemoria(null, { bands }, MEMORIA, IMG, false);
  assert.equal(rTrue.deMemoria, true);
  assert.equal(rTrue.deBusqueda, undefined);
  assert.equal(rTrue.gridY, rFalse.gridY);
  assert.equal(rTrue.rows, rFalse.rows);
});

test("memoriaDeRejilla valida dimensiones y banderas antes de guardar memoria", () => {
  assert.equal(memoriaDeRejilla({ cellW: 174, cellH: 254, cols: 3, gridX: 0 }), null);
  const m1 = memoriaDeRejilla({ cellW: 207, cellH: 222, cols: 6, gridX: 1 });
  assert.deepEqual(m1, { cellW: 207, cellH: 222, cols: 6, gridX: 1 });
  assert.deepEqual(Object.keys(m1).sort(), ["cellH", "cellW", "cols", "gridX"]);
  const m2 = memoriaDeRejilla({ cellW: 208, cellH: 231, cols: 6, gridX: 0 });
  assert.deepEqual(m2, { cellW: 208, cellH: 231, cols: 6, gridX: 0 });
  assert.deepEqual(Object.keys(m2).sort(), ["cellH", "cellW", "cols", "gridX"]);
  const base = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  assert.equal(memoriaDeRejilla({ ...base, deMemoria: true }), null);
  assert.equal(memoriaDeRejilla({ ...base, colorAnchored: true }), null);
  assert.equal(memoriaDeRejilla({ ...base, dosFilas: true }), null);
  assert.equal(memoriaDeRejilla(null), null);
});

test("rejillaDesdeMemoria devuelve deMemoria, gaps a cero y gridZone recortada", () => {
  const bandas = [77, 299, 521].flatMap(filaDeBandas);
  const r = rejillaDesdeMemoria(bandas, MEMORIA, IMG);
  assert.equal(r.deMemoria, true);
  assert.equal(r.gapX, 0);
  assert.equal(r.gapY, 0);
  assert.equal(r.gridZone.x, MEMORIA.gridX);
  assert.equal(r.gridZone.w, Math.min(MEMORIA.cols * MEMORIA.cellW, IMG.width - MEMORIA.gridX));
  assert.equal(r.gridZone.h, Math.min(r.rows * MEMORIA.cellH, IMG.height - r.gridY));
});

test("VisionService detectGridAutoCalib no contamina la memoria con rejilla de busqueda", async () => {
  const { makeInventoryFrame } = await import("./_helpers/inventory-frame.mjs");
  const M = { cellW: 208, cellH: 222, cols: 6, gridX: 0 };
  VisionService._memoriasRejilla.clear();
  try {
    VisionService._memoriasRejilla.set("INVENTORY|1248x897", { ...M });
    const frame = makeInventoryFrame({ width: 1248, height: 897, gridX: 0, gridY: -6, cellW: 208, cellH: 222, cols: 6, rows: 3, filled: [0], noise: 0 });
    const r = VisionService.detectGridAutoCalib(frame, 1248, 897, 1248, "INVENTORY", true);
    assert.equal(r?.deBusqueda, true);
    const memoria = VisionService._memoriasRejilla.get("INVENTORY|1248x897");
    assert.equal(memoria.cellW, M.cellW);
    assert.equal(memoria.cellH, M.cellH);
    assert.equal(memoria.cols, M.cols);
    assert.equal(memoria.gridX, M.gridX);
  } finally {
    VisionService._memoriasRejilla.clear();
  }
});
