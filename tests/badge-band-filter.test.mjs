import { test } from "node:test";
import assert from "node:assert/strict";
import { offBandComponentIndices } from "../deploy/js/utils/vision/badge_filters.js";

const CELLS = {
  banshee_bp: {
    expected: 9,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 140.9, erased: false },
      { role: "digit", minY: 25, maxY: 46, height: 22, avgLuma: 137.3, erased: false },
      { role: "art",   minY: 27, maxY: 85, height: 59, avgLuma: 127.0, erased: false },
    ],
  },
  ballistica_bp: {
    expected: 3,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 140.7, erased: false },
      { role: "digit", minY: 25, maxY: 46, height: 22, avgLuma: 135.2, erased: false },
    ],
  },
  astilla_bp: {
    expected: 3,
    comps: [
      { role: "check", minY: 21, maxY: 50, height: 30, avgLuma: 139.6, erased: false },
      { role: "digit", minY: 26, maxY: 46, height: 21, avgLuma: 138.0, erased: false },
    ],
  },
  atlas_bp: {
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
