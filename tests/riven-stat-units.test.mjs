// riven stat units are not all percentages: punch through uses meters, combo duration seconds, initial
// combo is flat
// appending '%' unconditionally corrupts units on both values and calculated ideal ranges

import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRivenGrade } from "../deploy/js/utils/rivens/riven_logic.js";
import { statUnit } from "../deploy/js/utils/rivens/riven_stat_display.js";

test("los stats planos no usan porcentaje como unidad", () => {
  assert.notEqual(statUnit("Punch Through"), "%");
  assert.notEqual(statUnit("punch through"), "%");
  assert.notEqual(statUnit("Combo Duration"), "%");
  assert.notEqual(statUnit("Initial Combo"), "%");
  assert.notEqual(statUnit("Channeling Damage"), "%");
});

test("los stats porcentuales habituales devuelven '%'", () => {
  assert.equal(statUnit("Critical Chance"), "%");
  assert.equal(statUnit("Damage"), "%");
  assert.equal(statUnit("Multishot"), "%");
});

test("el rango ideal de calculateRivenGrade para Punch Through no termina en '%'", () => {
  const weaponData = { d: 1.0, t: "Rifle" };
  const res = calculateRivenGrade(weaponData, "Punch Through", 2.7, false, 2, false);
  assert.ok(res && res.range !== "N/A");
  assert.equal(res.range.endsWith("%"), false);
});
