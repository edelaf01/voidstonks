// Histéresis del contexto de pantalla.
//
// El OCR de cabecera sale ilegible a ratos incluso sin cambiar de pantalla ("WARFRAVE", "go TC",
// "(ims sovo Mesh" leídos en la selección de reliquias). Creerse cada frame hace que el escáner
// salte de RELICS a REWARD y vuelva, recortando y pasando OCR sobre zonas que no tocan — y el
// síntoma es solo "va saltarín", sin ningún error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLatchedContext, INITIAL_LATCH } from "../deploy/js/utils/vision/context_latch.js";

/** Pasa una secuencia de contextos crudos y devuelve el enganchado tras cada uno. */
function correr(secuencia, inicial = INITIAL_LATCH) {
  let s = inicial;
  return secuencia.map((raw) => { s = nextLatchedContext(s, raw); return s.latched; });
}

// El bug: la histéresis era de un solo lado. UNKNOWN pedía 3 frames para soltar, pero cualquier
// otro contexto enganchaba con UNO, así que un frame de basura cambiaba el pipeline entero.
test("un solo frame de otro contexto NO cambia el enganchado", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"], "un frame suelto es ruido, no un cambio");
});

test("dos frames seguidos del mismo contexto sí lo cambian", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "REWARD"], s), ["RELICS", "REWARD"]);
});

// Dos lecturas de REWARD separadas por otra cosa no son dos frames seguidos de acuerdo: es
// justo el patrón del ruido, y contarlas juntas devolvería el bug.
test("el candidato se reinicia si entra otro contexto por medio", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "INVENTORY_MODS", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("una racha de UNKNOWN también corta al candidato a medias", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "UNKNOWN", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

// Soltar es más caro que confirmar: en una transición real la cabecera pasa por ilegible antes
// de estabilizarse, y soltar al primer UNKNOWN dejaría el escáner sin contexto a cada rato.
test("hacen falta 3 UNKNOWN seguidos para soltar el contexto", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "UNKNOWN"], s), ["RELICS", "RELICS", "UNKNOWN"]);
});

test("un frame bueno reinicia la cuenta de UNKNOWN", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "RELICS", "UNKNOWN", "UNKNOWN"], s),
    ["RELICS", "RELICS", "RELICS", "RELICS", "RELICS"]);
});

// Confirmar lo que ya está no cuesta nada: sin esto, quedarse en una pantalla acumularía
// `pending` y un cambio real tardaría de más.
test("confirmar el contexto actual es inmediato y no acumula estado", () => {
  const s = nextLatchedContext({ latched: "RELICS", unknownCount: 2, pending: "REWARD", pendingCount: 1 }, "RELICS");
  assert.deepEqual(s, { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 });
});

test("no muta el estado que recibe", () => {
  const prev = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  const copia = { ...prev };
  nextLatchedContext(prev, "REWARD");
  assert.deepEqual(prev, copia);
});

// Los dos frames existen para que la basura no robe un contexto YA confirmado. Venir de UNKNOWN
// no es eso: es adquirir. Pedirle dos frames solo retrasaba la primera lectura de recompensas,
// que es justo lo que el usuario espera ver rápido.
test("salir de UNKNOWN engancha al primer frame", () => {
  const s = { latched: "UNKNOWN", unknownCount: 5, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["REWARD"]);
});

test("pero cambiar entre dos contextos conocidos sigue pidiendo dos", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"]);
});
