import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const {
  calculateGroupSubtotal,
  sumIndividualParts,
  calculatePossibleSets,
  calculateSetPlusLeftovers,
} = await import("../deploy/js/services/inventory/inventory_value.service.js");

const MANIFEST = [{
  name: "Saryn Prime",
  components: [
    { name: "Blueprint", itemCount: 1 },
    { name: "Chassis", itemCount: 2 },
    { name: "Systems", itemCount: 1 },
  ],
}];

const PIEZAS = ["Saryn Prime", "Saryn Prime Chassis", "Saryn Prime Systems"];

const grupo = (parts, extra = {}) => ({ parts, setPrice: 0, setPriceLoaded: false, ...extra });
const pieza = (qty, price) => ({ qty, price });

function conBase(fn) {
  const antes = { m: state.primeManifest, s: state.setsDatabase, i: state.itemsDatabase };
  state.primeManifest = MANIFEST;
  state.setsDatabase = { "Saryn Prime": PIEZAS };
  state.itemsDatabase = Object.fromEntries(PIEZAS.map((n) => [n, {}]));
  try { fn(); } finally {
    state.primeManifest = antes.m; state.setsDatabase = antes.s; state.itemsDatabase = antes.i;
  }
}

test("sin piezas para un set completo se suman las sueltas", () => {
  conBase(() => {
    const g = grupo({
      "Saryn Prime": pieza(1, 10),
      "Saryn Prime Chassis": pieza(1, 20),
    }, { setPrice: 500, setPriceLoaded: true });
    assert.equal(calculateGroupSubtotal("Saryn Prime", g), 30);
  });
});

test("con el set completo manda el precio del set, no el de las piezas", () => {
  conBase(() => {
    const g = grupo({
      "Saryn Prime": pieza(1, 10),
      "Saryn Prime Chassis": pieza(2, 20),
      "Saryn Prime Systems": pieza(1, 30),
    }, { setPrice: 500, setPriceLoaded: true });
    assert.equal(calculateGroupSubtotal("Saryn Prime", g), 500, "80 en piezas valen 500 armadas");
  });
});

test("lo que sobra tras armar los sets se cuenta aparte", () => {
  conBase(() => {
    const g = grupo({
      "Saryn Prime": pieza(3, 10),
      "Saryn Prime Chassis": pieza(2, 20),
      "Saryn Prime Systems": pieza(1, 30),
    }, { setPrice: 500, setPriceLoaded: true });
    assert.equal(calculateGroupSubtotal("Saryn Prime", g), 520);
  });
});

test("mientras el precio del set no llega se suma por piezas", () => {
  conBase(() => {
    const parts = {
      "Saryn Prime": pieza(1, 10),
      "Saryn Prime Chassis": pieza(2, 20),
      "Saryn Prime Systems": pieza(1, 30),
    };
    assert.equal(calculateGroupSubtotal("Saryn Prime", grupo(parts)), 80);
    assert.equal(
      calculateGroupSubtotal("Saryn Prime", grupo(parts, { setPrice: 500, setPriceLoaded: true })),
      500,
    );
  });
});

test('"Otros" siempre se suma pieza a pieza', () => {
  conBase(() => {
    const g = grupo({ Forma: pieza(3, 5) }, { setPrice: 999, setPriceLoaded: true });
    assert.equal(calculateGroupSubtotal("Otros", g), 15);
  });
});

test("un set que no está en ninguna base se suma pieza a pieza", () => {
  conBase(() => {
    state.setsDatabase = {};
    state.itemsDatabase = {};
    const g = grupo({ "Fantasma Prime Blade": pieza(2, 7) }, { setPrice: 900, setPriceLoaded: true });
    assert.equal(calculateGroupSubtotal("Fantasma Prime", g), 14);
  });
});

test("las cantidades y los precios que falten cuentan como cero", () => {
  assert.equal(sumIndividualParts({ a: {}, b: pieza(2, undefined), c: pieza(undefined, 9) }), 0);
  assert.equal(sumIndividualParts({}), 0);
});

test("los sets posibles los limita la pieza más escasa, contando duplicados", () => {
  conBase(() => {
    const g = grupo({
      "Saryn Prime": pieza(5, 0),
      "Saryn Prime Chassis": pieza(4, 0),
      "Saryn Prime Systems": pieza(5, 0),
    });
    assert.equal(calculatePossibleSets("Saryn Prime", g, PIEZAS), 2);
  });
});

test("si falta una pieza entera no hay ningún set", () => {
  conBase(() => {
    const g = grupo({ "Saryn Prime": pieza(9, 0), "Saryn Prime Chassis": pieza(9, 0) });
    assert.equal(calculatePossibleSets("Saryn Prime", g, PIEZAS), 0, "sin Systems no hay set");
  });
});

test("una lista de piezas vacía da cero sets, no el centinela", () => {
  assert.equal(calculatePossibleSets("Saryn Prime", grupo({}), []), 0);
});

test("los restos negativos no restan del total", () => {
  conBase(() => {
    const g = grupo({
      "Saryn Prime": pieza(1, 10),
      "Saryn Prime Chassis": pieza(2, 20),
    }, { setPrice: 100 });
    assert.equal(calculateSetPlusLeftovers("Saryn Prime", g, 1), 100, "no sobra nada de nada");
  });
});
