// Cómo se enseñan y se filtran los stats de un riven.
//
// Dos adaptadores pequeños que comparten el tasador, el índice y la ficha de meta-stats. Los
// dos fallan en silencio: uno deja el nombre en inglés en una app en español, el otro cuela
// una maldición imposible en la lista de "negativos recomendados" y manda al usuario a buscar
// un roll que el juego no puede generar.

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

// Preferible a enseñar un hueco: un stat nuevo sale en inglés hasta que alguien lo traduzca,
// pero la fila se pinta.
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

// Los nombres viejos del juego (la época del "channeling") siguen llegando desde datos
// guardados y desde el OCR. Se normalizan ANTES de traducir, así que también se arreglan en
// inglés — que es lo que no haría una simple entrada más en la tabla de español.
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

// --- El filtro de maldiciones imposibles ---------------------------------------------------

// Los elementales y Atravesar solo salen en positivo: recomendarlos como negativo manda al
// usuario a ciclar buscando algo que no existe.
test("los stats que nunca salen negativos se marcan como imposibles", () => {
  for (const s of ["Heat Damage", "Cold Damage", "Electric Damage", "Toxin Damage", "Punch Through"]) {
    assert.equal(CANT_BE_NEGATIVE.test(s), true, s);
  }
});

// El caso que documenta el comentario del código: "punch" es substring de nada útil, pero
// Puncture SÍ puede ser negativa y confundirlas la borraría de las recomendaciones.
test("Puncture Damage sí puede ser negativa, pese a parecerse a Punch Through", () => {
  assert.equal(CANT_BE_NEGATIVE.test("Puncture Damage"), false);
});

test("los stats normales pasan el filtro", () => {
  for (const s of ["Critical Damage", "Zoom", "Recoil", "Damage Vs Corpus"]) {
    assert.equal(CANT_BE_NEGATIVE.test(s), false, s);
  }
});

// Se usa como `.filter(s => !CANT_BE_NEGATIVE.test(s))` sobre listas que vienen de datos: un
// hueco no puede tumbar el render de las recomendaciones.
test("un valor basura no revienta el filtro", () => {
  for (const s of [null, undefined, "", 0]) {
    assert.doesNotThrow(() => CANT_BE_NEGATIVE.test(s), String(s));
  }
});
