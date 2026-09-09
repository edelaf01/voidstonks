// saltaPorSinResultado / siguienteEstadoSinResultado: la guarda que evita repetir el OCR sobre
// una pantalla estática que ya se sabe sin resultado (rivens, y ahora recompensas).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADO_INICIAL,
  saltaPorSinResultado,
  siguienteEstadoSinResultado,
} from "../deploy/js/utils/vision/no_result_skip.js";

test("estado inicial nunca salta (no hay nada cacheado)", () => {
  assert.equal(saltaPorSinResultado("aa", ESTADO_INICIAL, 1000, 3000), false);
});

test("mismo hash dentro de la caducidad: salta", () => {
  const estado = siguienteEstadoSinResultado(false, "aa", 1000);
  assert.equal(saltaPorSinResultado("aa", estado, 2000, 3000), true);
});

test("hash distinto: no salta aunque esté dentro de la caducidad", () => {
  const estado = siguienteEstadoSinResultado(false, "aa", 1000);
  assert.equal(saltaPorSinResultado("ff", estado, 2000, 3000), false);
});

test("pasada la caducidad, reintenta aunque el hash coincida", () => {
  const estado = siguienteEstadoSinResultado(false, "aa", 1000);
  assert.equal(saltaPorSinResultado("aa", estado, 1000 + 3000, 3000), false);
});

test("hubo resultado: el estado se limpia y deja de saltar", () => {
  const sinResultado = siguienteEstadoSinResultado(false, "aa", 1000);
  const conResultado = siguienteEstadoSinResultado(true, "aa", 1500);
  assert.deepEqual(conResultado, ESTADO_INICIAL);
  assert.equal(saltaPorSinResultado("aa", conResultado, 1600, 3000), false);
  assert.notDeepEqual(sinResultado, ESTADO_INICIAL);
});
