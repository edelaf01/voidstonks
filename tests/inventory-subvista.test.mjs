// opening the app with the "prime parts" subview saved must open on prime parts
// regression: switchInvView checked the relic list, which updateUILabels() fills with the empty message at
// module load, so the switch to parts was dropped
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** minimal element: just what switchInvView touches */
const elemento = (id) => ({
  id,
  innerHTML: "",
  children: [],
  style: { display: "" },
  _clases: new Set(),
  classList: { add(c) { this._clases?.add(c); }, remove(c) { this._clases?.delete(c); } },
});

const nodos = new Map();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
  getElementById: (id) => nodos.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => elemento("nuevo"),
  addEventListener() {},
};
for (const el of ["inventory-list", "inventory-list-parts", "relic-inv-controls", "prime-inv-controls",
  "inv-tab-relics", "inv-tab-parts"]) nodos.set(el, elemento(el));
for (const n of nodos.values()) n.classList = { add: (c) => n._clases.add(c), remove: (c) => n._clases.delete(c) };

const { switchInvView } = await import("../deploy/js/ui.components/inventory/ui_inventory.js");
const { state } = await import("../deploy/js/state.js");

beforeEach(() => {
  nodos.get("inventory-list").style.display = "";
  nodos.get("inventory-list-parts").style.display = "none";
  // what updateUILabels() leaves at module load, before any data exists
  nodos.get("inventory-list").innerHTML =
    '<div class="inv-empty">No relics saved yet. Look one up in the Relic tab and add it with the counter.</div>';
  nodos.get("inventory-list-parts").innerHTML = "";
});

test("con 'parts' ya guardado, arrancar cambia de verdad a partes prime", () => {
  state.currentInvView = "parts";
  switchInvView("parts");
  assert.equal(nodos.get("inventory-list-parts").style.display, "",
    "la lista de partes seguía oculta: la app abre enseñando reliquias");
  assert.equal(nodos.get("inventory-list").style.display, "none");
  assert.equal(nodos.get("prime-inv-controls").style.display, "flex",
    "se veían los filtros de reliquias con PRIME PARTS marcado");
  assert.equal(nodos.get("relic-inv-controls").style.display, "none");
});

test("pulsar la vista que ya está puesta y pintada no rehace el trabajo", () => {
  state.currentInvView = "relics";
  nodos.get("relic-inv-controls").style.display = "MARCA";
  switchInvView("relics");
  assert.equal(nodos.get("relic-inv-controls").style.display, "MARCA", "volvió a montar la vista");
});

test("cambiar a una vista distinta siempre se aplica", () => {
  state.currentInvView = "relics";
  switchInvView("parts");
  assert.equal(state.currentInvView, "parts");
  assert.equal(nodos.get("inventory-list-parts").style.display, "");
});
