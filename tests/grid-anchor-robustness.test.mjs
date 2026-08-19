import { test } from "node:test";
import assert from "node:assert/strict";
import { detectInventoryGrid } from "../deploy/js/utils/vision/grid_detect.js";
import { makeInventoryFrame } from "./_helpers/inventory-frame.mjs";

// ===========================================================================
// ANCLAJE DE FILA ROBUSTO frente a ARTE dominante y BAJO CONTRASTE.
//
// El anclaje por densidad de bordes falla cuando el ARTE metálico del ítem tiene
// más bordes que el texto (temas vistosos) o cuando el texto tiene poco contraste
// con el fondo (temas rojo-oscuro, o fondo brillante texturizado). En esos casos
// la fila se ancla al ARTE y el recorte de nombre cae fuera → se pierden celdas /
// se lee basura.
//
// Requisito (independiente del método interno — bordes, color de nombre, o
// anclaje por la palabra "PRIME"): el top de celda detectado (gridZone.y) debe
// quedar cerca del top REAL de la celda, de modo que el recorte de nombre
// [0.58–1.0]·cellH contenga la banda de nombre (que el fixture pinta en
// 0.80–0.92·cellH). Si se ancla al arte (0.10–0.55) el gridY se va ~0.23·cellH
// arriba y el recorte pierde el nombre.
//
// NOTA: son las condiciones que hoy hacen sufrir al detector. Pueden fallar con la
// implementación actual (edge-based) — son el listón para el método general nuevo.
// ===========================================================================

const TRUTH = { gridX: 400, gridY: 140, cellW: 250, cellH: 290, cols: 6 };
const NAME_BAND_TOP = 0.80;  // el fixture pinta el nombre desde 0.80·cellH

function assertAnchorsOnName(res, truth, tag) {
  assert.ok(res, `${tag}: detectInventoryGrid no debería devolver null`);
  assert.equal(res.cols, truth.cols, `${tag}: cols ${res.cols} != ${truth.cols}`);
  assert.ok(Math.abs(res.cellH - truth.cellH) <= truth.cellH * 0.12,
    `${tag}: cellH ${res.cellH} fuera de tolerancia (~${truth.cellH})`);
  // El anclaje vertical debe caer cerca del top REAL, no en el arte (~0.23·cellH arriba).
  assert.ok(Math.abs(res.gridZone.y - truth.gridY) <= truth.cellH * 0.15,
    `${tag}: gridZone.y ${res.gridZone.y} lejos del top real ${truth.gridY} — ¿anclado al ARTE?`);
  // Comprobación directa: el recorte de nombre [0.58–1.0]·cellH debe contener la banda de nombre real.
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
    art: [235, 225, 200],            // arte metálico brillante, alto contraste
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "arte-dominante");
});

test("anclaje robusto: texto de BAJO contraste (rojo apagado sobre fondo oscuro) + arte", () => {
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...TRUTH,
    bgColor: [20, 6, 8],             // fondo rojo muy oscuro
    textColor: [90, 26, 30],         // nombre rojo apagado: poco contraste con el fondo
    art: [150, 140, 120],            // arte metálico: mucho más contraste que el texto
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "bajo-contraste");
});

test("anclaje robusto: fondo CLARO texturizado + texto blanco + arte", () => {
  const img = makeInventoryFrame({
    width: 1920, height: 1080, ...TRUTH,
    bgColor: [150, 20, 25], clampBgDark: false,
    textColor: [255, 255, 255],
    noise: 0.35,                     // textura de fondo (estrellas/nebulosa) que mete bordes
    art: [210, 200, 170],
  });
  const res = detectInventoryGrid(img);
  assertAnchorsOnName(res, TRUTH, "fondo-texturizado");
});
