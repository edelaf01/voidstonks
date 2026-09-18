// Filtro de lectura ilegible de una celda del inventario.
//
// Caso real: "LITH K 2 RELIC EXCEPTIONAL", leído perfectamente y resuelto por el matcher, salía
// como GARBLED porque "K" y "2" contaban como dos fragmentos sueltos. Un código de reliquia de
// letra y dígito partido por el OCR es un solo fragmento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isGarbledCellText } from "../deploy/js/utils/vision/cell_text_guard.js";

test("un código de reliquia partido (K + 2) no es ilegible", () => {
  assert.equal(isGarbledCellText(["LITH", "K", "2", "RELIC", "EXCEPTIONAL"]), false);
  assert.equal(isGarbledCellText(["AXI", "A", "10", "RELIC", "RADIANT"]), false);
  assert.equal(isGarbledCellText(["LITH", "K2", "RELIC"]), false);
});

test("un fragmento suelto de un glifo se tolera; dos o más es ruido", () => {
  assert.equal(isGarbledCellText(["AXI", "AL", "4", "RELIC"]), false);
  assert.equal(isGarbledCellText(["V", "LV", "WER", "ARIN", "NEUROPTICS"]), false);
  assert.equal(isGarbledCellText(["I", "AJ", "WOE", "RIM", "NEUROPTICS", "BLUEPRINT"]), false);
  assert.equal(isGarbledCellText(["N", "I", "F", "NAUTILUS", "PRIME", "CEREBRUM"]), true);
  // Dos letras sueltas seguidas de un número solo agrupan la que va justo antes del número.
  assert.equal(isGarbledCellText(["X", "K", "2", "RELIC"]), true);
});

test("demasiados tokens o nada leído", () => {
  assert.equal(isGarbledCellText(["A", "B", "C", "D", "E", "F", "G", "H", "I"]), true);
  assert.equal(isGarbledCellText([]), false);
  assert.equal(isGarbledCellText(null), false);
});
