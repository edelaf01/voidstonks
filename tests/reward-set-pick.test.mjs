// Qué recompensa de la pantalla te cierra un set.
//
// El modal ya marcaba la de más platino y la de mejor ratio de ducados, que responden a "qué
// vendo". Esta contesta la que suele decidir el clic: cuál me CIERRA algo. Una pieza de 5
// platino que completa un set vale más que una de 40 de un set sin empezar.
//
// Elegir mal aquí no da ningún error: se marca otra tarjeta y el usuario se lleva la pieza
// equivocada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBestForSets, setHelpOf } from "../deploy/js/utils/inventory/reward_set_pick.js";

const SETS = {
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis", "Gara Prime Systems"],
  "Akbronco Prime": ["Akbronco Prime Blueprint", "Akbronco Prime Link"],
};
const getSetName = (p) => (p?.match(/(.*?) (Prime|Vandal|Wraith)/) || [])[0]?.trim() || "Otros";
const deps = (primeInventory) => ({ setsDatabase: SETS, primeInventory, getSetName, getRequiredCount: () => 1 });
const item = (name) => ({ name });

test("una pieza que no te falta no ayuda", () => {
  assert.equal(setHelpOf("Gara Prime Chassis", deps({ "Gara Prime Chassis": 1 })), null);
});

test("Forma y demás no son de ningún set", () => {
  assert.equal(setHelpOf("Forma Blueprint", deps({})), null);
});

test("`left` son las piezas que quedarían DESPUÉS de coger esta", () => {
  const inv = { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1 };
  const h = setHelpOf("Gara Prime Chassis", deps(inv));
  assert.equal(h.set, "Gara Prime");
  assert.equal(h.left, 1, "quedaría solo Systems");
  assert.equal(h.total, 4);
});

test("la que cierra el set marca left 0", () => {
  const inv = Object.fromEntries(SETS["Gara Prime"].slice(0, 3).map((p) => [p, 1]));
  assert.equal(setHelpOf("Gara Prime Systems", deps(inv)).left, 0);
});

test("gana la que menos deja pendiente, no la primera", () => {
  const inv = { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1, "Gara Prime Chassis": 1 };
  const mejor = pickBestForSets(
    [item("Akbronco Prime Link"), item("Gara Prime Systems")], deps(inv));
  assert.equal(mejor.name, "Gara Prime Systems");
  assert.equal(mejor.left, 0);
});

// Sin este desempate, un warframe de 5 al que le faltan 2 empataba con un arma de 2 a la que le
// falta 1, y se elegía por orden de lectura de la pantalla.
test("a igualdad de piezas restantes gana el set más pequeño", () => {
  const inv = { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1 };
  const mejor = pickBestForSets(
    [item("Gara Prime Chassis"), item("Akbronco Prime Link")], deps(inv));
  assert.equal(mejor.left, 1);
  assert.equal(mejor.name, "Akbronco Prime Link", "el de 2 piezas se cierra antes de verdad");
});

test("si ninguna recompensa aporta, no se marca ninguna", () => {
  const todo = Object.fromEntries(Object.values(SETS).flat().map((p) => [p, 1]));
  assert.equal(pickBestForSets([item("Gara Prime Systems")], deps(todo)), null);
  assert.equal(pickBestForSets([], deps({})), null);
  assert.equal(pickBestForSets(null, deps({})), null);
});
