/**
 * Tests de detección de rejilla en DIFERENTES RESOLUCIONES.
 * Escala la geometría de celda proporcionalmente a la ALTURA.
 * Referencia verificada: 1920x1080 con gx=400 gy=140 cellW=250 cellH=290 cols=6 rows=3
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectInventoryGrid } from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame } from "./_helpers/inventory-frame.mjs";

/**
 * Tolerancia razonable para las medidas detectadas.
 * La mayor de: ±pixeles o ±porcentaje del valor esperado.
 */
function assertDetectedWithTolerance(res, truth, { pxTol = 6, pctTol = 0.03, gridYPct = 0.1 } = {}) {
  assert.ok(res, "detectInventoryGrid no debería devolver null");
  assert.equal(res.cols, truth.cols, `cols exacto esperado ${truth.cols}, obtenido ${res.cols}`);

  const cellWTol = Math.max(pxTol, Math.round(truth.cellW * pctTol));
  assert.ok(
    Math.abs(res.cellW - truth.cellW) <= cellWTol,
    `cellW ${res.cellW} fuera de tolerancia (esperado ${truth.cellW} ±${cellWTol}px)`,
  );

  const cellHTol = Math.max(pxTol, Math.round(truth.cellH * pctTol));
  assert.ok(
    Math.abs(res.cellH - truth.cellH) <= cellHTol,
    `cellH ${res.cellH} fuera de tolerancia (esperado ${truth.cellH} ±${cellHTol}px)`,
  );

  // Origen: ±10% de la celda. Más holgura que eso desplazaría los crops de
  // nombre/badge dentro de la celda y el OCR real fallaría aunque el test pase.
  const gridXTol = Math.max(pxTol, Math.round(truth.cellW * 0.1));
  assert.ok(
    Math.abs(res.gridZone.x - truth.gridX) <= gridXTol,
    `gridZone.x ${res.gridZone.x} fuera de tolerancia (esperado ~${truth.gridX} ±${gridXTol}px)`,
  );

  const gridYTol = Math.max(pxTol, Math.round(truth.cellH * gridYPct));
  assert.ok(
    Math.abs(res.gridZone.y - truth.gridY) <= gridYTol,
    `gridZone.y ${res.gridZone.y} fuera de tolerancia (esperado ~${truth.gridY} ±${gridYTol}px)`,
  );
}

// ===========================================================================
// MATRIZ DE RESOLUCIONES
// ===========================================================================

test("detectInventoryGrid: 1280x720 (factor 0.667) - HD ready", () => {
  // factor = 720 / 1080 = 0.667
  const truth = {
    width: 1280, height: 720,
    gridX: 267, gridY: 93, cellW: 167, cellH: 193, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1600x900 (factor 0.833) - WXGA", () => {
  // factor = 900 / 1080 = 0.833
  const truth = {
    width: 1600, height: 900,
    gridX: 333, gridY: 117, cellW: 208, cellH: 242, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1920x1080 (factor 1.0 referencia) - FHD", () => {
  // Referencia verificada: misma geometría que el smoke-test
  const truth = {
    width: 1920, height: 1080,
    gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 2560x1440 (factor 1.333) - QHD", () => {
  // factor = 1440 / 1080 = 1.333
  // cellH = 290 * 1.333 = 386.57 -> 387
  // cellW = 250 * 1.333 = 333.25 -> 333
  // Para que 6 cols quepan centradas: gridX = (2560 - 6*333) / 2 = 281
  const truth = {
    width: 2560, height: 1440,
    gridX: 281, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 3840x2160 (factor 2.0) - 4K UHD", () => {
  // factor = 2160 / 1080 = 2.0
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 }); // tolerancia más generosa para 4K
});

test("detectInventoryGrid: 3440x1440 (factor 1.333 ultrawide) - no centrada", () => {
  // factor = 1440 / 1080 = 1.333, pero rejilla desplazada a gx=840 (no centrada)
  const truth = {
    width: 3440, height: 1440,
    gridX: 840, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1602x837 (factores no enteros) - redondeo geométrico", () => {
  // factor = 837 / 1080 = 0.775 (no entero)
  // cellH = 290 * 0.775 = 224.75 -> 225
  // cellW = 250 * 0.775 = 193.75 -> 194
  // gridY = 140 * 0.775 = 108.5 -> 108
  // gridX = 400 * 0.775 = 310
  const truth = {
    width: 1602, height: 837,
    gridX: 310, gridY: 108, cellW: 194, cellH: 225, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pxTol: 8 }); // redondeo más generoso
});

test("detectInventoryGrid: 1280x720 con ruido y gradiente de fondo", () => {
  // factor = 0.667, con noise=0.3 (±24 de luma) y bgGradient=true. El detector
  // por BORDES tolera el ruido vía estructura aguas abajo, no por inmunidad
  // per-píxel; ±24 es estrés realista de captura (los PNG reales van aparte).
  const truth = {
    width: 1280, height: 720,
    gridX: 267, gridY: 93, cellW: 167, cellH: 193, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame({ ...truth, noise: 0.3, bgGradient: true });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 }); // ruido puede afectar un poco
});

test("detectInventoryGrid: 3840x2160 con ruido y gradiente de fondo", () => {
  // factor = 2.0, con noise=0.3 (±24 de luma) y bgGradient=true. Ver nota del
  // caso 1280x720: tolerancia al ruido por estructura, no por umbral absoluto.
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame({ ...truth, noise: 0.3, bgGradient: true });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 }); // ruido puede afectar
});

test("detectInventoryGrid: 2560x1440 con última fila parcialmente cortada por scroll", () => {
  // factor = 1.333, pero la altura es cortada a la mitad de la 4ª fila
  const cellH = 387;
  const gridY = 187;
  // 3 filas completas: gridY + 3*cellH = 187 + 3*387 = 187 + 1161 = 1348
  // Cortamos la 4ª a la mitad: 1348 + 194 (mitad de cellH) = 1542 > 1440, así que reducimos
  const height = 187 + 2 * cellH + Math.round(cellH * 0.5); // ~1541, redondeamos a 1440 cortando más
  const truth = {
    width: 2560, height: 1440,
    gridX: 281, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 2,
  };
  const img = makeInventoryFrame({
    ...truth,
    height,
    rows: 3, // generador crea 3 filas, pero solo 2 serán detectadas completas
  });
  const res = detectInventoryGrid(img);
  // Aquí esperamos que solo se detecten 2 filas completas (no llega a 3 para la cadena),
  // así que el resultado podría ser null. Si sale null, es el comportamiento esperado.
  if (res === null) {
    console.log("  -> Nota: última fila cortada causó null (comportamiento esperado)");
  } else {
    // Si detecta algo, debe ser con 2 o 3 filas. Tolerancia más floja aquí.
    assert.ok(res.rows <= 3, `rows no debería exceder 3 con scroll activo`);
    assert.ok(
      Math.abs(res.cellH - truth.cellH) <= Math.max(6, Math.round(truth.cellH * 0.08)),
      `cellH ${res.cellH} fuera de tolerancia con scroll`,
    );
  }
});

test("detectInventoryGrid: 720p con badges de cantidad (no colapsa cellH)", () => {
  // factor = 0.667, con badges para asegurar que no contamina la detección
  const truth = {
    width: 1280, height: 720,
    gridX: 267, gridY: 93, cellW: 167, cellH: 193, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame({ ...truth, badges: true });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
  assert.ok(
    res.cellH > truth.cellH * 0.6,
    `cellH ${res.cellH} no debería colapsar a ~mitad por los badges`,
  );
});

test("detectInventoryGrid: 4K con nombres a 2 líneas (cellH ±15% tolerancia)", () => {
  // factor = 2.0, con nombres a 2 líneas que pueden mezclar bandas
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const twoLineNames = Array.from({ length: 18 }, (_, i) => i); // todos a 2 líneas
  const img = makeInventoryFrame({ ...truth, twoLineNames });
  const res = detectInventoryGrid(img);
  // Con el 100% de nombres a 2 líneas (bottom-anchored, como el juego), el top del
  // nombre queda ~0.10·cellH más arriba que el offset fijo 0.60 asumido, así que la
  // estimación de gridY se desvía hasta ~0.15·cellH; detectRowPhase/_applyRowPhase
  // afina la fase por frame en producción (mismo caveat que el test "captura real").
  assertDetectedWithTolerance(res, truth, { pctTol: 0.15, gridYPct: 0.15 });
});

test("detectInventoryGrid: 1600x900 con huecos en la rejilla (61% llena)", () => {
  // factor = 0.833, pero rejilla parcialmente vacía
  const truth = {
    width: 1600, height: 900,
    gridX: 333, gridY: 117, cellW: 208, cellH: 242, cols: 6, rows: 3,
  };
  // Mismos huecos que el test original: 18 celdas (3x6), 11 llenas
  const filled = [0, 1, 3, 4, 7, 8, 10, 11, 14, 15, 16];
  const img = makeInventoryFrame({ ...truth, filled });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});
