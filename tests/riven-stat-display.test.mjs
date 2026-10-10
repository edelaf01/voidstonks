import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { state } = await import("../deploy/js/state.js");
const { getLocalizedStatName, CANT_BE_NEGATIVE, textoDelStat } =
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

test("la cadencia se llama Fire Rate en armas de fuego y Attack Speed en melee", () => {
  const stat = { name: "Fire Rate / Attack Speed", value: 80.8, isPositive: false };
  assert.equal(textoDelStat(stat, 1), "-80.8% Fire Rate");
  assert.equal(textoDelStat(stat, 3), "-80.8% Attack Speed");
});

test("los stats sin porcentaje llevan su unidad", () => {
  assert.equal(textoDelStat({ name: "Punch Through", value: 2.6, isPositive: true }, 1), "+2.6m Punch Through");
  assert.equal(textoDelStat({ name: "Combo Duration", value: 8.1, isPositive: true }, 3), "+8.1s Combo Duration");
  assert.equal(textoDelStat({ name: "Initial Combo", value: 12, isPositive: true }, 3), "+12 Initial Combo");
});

test("el daño a facción se enseña como multiplicador", () => {
  assert.equal(textoDelStat({ name: "Damage to Infested", value: 59, isPositive: true }, 1), "x1.59 Damage to Infested");
  assert.equal(textoDelStat({ name: "Damage to Corpus", value: 20, isPositive: false }, 1), "x0.8 Damage to Corpus");
});

test("el retroceso bueno sale con menos y el malo con más", () => {
  assert.equal(textoDelStat({ name: "Recoil", value: 90, isPositive: true }, 0), "-90% Recoil");
  assert.equal(textoDelStat({ name: "Recoil", value: 60, isPositive: false }, 0), "+60% Recoil");
});
