import { test } from "node:test";
import assert from "node:assert/strict";
import { offBandComponentIndices } from "../deploy/js/utils/vision/badge_filters.js";

// ===========================================================================
// Regresión del filtro de BANDA del badge de cantidad.
//
// Datos de componentes REALES extraídos con un harness offline que replica
// extractBadgeByColor sobre la captura de inventario 2531x1412
// (tests/_fixtures/inventory_ballistica_banshee_2531x1412.png), rejilla
// autodetectada: zona (87,281), celda 277x296, dy -44, 6 columnas.
//
// Cada entrada = los componentes que ENTRAN al filtro de banda (supervivientes
// de los filtros previos a-d), con su geometría y brillo medio sobre la imagen
// original. `role` documenta qué es cada uno: "check" (checkmark), "digit" (el
// número real) o "art" (arte del ítem colado por la derecha del crop).
// ===========================================================================

const CELLS = {
  // Banshee Prime Blueprint: real=9. El arte (ala dorada) sobrevivía los filtros
  // de forma/posición (h=59 < 0.80*safeH) y contaminaba el crop -> "Ø"/"99".
  banshee_bp: {
    expected: 9,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 140.9, erased: false },
      { role: "digit", minY: 25, maxY: 46, height: 22, avgLuma: 137.3, erased: false },
      { role: "art",   minY: 27, maxY: 85, height: 59, avgLuma: 127.0, erased: false },
    ],
  },
  // Ballistica Prime Blueprint: real=3. En este frame el arte ya se fragmentó y
  // solo quedan checkmark + "3" (ambos en banda): el filtro no debe tocar nada.
  ballistica_bp: {
    expected: 3,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 140.7, erased: false },
      { role: "digit", minY: 25, maxY: 46, height: 22, avgLuma: 135.2, erased: false },
    ],
  },
  // Controles que en vivo leen bien: no debe borrarse ningún componente.
  astilla_bp: {
    expected: 3,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 139.6, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 138.0, erased: false },
    ],
  },
  atlas_bp: {
    // dos dígitos "11": ambos deben conservarse (misma banda que el checkmark).
    expected: 11,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 138.5, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 138.9, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 139.3, erased: false },
    ],
  },
  banshee_chassis: {
    expected: 3,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 142.4, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 145.4, erased: false },
    ],
  },
  banshee_systems: {
    expected: 2,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 141.4, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 138.6, erased: false },
    ],
  },
};

test("banshee_bp: el arte fuera de banda se elimina y el dígito se conserva", () => {
  const { comps } = CELLS.banshee_bp;
  const erased = offBandComponentIndices(comps);
  const artIdx = comps.findIndex((c) => c.role === "art");
  assert.deepEqual(erased, [artIdx], "solo el componente de arte debe borrarse");
  // ningún checkmark/dígito debe caer.
  for (const i of erased) {
    assert.notEqual(comps[i].role, "digit", "no debe borrar el dígito real");
    assert.notEqual(comps[i].role, "check", "no debe borrar el checkmark");
  }
});

for (const [name, { comps }] of Object.entries(CELLS)) {
  if (name === "banshee_bp") continue;
  test(`${name}: el filtro de banda no borra ningún componente legítimo`, () => {
    const erased = offBandComponentIndices(comps);
    assert.deepEqual(erased, [], `no debía borrar nada, borró índices ${erased}`);
  });
}

test("offBandComponentIndices: sin supervivientes -> no borra nada", () => {
  assert.deepEqual(
    offBandComponentIndices([{ minY: 0, maxY: 10, height: 11, avgLuma: 100, erased: true }]),
    [],
  );
});

test("offBandComponentIndices: componente ya borrado no se selecciona de nuevo", () => {
  const comps = [
    { role: "digit", minY: 25, maxY: 46, height: 22, avgLuma: 140, erased: false },
    { role: "art", minY: 27, maxY: 85, height: 59, avgLuma: 120, erased: true },
  ];
  assert.deepEqual(offBandComponentIndices(comps), []);
});
