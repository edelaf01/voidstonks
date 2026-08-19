import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLatchedContext, INITIAL_LATCH } from "../deploy/js/utils/vision/context_latch.js";

function correr(secuencia, inicial = INITIAL_LATCH) {
  let s = inicial;
  return secuencia.map((raw) => { s = nextLatchedContext(s, raw); return s.latched; });
}

test("un solo frame de otro contexto NO cambia el enganchado", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"], "un frame suelto es ruido, no un cambio");
});

test("dos frames seguidos del mismo contexto sí lo cambian", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "REWARD"], s), ["RELICS", "REWARD"]);
});

test("el candidato se reinicia si entra otro contexto por medio", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "INVENTORY_MODS", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("una racha de UNKNOWN también corta al candidato a medias", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD", "UNKNOWN", "REWARD"], s), ["RELICS", "RELICS", "RELICS"]);
});

test("hacen falta 3 UNKNOWN seguidos para soltar el contexto", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "UNKNOWN"], s), ["RELICS", "RELICS", "UNKNOWN"]);
});

test("un frame bueno reinicia la cuenta de UNKNOWN", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["UNKNOWN", "UNKNOWN", "RELICS", "UNKNOWN", "UNKNOWN"], s),
    ["RELICS", "RELICS", "RELICS", "RELICS", "RELICS"]);
});

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

test("salir de UNKNOWN engancha al primer frame", () => {
  const s = { latched: "UNKNOWN", unknownCount: 5, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["REWARD"]);
});

test("pero cambiar entre dos contextos conocidos sigue pidiendo dos", () => {
  const s = { latched: "RELICS", unknownCount: 0, pending: null, pendingCount: 0 };
  assert.deepEqual(correr(["REWARD"], s), ["RELICS"]);
});
