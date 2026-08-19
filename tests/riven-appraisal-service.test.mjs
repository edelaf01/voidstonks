// El multiplicador de deseabilidad y la tasación de un roll.
//
// Es el número que decide si la app te dice que un riven vale 40 o 400 platino, y **es la misma
// función para las tres vistas** (pestaña de rivens, HUD del escáner, comparación de dos rolls):
// si diverge, el escáner tasa distinto que la pestaña sobre el mismo riven y no hay forma de
// saber cuál miente.
//
// Se comprueba el comportamiento, no las constantes: qué ordena por encima de qué, y las cuatro
// reglas que la propia función documenta con su historia de bugs.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const { computeDesirabilityMultiplier, appraiseParsedRiven } =
  await import("../deploy/js/services/rivens/riven_appraisal.service.js");

// Sin pesos del ML ni prior: se ejercitan las listas universales, que son el último recurso y el
// camino que corre cuando el bundle de ML no ha cargado.
state.rivenStatBaseline = null;
state.rivenStatPrior = null;

const RIFLE = { t: "Rifle", name: "Braton" };
const MELEE = { t: "Melee", name: "Dagger" };
const META = { name: "Braton", pos: [], midPos: [], neg: [], midNeg: [] };

const pos = (name, value = 100) => ({ name, value });
const neg = (name, value = -50) => ({ name, value });

test("un roll de puros stats meta puntúa por encima de uno de basura", () => {
  const bueno = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Zoom")], META, RIFLE);
  const malo = computeDesirabilityMultiplier(
    [pos("Zoom"), pos("Recoil"), neg("Zoom")], META, RIFLE);
  assert.ok(bueno > malo, `${bueno} debería superar a ${malo}`);
});

// Sin negativa el riven cuesta más de ciclar y vale menos que el mismo roll con una maldición
// inofensiva: es la penalización explícita por "sin negativa".
test("no tener negativa penaliza frente a tener una inofensiva", () => {
  const conNegInocua = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Zoom")], META, RIFLE);
  const sinNeg = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot")], META, RIFLE);
  assert.ok(sinNeg < conNegInocua, `sin negativa (${sinNeg}) no puede ganar a ${conNegInocua}`);
});

// El caso que el código llama "brick": una negativa sobre el stat que el arma más quiere deja el
// riven casi sin valor por bueno que sea el resto.
test("una negativa sobre un stat clave hunde el roll aunque los positivos sean perfectos", () => {
  const m = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Critical Chance")], META, RIFLE);
  assert.ok(m <= 0.1, `un brick debería quedar en el suelo, no en ${m}`);
});

// El daño por facción es la maldición barata clásica: se lleva un hueco de negativa sin quitar
// potencia real, así que no puede contar como ruina.
test("el daño por facción en negativo no cuenta como maldición mala", () => {
  const facción = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Damage to Grineer")], META, RIFLE);
  const critica = computeDesirabilityMultiplier(
    [pos("Critical Damage"), pos("Multishot"), neg("Critical Chance")], META, RIFLE);
  assert.ok(facción > critica, `${facción} debería superar a ${critica}`);
});

// El comentario del código lo avisa: por el emparejado tolerante, "Damage" a secas casaba con
// trece stats distintos y `find` devolvía Critical Damage. Si eso volviera, un roll con -Damage
// dejaría de leerse como lo que es.
test('"Damage" a secas no se confunde con Critical Damage', () => {
  const conDamage = computeDesirabilityMultiplier([pos("Damage"), neg("Zoom")], META, RIFLE);
  const conCrit = computeDesirabilityMultiplier([pos("Critical Damage"), neg("Zoom")], META, RIFLE);
  assert.ok(conDamage > 0.1 && conCrit > 0.1, "los dos deben valorarse");
});

// Los stats buenos no son los mismos en melee que a distancia: Range vale en melee y Multishot
// no existe ahí.
test("melee y arma de fuego no valoran los mismos stats", () => {
  const rangeEnMelee = computeDesirabilityMultiplier(
    [pos("Range"), pos("Critical Damage"), neg("Zoom")], { ...META, name: "Dagger" }, MELEE);
  const rangeEnRifle = computeDesirabilityMultiplier(
    [pos("Range"), pos("Critical Damage"), neg("Zoom")], META, RIFLE);
  assert.ok(rangeEnMelee > rangeEnRifle, `melee ${rangeEnMelee} vs rifle ${rangeEnRifle}`);
});

test("el multiplicador nunca se sale de su rango", () => {
  const casos = [
    [],
    [pos("Critical Damage"), pos("Multishot"), pos("Critical Chance")],
    [neg("Critical Chance"), neg("Multishot"), neg("Damage")],
    [pos("Zoom"), pos("Recoil"), pos("Ammo Maximum"), pos("Zoom"), neg("Zoom")],
  ];
  for (const stats of casos) {
    const m = computeDesirabilityMultiplier(stats, META, RIFLE);
    assert.ok(m >= 0.1 && m <= 1.0, `${m} fuera de [0.1, 1.0] con ${stats.length} stats`);
  }
});

test("un meta corrupto no revienta la tasación", () => {
  for (const malo of [{}, { pos: "no es lista", neg: 7 }, { name: "X" }]) {
    assert.doesNotThrow(
      () => computeDesirabilityMultiplier([pos("Critical Damage")], malo, RIFLE), JSON.stringify(malo));
  }
});

// --- appraiseParsedRiven --------------------------------------------------------------------

// Devolver null y no un objeto a medias es lo que permite al escáner enseñar "sin datos" en vez
// de un precio inventado para un arma que Digital Extremes no publica.
test("sin meta del arma no se inventa una tasación", () => {
  state.weaponMap = {};
  assert.equal(appraiseParsedRiven("Arma Inexistente", [pos("Critical Damage")]), null);
});

test("con meta devuelve las cuatro piezas que espera quien la pinta", () => {
  state.weaponMap = { Braton: { t: "Rifle", disposition: 1.0 } };
  const r = appraiseParsedRiven("Braton", [
    { name: "Critical Damage", value: 120, isPositive: true },
    { name: "Zoom", value: 30, isPositive: false },
  ], META);

  assert.ok(r, "debe tasar");
  for (const clave of ["meta", "tiers", "prediction", "itemAttributes"]) {
    assert.ok(clave in r, `falta ${clave}`);
  }
  assert.equal(r.itemAttributes.length, 2);
});

// El signo se lleva en `isPositive`, no en el valor: el OCR y la pestaña entregan las negativas
// como valor POSITIVO con la bandera a false, y confundirlo invertiría la tasación.
test("las negativas llegan con el valor en positivo y la bandera aparte", () => {
  state.weaponMap = { Braton: { t: "Rifle", disposition: 1.0 } };
  const r = appraiseParsedRiven("Braton", [
    { name: "Zoom", value: 30, isPositive: false },
  ], META);
  assert.equal(r.itemAttributes[0].isPositive, false);
  assert.ok(r.itemAttributes[0].value > 0, "el valor absoluto, no el signo");
});
