// which reward on screen closes a set
// modal already showed highest platinum and best ducat ratio ("what to sell"); this decides clicks by what
// COMPLETES a set
// a bad pick produces no error: another card gets marked and user takes the wrong part

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

// without this tiebreaker, a 5-part warframe missing 2 tied with a 2-part weapon missing 1, picking by
// arbitrary screen read order
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
