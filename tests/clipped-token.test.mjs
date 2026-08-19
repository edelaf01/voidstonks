// words whose FIRST letters the OCR ate, matched against the candidate tail instead of the whole word
// dropping "CHASSIS" is not neutral: "Hildryn Prime Chassis Blueprint" becomes "Hildryn Prime Blueprint", which exists and is another item

import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverClippedToken, MIN_TAIL_SCORE } from "../deploy/js/utils/vision/clipped_token.js";

// toy similarity: 1 - (distance / length); the real one, OCR confusion aware, is injected by the matcher
function sim(a, b) {
  if (a === b) return 1;
  const n = Math.max(a.length, b.length);
  let iguales = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) iguales++;
  return iguales / n;
}
const VOCAB = ["CHASSIS", "SYSTEMS", "NEUROPTICS", "BLUEPRINT", "PRIME", "HILDRYN", "BARREL", "LIMB", "LIMBO"];

test("recupera el caso que se tiraba: dos letras comidas", () => {
  assert.equal(recoverClippedToken("ASSIS", VOCAB, sim), "CHASSIS");
  assert.equal(recoverClippedToken("YSTEMS", VOCAB, sim), "SYSTEMS");
});

test("compara por similitud, no por sufijo exacto", () => {
  const casi = (a, b) => (a === b ? 1 : 0.95);
  assert.equal(recoverClippedToken("A55IS", VOCAB, casi), null,
    "con varios candidatos igual de buenos no se elige ninguno");
  assert.equal(recoverClippedToken("A55IS", ["CHASSIS"], casi), "CHASSIS");
});

test("no adivina con fragmentos cortos", () => {
  assert.equal(recoverClippedToken("RIME", VOCAB, sim), null);
  assert.equal(recoverClippedToken("", VOCAB, sim), null);
});

test("solo hasta dos letras comidas", () => {
  assert.equal(recoverClippedToken("OPTICS", VOCAB, sim), null, "a NEUROPTICS le faltarían 4");
  assert.equal(recoverClippedToken("EUROPTICS", VOCAB, sim), "NEUROPTICS");
});

// with a short tail a chance hit is cheap among thousands of tokens: the best one has to stand out
test("dos candidatos parecidos no eligen ninguno", () => {
  const empate = () => 1;
  assert.equal(recoverClippedToken("IMBOX", ["LIMBOX", "TIMBOX"], empate), null);
});

test("por debajo del umbral no se recupera nada", () => {
  const flojo = () => MIN_TAIL_SCORE - 0.01;
  assert.equal(recoverClippedToken("ASSIS", ["CHASSIS"], flojo), null);
});

test("una palabra completa no es un recorte", () => {
  assert.equal(recoverClippedToken("CHASSIS", VOCAB, sim), null, "misma longitud: no falta nada");
});

test("tolera entradas inválidas", () => {
  assert.equal(recoverClippedToken("ASSIS", VOCAB, null), null, "sin similitud no se decide");
  assert.equal(recoverClippedToken("ASSIS", null, sim), null);
  assert.equal(recoverClippedToken("ASSIS", new Set(VOCAB), sim), "CHASSIS", "también acepta Set");
});
