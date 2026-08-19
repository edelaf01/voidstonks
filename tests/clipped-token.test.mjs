// Palabras a las que el OCR les comió las PRIMERAS letras.
//
// El emparejador ya casaba por similitud, pero comparando la palabra ENTERA: a la leída le
// faltan letras y eso penaliza. Medido con la similitud real del repo (umbral 0.85):
//
//     LUEPRINT vs BLUEPRINT  ->  0.889  pasaba      (una letra comida)
//     ASSIS    vs CHASSIS    ->  0.714  SE TIRABA   (dos letras comidas)
//
// Y tirar "CHASSIS" no es neutro: "Hildryn Prime Chassis Blueprint" queda como "Hildryn Prime
// Blueprint", que EXISTE y es otro ítem. No falla, acierta mal — y con auto-sync eso escribe la
// cantidad en la pieza equivocada.
//
// Comparando solo la COLA del candidato, esa misma lectura da 1.000.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverClippedToken, MIN_TAIL_SCORE } from "../deploy/js/utils/vision/clipped_token.js";

// Similitud de juguete: 1 - (distancia / largo). Suficiente para fijar la FORMA de la decisión;
// la de verdad (consciente de confusiones OCR) se inyecta desde el emparejador.
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

// La comparación es contra la COLA, no un endsWith: una lectura real trae recorte Y confusión
// de glifos a la vez, y el sufijo exacto solo cubre la primera.
test("compara por similitud, no por sufijo exacto", () => {
  // Una letra distinta dentro de la cola sigue valiendo si la similitud lo aguanta.
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

// Con la cola corta, acertar por azar es barato entre miles de tokens: hace falta que el mejor
// DESTAQUE, no que gane por centésimas.
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
