import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const { getLocalizedStatName, CANT_BE_NEGATIVE } =
  await import("../deploy/js/utils/rivens/riven_stat_display.js");

const enEspanol = (fn) => {
  const antes = state.currentLang;
  state.currentLang = "es";
  try { return fn(); } finally { state.currentLang = antes; }
};

test("en inglés el nombre se devuelve tal cual", () => {
  state.currentLang = "en";
  assert.equal(getLocalizedStatName("Critical Damage"), "Critical Damage");
});

test("en español se traduce lo que está en la tabla", () => {
  enEspanol(() => {
    assert.equal(getLocalizedStatName("Critical Damage"), "Daño Crítico");
    assert.equal(getLocalizedStatName("Punch Through"), "Atravesar");
  });
});

test("un stat sin traducir sale en inglés, no vacío", () => {
  enEspanol(() => {
    assert.equal(getLocalizedStatName("Stat Inventado"), "Stat Inventado");
  });
});

test("sin nombre devuelve cadena vacía, no undefined", () => {
  assert.equal(getLocalizedStatName(""), "");
  assert.equal(getLocalizedStatName(null), "");
  assert.equal(getLocalizedStatName(undefined), "");
});

test("los nombres de la era del channeling se normalizan en los dos idiomas", () => {
  state.currentLang = "en";
  assert.equal(getLocalizedStatName("Channeling Damage"), "Initial Combo");
  assert.equal(getLocalizedStatName("Channeling Efficiency"), "Heavy Attack Efficiency");
  assert.equal(getLocalizedStatName("Charge Damage"), "Heavy Attack Damage");

  enEspanol(() => {
    assert.equal(getLocalizedStatName("Channeling Damage"), "Combo Inicial");
    assert.equal(getLocalizedStatName("Charge Damage"), "Daño de Ataque Pesado");
  });
});

test("los stats que nunca salen negativos se marcan como imposibles", () => {
  for (const s of ["Heat Damage", "Cold Damage", "Electric Damage", "Toxin Damage", "Punch Through"]) {
    assert.equal(CANT_BE_NEGATIVE.test(s), true, s);
  }
});

test("Puncture Damage sí puede ser negativa, pese a parecerse a Punch Through", () => {
  assert.equal(CANT_BE_NEGATIVE.test("Puncture Damage"), false);
});

test("los stats normales pasan el filtro", () => {
  for (const s of ["Critical Damage", "Zoom", "Recoil", "Damage Vs Corpus"]) {
    assert.equal(CANT_BE_NEGATIVE.test(s), false, s);
  }
});

test("un valor basura no revienta el filtro", () => {
  for (const s of [null, undefined, "", 0]) {
    assert.doesNotThrow(() => CANT_BE_NEGATIVE.test(s), String(s));
  }
});
