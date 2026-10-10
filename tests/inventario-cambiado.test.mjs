import test from "node:test";
import assert from "node:assert/strict";

const elemento = (id) => ({
  id,
  innerHTML: "",
  textContent: "",
  title: "",
  children: [],
  style: { display: "" },
  _clases: new Set(),
  classList: { add(c) { this._clases?.add(c); }, remove(c) { this._clases?.delete(c); } },
  setAttribute() {},
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
for (const el of ["txt-relic-inv-count", "btn-relic-inv-add"]) nodos.set(el, elemento(el));
for (const n of nodos.values()) n.classList = { add: (c) => n._clases.add(c), remove: (c) => n._clases.delete(c) };

const { inventarioCambiado } = await import("../deploy/js/ui.components/inventory/ui_inventory.js");
const { state } = await import("../deploy/js/state.js");

test("avisar de un cambio repinta el contador de la reliquia abierta y el panel de rutas", () => {
  let avisos = 0;
  globalThis.scheduleFarmRoutesRefresh = () => { avisos++; };
  try {
    state.selectedRelic = "Axi A1";
    state.inventory = [{ name: "Axi A1", count: 3 }];
    inventarioCambiado();
    assert.match(nodos.get("txt-relic-inv-count").textContent, /\b3\b/);
    assert.equal(avisos, 1);
    state.inventory = [{ name: "Axi A1", count: 5 }];
    inventarioCambiado();
    assert.match(nodos.get("txt-relic-inv-count").textContent, /\b5\b/);
    assert.equal(avisos, 2);
  } finally {
    delete globalThis.scheduleFarmRoutesRefresh;
  }
});

test("se publica en globalThis para el escáner", () => {
  assert.equal(globalThis.inventarioCambiado, inventarioCambiado);
});

test("sin el panel de rutas cargado no rompe", () => {
  assert.doesNotThrow(() => inventarioCambiado());
});
