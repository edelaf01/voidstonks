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

const { mergeRelicCounts, relicKey } = await import("../deploy/js/utils/inventory/relic_counts.js");

test("la cantidad escaneada REEMPLAZA la guardada, no se suma", () => {
  const out = mergeRelicCounts([{ name: "Lith K5", count: 3 }], new Map([["Lith K5", 5]]));
  assert.deepEqual(out, [{ name: "Lith K5", count: 5 }]);
});

test("' Relic' no crea una entrada nueva: es la misma reliquia", () => {
  const out = mergeRelicCounts([{ name: "Lith K5", count: 3 }], new Map([["Lith K5 Relic", 5]]));
  assert.deepEqual(out, [{ name: "Lith K5", count: 5 }], "y se respeta el nombre ya guardado");

  const alReves = mergeRelicCounts([{ name: "Lith K5 Relic", count: 3 }], new Map([["Lith K5", 5]]));
  assert.deepEqual(alReves, [{ name: "Lith K5 Relic", count: 5 }]);
});

test("el formato viejo se convierte contando las copias", () => {
  const out = mergeRelicCounts(["Meso N6", "Meso N6", "Neo V9"], new Map([["Neo V9", 4]]));
  assert.deepEqual(out, [{ name: "Meso N6", count: 2 }, { name: "Neo V9", count: 4 }]);
});

test("una reliquia que no estaba entra nueva con el nombre que leyó el escáner", () => {
  const out = mergeRelicCounts([{ name: "Lith K5", count: 1 }], new Map([["Axi A1", 2]]));
  assert.deepEqual(out, [{ name: "Lith K5", count: 1 }, { name: "Axi A1", count: 2 }]);
});

test("lo que NO se escaneó se queda como estaba", () => {
  const out = mergeRelicCounts(
    [{ name: "Lith K5", count: 3 }, { name: "Axi A1", count: 7 }], new Map([["Lith K5", 1]]));
  assert.deepEqual(out, [{ name: "Lith K5", count: 1 }, { name: "Axi A1", count: 7 }]);
});

test("una cantidad de 0 borra la entrada, y no crea las que no existían", () => {
  assert.deepEqual(mergeRelicCounts([{ name: "Lith K5", count: 3 }], { "Lith K5": 0 }), []);
  assert.deepEqual(mergeRelicCounts([], { "Axi A1": 0 }), []);
});

test("acepta Map u objeto, y aguanta entradas rotas", () => {
  assert.deepEqual(mergeRelicCounts([], { "Axi A1": 2 }), [{ name: "Axi A1", count: 2 }]);
  assert.deepEqual(mergeRelicCounts(null, null), []);
  assert.deepEqual(
    mergeRelicCounts([null, { count: 2 }, { name: "  " }], new Map([["", 5], ["Neo V9", "3"]])),
    [{ name: "Neo V9", count: 3 }]);
});

test("relicKey iguala las dos formas y nada más", () => {
  assert.equal(relicKey("Lith K5 Relic"), relicKey("lith k5"));
  assert.notEqual(relicKey("Lith K5"), relicKey("Lith K6"));
  assert.equal(relicKey(null), "");
});
