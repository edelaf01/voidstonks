// Cuántas reliquias tienes de cada una. Lo usan la pestaña Set (el "×3" de cada chip) y el
// panel de rutas para decidir qué puedes abrir ya.
//
// Todo lo que hay aquí son formas en las que el inventario llega mezclado y que fallan en
// silencio: un nombre con " Relic" y otro sin él son la MISMA reliquia, y contarlos aparte deja
// el chip a 0 con reliquias en la mochila.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };

const { state } = await import("../deploy/js/state.js");
const { getRelicCounts } = await import("../deploy/js/utils/inventory/relic_counts.js");

test("suma las copias del formato {name, count}", () => {
  state.inventory = [{ name: "Lith K5", count: 3 }, { name: "Axi A1", count: 1 }];
  assert.deepEqual(getRelicCounts(), { "Lith K5": 3, "Axi A1": 1 });
});

// El formato viejo del inventario era un array de strings repetidos, y state.js no lo migra
// hasta que se pulsa un +/-: hasta entonces hay que saber contarlo.
test("cuenta el formato viejo (strings repetidos) sin esperar a la migración", () => {
  state.inventory = ["Meso N6", "Meso N6", "Neo V9"];
  assert.deepEqual(getRelicCounts(), { "Meso N6": 2, "Neo V9": 1 });
});

// El sufijo depende de por dónde entrara la reliquia: el escáner, el import de JSON y el botón
// de la ficha no lo escriben igual.
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
