import { test } from "node:test";
import assert from "node:assert/strict";
import { detectInventoryGrid } from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame } from "./_helpers/inventory-frame.mjs";

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

test("detectInventoryGrid: 1280x720 (factor 0.667) - HD ready", () => {
  const truth = {
    width: 1280, height: 720,
    gridX: 267, gridY: 93, cellW: 167, cellH: 193, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1600x900 (factor 0.833) - WXGA", () => {
  const truth = {
    width: 1600, height: 900,
    gridX: 333, gridY: 117, cellW: 208, cellH: 242, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1920x1080 (factor 1.0 referencia) - FHD", () => {
  const truth = {
    width: 1920, height: 1080,
    gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 2560x1440 (factor 1.333) - QHD", () => {
  const truth = {
    width: 2560, height: 1440,
    gridX: 281, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 3840x2160 (factor 2.0) - 4K UHD", () => {
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 });
});

test("detectInventoryGrid: 3440x1440 (factor 1.333 ultrawide) - no centrada", () => {
  const truth = {
    width: 3440, height: 1440,
    gridX: 840, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});

test("detectInventoryGrid: 1602x837 (factores no enteros) - redondeo geométrico", () => {
  const truth = {
    width: 1602, height: 837,
    gridX: 310, gridY: 108, cellW: 194, cellH: 225, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame(truth);
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pxTol: 8 });
});

test("detectInventoryGrid: 1280x720 con ruido y gradiente de fondo", () => {
  const truth = {
    width: 1280, height: 720,
    gridX: 267, gridY: 93, cellW: 167, cellH: 193, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame({ ...truth, noise: 0.3, bgGradient: true });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 });
});

test("detectInventoryGrid: 3840x2160 con ruido y gradiente de fondo", () => {
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const img = makeInventoryFrame({ ...truth, noise: 0.3, bgGradient: true });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.05 });
});

test("detectInventoryGrid: 2560x1440 con última fila parcialmente cortada por scroll", () => {
  const cellH = 387;
  const gridY = 187;
  const height = 187 + 2 * cellH + Math.round(cellH * 0.5);
  const truth = {
    width: 2560, height: 1440,
    gridX: 281, gridY: 187, cellW: 333, cellH: 387, cols: 6, rows: 2,
  };
  const img = makeInventoryFrame({
    ...truth,
    height,
    rows: 3,
  });
  const res = detectInventoryGrid(img);
  if (res === null) {
    console.log("  -> Nota: última fila cortada causó null (comportamiento esperado)");
  } else {
    assert.ok(res.rows <= 3, `rows no debería exceder 3 con scroll activo`);
    assert.ok(
      Math.abs(res.cellH - truth.cellH) <= Math.max(6, Math.round(truth.cellH * 0.08)),
      `cellH ${res.cellH} fuera de tolerancia con scroll`,
    );
  }
});

test("detectInventoryGrid: 720p con badges de cantidad (no colapsa cellH)", () => {
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
  const truth = {
    width: 3840, height: 2160,
    gridX: 800, gridY: 280, cellW: 500, cellH: 580, cols: 6, rows: 3,
  };
  const twoLineNames = Array.from({ length: 18 }, (_, i) => i);
  const img = makeInventoryFrame({ ...truth, twoLineNames });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth, { pctTol: 0.15, gridYPct: 0.15 });
});

test("detectInventoryGrid: 1600x900 con huecos en la rejilla (61% llena)", () => {
  const truth = {
    width: 1600, height: 900,
    gridX: 333, gridY: 117, cellW: 208, cellH: 242, cols: 6, rows: 3,
  };
  const filled = [0, 1, 3, 4, 7, 8, 10, 11, 14, 15, 16];
  const img = makeInventoryFrame({ ...truth, filled });
  const res = detectInventoryGrid(img);
  assertDetectedWithTolerance(res, truth);
});
