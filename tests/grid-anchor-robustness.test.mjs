import { test } from "node:test";
import assert from "node:assert/strict";
import { detectInventoryGrid } from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame } from "./_helpers/inventory-frame.mjs";

const TRUTH = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
const NAME_BAND_TOP = 0.80;

function assertAnchorsOnName(res, truth, tag) {
  assert.ok(res, `${tag}: detectInventoryGrid no debería devolver null`);
  assert.equal(res.cols, truth.cols, `${tag}: cols ${res.cols} != ${truth.cols}`);
  assert.ok(Math.abs(res.cellH - truth.cellH) <= truth.cellH * 0.12,
    `${tag}: cellH ${res.cellH} fuera de tolerancia (~${truth.cellH})`);
  assert.ok(Math.abs(res.gridZone.y - truth.gridY) <= truth.cellH * 0.15,
    `${tag}: gridZone.y ${res.gridZone.y} lejos del top real ${truth.gridY} — ¿anclado al ARTE?`);
  const cropTop = res.gridZone.y + res.cellH * 0.58;
  const cropBot = res.gridZone.y + res.cellH;
  const nameTop = truth.gridY + res.cellH * NAME_BAND_TOP;
  const nameBase = truth.gridY + res.cellH * 0.92;
  assert.ok(cropTop <= nameTop + 6 && cropBot >= nameBase - 6,
    `${tag}: el recorte de nombre [${Math.round(cropTop)},${Math.round(cropBot)}] no cubre el nombre [${Math.round(nameTop)},${Math.round(nameBase)}]`);
}

test("anclaje robusto: ARTE metálico dominante (más bordes que el texto)", () => {
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...TRUTH,
    twoLineNames: [0, 3, 7, 10],
    art: [235, 225, 200],
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "arte-dominante");
});

test("anclaje robusto: texto de BAJO contraste (rojo apagado sobre fondo oscuro) + arte", () => {
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...TRUTH,
    bgColor: [20, 6, 8],
    textColor: [90, 26, 30],
    art: [150, 140, 120],
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "bajo-contraste");
});

test("anclaje robusto: fondo CLARO texturizado + texto blanco + arte", () => {
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...TRUTH,
    bgColor: [150, 20, 25], clampBgDark: false,
    textColor: [255, 255, 255],
    noise: 0.35,
    art: [210, 200, 170],
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "fondo-texturizado");
});
