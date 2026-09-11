// Abrir la app con la sub-vista "partes prime" guardada tiene que ABRIR en partes prime.
//
// Regresión real: se abría con PRIME PARTS marcado pero enseñando los filtros de reliquias y su
// "No relics saved yet" — con el inventario lleno. La causa era el corte de switchInvView, que
// miraba SIEMPRE la lista de reliquias: al arrancar, updateUILabels() corre a nivel de módulo y
// ya la había rellenado con el mensaje de vacío, así que el cambio a partes se descartaba.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Elemento mínimo: lo justo que toca switchInvView. */
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
  // Lo que deja updateUILabels() al cargarse el módulo, antes de que exista ningún dato.
  nodos.get("inventory-list").innerHTML =
    '<div class="inv-empty">No relics saved yet. Look one up in the Relic tab and add it with the counter.</div>';
  nodos.get("inventory-list-parts").innerHTML = "";
});

test("con 'parts' ya guardado, arrancar cambia de verdad a partes prime", () => {
  // Es la situación del arranque: loadAppState() ya restauró la vista y main.js llama aquí.
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
