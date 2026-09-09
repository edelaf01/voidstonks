// qtyToast: mensaje único de "{nombre} +N" / "{nombre} -N" para todo botón de +/- de cantidad
// (panel de reliquias, piezas Prime, seguidor de sets), en vez de un string distinto por sitio.
import { test } from "node:test";
import assert from "node:assert/strict";

// --- DOM mínimo: solo lo que toca el import de ui_components.js ---
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, addEventListener() {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: { addEventListener() {} },
};
globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { qtyToast } = await import("../deploy/js/ui.components/ui_components.js");

test("suma: signo + explícito", () => {
  assert.equal(qtyToast("Ash Prime Chassis Blueprint", 1), "Ash Prime Chassis Blueprint +1");
});

test("resta: el signo - ya lo trae el número, no se duplica", () => {
  assert.equal(qtyToast("Ash Prime Chassis Blueprint", -1), "Ash Prime Chassis Blueprint -1");
});

test("cantidades mayores que 1", () => {
  assert.equal(qtyToast("Meso O2", 3), "Meso O2 +3");
  assert.equal(qtyToast("Meso O2", -4), "Meso O2 -4");
});
