// Preferencias de la pestaña Farms: sindicatos ocultos, grupos plegados y óptimas propias.
//
// Son las decisiones que el usuario toma una vez y espera no repetir. Su fallo es silencioso en
// las dos direcciones: o se pierden al recargar, o se quedan pegadas y no hay forma de
// deshacerlas. Ninguna da error.

import { test } from "node:test";
import assert from "node:assert/strict";

let almacen = {};
globalThis.localStorage = {
  getItem: (k) => (k in almacen ? almacen[k] : null),
  setItem: (k, v) => { almacen[k] = String(v); },
  removeItem: (k) => { delete almacen[k]; },
};

const P = await import("../deploy/js/services/farms/farms_prefs.service.js");

const mision = (o = {}) => ({
  factionKey: "Cavia", tier: 3, technicalType: "Exterminate", isOptimal: false, ...o,
});

// --- Preferencias de vista ---------------------------------------------------------------

test("sin nada guardado no hay nada oculto ni plegado", () => {
  almacen = {};
  assert.deepEqual(P.getViewPrefs(), { hiddenFactions: [], collapsed: [] });
});

test("lo guardado se relee tal cual", () => {
  almacen = {};
  P.saveViewPrefs({ hiddenFactions: ["Ostrons"], collapsed: ["Cavia"] });
  assert.deepEqual(P.getViewPrefs(), { hiddenFactions: ["Ostrons"], collapsed: ["Cavia"] });
});

// Viene de localStorage, o sea de fuera: un valor corrupto no puede dejar la pestaña en blanco
// ni petar al abrirla.
test("unas preferencias corruptas caen al valor por defecto", () => {
  for (const basura of ["{no es json", '{"hiddenFactions":"Ostrons"}', "null", "[]"]) {
    almacen.vs_farms_view_v1 = basura;
    const p = P.getViewPrefs();
    assert.ok(Array.isArray(p.hiddenFactions), basura);
    assert.ok(Array.isArray(p.collapsed), basura);
  }
});

// --- Óptimas personalizadas ---------------------------------------------------------------

// La clave es por PATRÓN (facción|tier|tipo), no por rotación: marcar "Cavia T3 Exterminate"
// tiene que seguir valiendo en las rotaciones siguientes. Si llevara el nodo o la fecha, el
// usuario tendría que volver a marcarla cada dos horas y media.
test("la clave de una óptima es el patrón, no la rotación concreta", () => {
  const a = P.optimalKey(mision({ uName: "JobA", expiry: "2026-01-01" }));
  const b = P.optimalKey(mision({ uName: "JobB", expiry: "2026-06-15" }));
  assert.equal(a, b, "la misma misión en otra rotación es la misma óptima");
  assert.notEqual(a, P.optimalKey(mision({ tier: 4 })), "otro tier sí es otra cosa");
  assert.notEqual(a, P.optimalKey(mision({ factionKey: "Ostrons" })));
});

test("sin marcas propias manda lo que trae la misión", () => {
  almacen = {};
  const ov = P.getOptimalOverrides();
  assert.equal(P.isEffectiveOptimal(mision({ isOptimal: true }), ov), true);
  assert.equal(P.isEffectiveOptimal(mision({ isOptimal: false }), ov), false);
});

test("marcar una que no era óptima la añade", () => {
  almacen = {};
  const m = mision({ isOptimal: false });
  P.toggleOptimalOverride(P.optimalKey(m), false);
  assert.equal(P.isEffectiveOptimal(m, P.getOptimalOverrides()), true);
});

// Quitar una óptima DE SERIE no se puede hacer borrándola de `added` (nunca estuvo): tiene que
// ir a `removed`, o al recargar vuelve a salir marcada.
test("desmarcar una óptima de serie la manda a la lista de anuladas", () => {
  almacen = {};
  const m = mision({ isOptimal: true });
  P.toggleOptimalOverride(P.optimalKey(m), true);

  const ov = P.getOptimalOverrides();
  assert.deepEqual(ov.added, []);
  assert.deepEqual(ov.removed, [P.optimalKey(m)]);
  assert.equal(P.isEffectiveOptimal(m, ov), false, "y deja de contar como óptima");
});

test("desmarcar una que habías marcado tú la borra en vez de anularla", () => {
  almacen = {};
  const m = mision({ isOptimal: false });
  const k = P.optimalKey(m);
  P.toggleOptimalOverride(k, false); // la marco
  P.toggleOptimalOverride(k, true); // la desmarco

  const ov = P.getOptimalOverrides();
  assert.deepEqual(ov.added, [], "sale de added");
  assert.deepEqual(ov.removed, [], "y NO se queda anulada: vuelve a su estado de serie");
});

// Cada clic entra y sale de la misma lista; sin la comprobación de duplicados, marcar dos veces
// dejaba la clave dos veces y hacía falta desmarcar dos veces para quitarla.
test("marcar dos veces la misma no la duplica", () => {
  almacen = {};
  const k = P.optimalKey(mision());
  P.toggleOptimalOverride(k, false);
  P.toggleOptimalOverride(k, false);
  assert.deepEqual(P.getOptimalOverrides().added, [k]);
});

test("una lista de óptimas corrupta no bloquea la pestaña", () => {
  almacen.vs_farms_optimal_v1 = "{roto";
  assert.deepEqual(P.getOptimalOverrides(), { added: [], removed: [] });

  almacen.vs_farms_optimal_v1 = JSON.stringify({ added: "no es lista", removed: 7 });
  assert.deepEqual(P.getOptimalOverrides(), { added: [], removed: [] });
});

// added gana a removed: si una clave acabara en las dos listas por una escritura a medias, la
// misión se enseña marcada en vez de desaparecer de las óptimas sin motivo aparente.
test("con la clave en las dos listas, manda la marca del usuario", () => {
  const k = P.optimalKey(mision());
  almacen.vs_farms_optimal_v1 = JSON.stringify({ added: [k], removed: [k] });
  assert.equal(P.isEffectiveOptimal(mision(), P.getOptimalOverrides()), true);
});
