// Los stats de rivens en Warframe no son todos porcentajes: atravesar va en metros, duración
// de combo en segundos y combo inicial es un entero plano. Poner '%' a todo confunde unidades
// tanto en el valor del stat como en el rango ideal calculado.

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
