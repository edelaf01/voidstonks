import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };

const { state } = await import("../deploy/js/state.js");
const { getRelicCounts } = await import("../deploy/js/utils/inventory/relic_counts.js");

test("suma las copias del formato {name, count}", () => {
  state.inventory = [{ name: "Lith K5", count: 3 }, { name: "Axi A1", count: 1 }];
  assert.deepEqual(getRelicCounts(), { "Lith K5": 3, "Axi A1": 1 });
});

test("cuenta el formato viejo (strings repetidos) sin esperar a la migración", () => {
  state.inventory = ["Meso N6", "Meso N6", "Neo V9"];
  assert.deepEqual(getRelicCounts(), { "Meso N6": 2, "Neo V9": 1 });
});

test("' Relic' al final es la misma reliquia y se suma junto", () => {
  state.inventory = [{ name: "Lith K5 Relic", count: 2 }, { name: "Lith K5", count: 1 }];
  assert.deepEqual(getRelicCounts(), { "Lith K5": 3 });
});

test("un inventario vacío o sin nombres no inventa entradas", () => {
  state.inventory = [];
  assert.deepEqual(getRelicCounts(), {});

  state.inventory = [{ count: 4 }, { name: "  ", count: 2 }, null];
  assert.deepEqual(getRelicCounts(), {});
});

test("sin count se cuenta como una copia, no como cero", () => {
  state.inventory = [{ name: "Axi G1" }];
  assert.deepEqual(getRelicCounts(), { "Axi G1": 1 });
});
