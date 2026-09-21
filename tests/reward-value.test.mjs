// Cuál de las cuatro recompensas te deja más platino.
//
// Las tres etiquetas de antes señalaban tarjetas distintas sin decir cuál gana: "cierra set"
// se ponía igual cerrando Akbronco (set barato, prima ~0) que cerrando un warframe de 200p.
// Equivocarse aquí no da error: el usuario se lleva la pieza peor y no se entera.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saleValue, rewardValue, pickBestReward, rankRewards, DUCATS_PER_PLAT, ducatsBeatSale, mejoresPorMoneda,
} from "../deploy/js/utils/inventory/reward_value.js";

const SETS = {
  "Akbronco Prime": ["Akbronco Prime Blueprint", "Akbronco Prime Link"],
  "Strun Prime": ["Strun Prime Blueprint", "Strun Prime Barrel", "Strun Prime Receiver", "Strun Prime Stock"],
  "Yareli Prime": ["Yareli Prime Blueprint", "Yareli Prime Neuroptics", "Yareli Prime Chassis", "Yareli Prime Systems"],
};
const getSetName = (p) => (p?.match(/(.*?) (Prime|Vandal|Wraith)/) || [])[0]?.trim() || "Otros";

const deps = (primeInventory, prices = {}) => ({
  setsDatabase: SETS,
  primeInventory,
  getSetName,
  getRequiredCount: () => 1,
  getPrice: (n) => prices[n] || 0,
});

test("una pieza por debajo del suelo de venta no vale su precio: no se vende", () => {
  assert.equal(saleValue(2), 0);
  assert.ok(saleValue(5) < 5, "en la rampa vale menos de lo que marca");
  assert.equal(saleValue(20), 20, "por encima del tramo vale lo que marca");
});

test("saleValue no invierte el orden de dos precios", () => {
  assert.ok(saleValue(4) < saleValue(6));
  assert.ok(saleValue(6) < saleValue(9));
});

// El caso de la captura: Strun Prime Receiver (7p, repetida) contra el plano que CIERRA
// Akbronco. Cerrar un set cuya prima es de 3p no compensa 7p de venta directa.
test("cerrar un set barato pierde contra una pieza cara suelta", () => {
  const prices = {
    "Akbronco Prime Set": 15, "Akbronco Prime Link": 12, "Akbronco Prime Blueprint": 2,
    "Strun Prime Receiver": 7,
  };
  const d = deps({ "Akbronco Prime Link": 1, "Strun Prime Receiver": 3 }, prices);
  const best = pickBestReward([
    { name: "Akbronco Prime Blueprint", price: 2, ducats: 15 },
    { name: "Strun Prime Receiver", price: 7, ducats: 15 },
  ], d);
  assert.equal(best.name, "Strun Prime Receiver");
});

// Y al revés, que es lo que hace falta que la etiqueta sepa distinguir: el mismo set con la
// otra pieza invendible suelta vale ENTERO al cerrarlo, porque no hay otra forma de cobrarlo.
test("cerrar un set cuyas piezas no se venden sueltas vale el set entero", () => {
  const prices = {
    "Akbronco Prime Set": 15, "Akbronco Prime Link": 2, "Akbronco Prime Blueprint": 2,
    "Strun Prime Receiver": 7,
  };
  const d = deps({ "Akbronco Prime Link": 1, "Strun Prime Receiver": 3 }, prices);
  const v = rewardValue({ name: "Akbronco Prime Blueprint", price: 2, ducats: 15 }, d);
  assert.equal(v.premium, 15);
  assert.equal(v.route, "set");
  const best = pickBestReward([
    { name: "Akbronco Prime Blueprint", price: 2, ducats: 15 },
    { name: "Strun Prime Receiver", price: 7, ducats: 15 },
  ], d);
  assert.equal(best.name, "Akbronco Prime Blueprint");
});

test("una pieza que ya tienes no cobra prima de set: solo vale venderla o fundirla", () => {
  // Precios completos a propósito: que el 0 de prima venga de tener la pieza, no de faltar datos.
  const prices = { "Yareli Prime Set": 200, "Yareli Prime Blueprint": 3, "Yareli Prime Neuroptics": 20, "Yareli Prime Chassis": 20, "Yareli Prime Systems": 20 };
  const inv = Object.fromEntries(SETS["Yareli Prime"].map((p) => [p, 1]));
  const v = rewardValue({ name: "Yareli Prime Blueprint", price: 3, ducats: 45 }, deps(inv, prices));
  assert.equal(v.setGain, 0);
  assert.equal(v.route, "ducats", "3p no se venden; 45 ducados sí valen algo");
  assert.equal(v.plat, 45 / DUCATS_PER_PLAT);
});

// Sin esto, "te acerca" valdría lo mismo que "cierra": la prima solo se cobra entera cuando
// la pieza es la última que falta.
test("acercar a un set vale menos que cerrarlo", () => {
  const prices = { "Yareli Prime Set": 200, "Yareli Prime Blueprint": 3, "Yareli Prime Neuroptics": 20, "Yareli Prime Chassis": 20, "Yareli Prime Systems": 20 };
  const cierra = Object.fromEntries(SETS["Yareli Prime"].slice(1).map((p) => [p, 1]));
  const lejos = { "Yareli Prime Neuroptics": 1 };
  const vCierra = rewardValue({ name: "Yareli Prime Blueprint", price: 3 }, deps(cierra, prices));
  const vLejos = rewardValue({ name: "Yareli Prime Blueprint", price: 3 }, deps(lejos, prices));
  assert.equal(vCierra.left, 0);
  assert.equal(vLejos.left, 2);
  assert.ok(vLejos.setGain < vCierra.setGain / 4);
});

// Los precios llegan en lote y la valoración se pinta con lo que haya. Sin esta guarda, una
// pieza cuyo precio aún no ha llegado cuenta como 0 y el set entero parece beneficio: la
// tarjeta se corona sola por no tener el dato. Y estimar las que faltan con la media de las
// conocidas hacía que la MISMA pantalla dijera "ganas 8", "9" u "11" según qué precios
// hubieran llegado al vencer el plazo: sin el set completo, no hay prima.
test("sin el precio del set y de TODAS sus piezas no se cobra prima", () => {
  const inv = { "Yareli Prime Neuroptics": 1, "Yareli Prime Chassis": 1, "Yareli Prime Systems": 1 };
  const pieza = { name: "Yareli Prime Blueprint", price: 3 };
  assert.equal(rewardValue(pieza, deps(inv, { "Yareli Prime Set": 200 })).premium, 0, "sin piezas");
  assert.equal(rewardValue(pieza, deps(inv, { "Yareli Prime Set": 200, "Yareli Prime Neuroptics": 30 })).premium, 0, "con una sola pieza");
  const todas = { "Yareli Prime Neuroptics": 30, "Yareli Prime Chassis": 30, "Yareli Prime Systems": 30, "Yareli Prime Blueprint": 10 };
  assert.equal(rewardValue(pieza, deps(inv, todas)).premium, 0, "sin el precio del set");
  assert.equal(rewardValue(pieza, deps(inv, { ...todas, "Yareli Prime Set": 200 })).premium, 200 - 3 * 30 - 10, "completo: set menos piezas sueltas");
});

test("Forma y compañía valen 0 y no coronan a nadie", () => {
  const v = rewardValue({ name: "Forma Blueprint", price: 0, ducats: 0 }, deps({}));
  assert.equal(v.plat, 0);
  assert.equal(v.route, "none");
  assert.equal(pickBestReward([{ name: "Forma Blueprint", price: 0, ducats: 0 }], deps({})), null);
});

test("2 X Forma sigue siendo 0, pero la cantidad multiplica lo que sí vale", () => {
  const v = rewardValue({ name: "Strun Prime Receiver", price: 10, ducats: 15, qty: 2 }, deps({ "Strun Prime Receiver": 3 }));
  assert.equal(v.sale, 20);
});

// Los precios llegan por red y la pantalla dura 15 segundos: sin ellos hay que seguir dando
// una respuesta, no un cero.
test("sin precios de set degrada a 'la más cara', que es lo que hacía el modal", () => {
  const d = deps({ "Yareli Prime Blueprint": 0 });
  const best = pickBestReward([
    { name: "Yareli Prime Blueprint", price: 9, ducats: 45 },
    { name: "Strun Prime Receiver", price: 20, ducats: 15 },
  ], d);
  assert.equal(best.name, "Strun Prime Receiver");
});

test("dos recompensas casi iguales no coronan a nadie de verdad", () => {
  const d = deps({});
  const items = [
    { name: "Strun Prime Receiver", price: 20, ducats: 0 },
    { name: "Strun Prime Barrel", price: 21, ducats: 0 },
  ];
  assert.equal(pickBestReward(items, d).clear, false);
  const holgado = pickBestReward([items[0], { name: "Strun Prime Barrel", price: 45, ducats: 0 }], d);
  assert.equal(holgado.clear, true);
});

test("rankRewards devuelve la lista entera ordenada, no solo la mejor", () => {
  const orden = rankRewards([
    { name: "Strun Prime Receiver", price: 7, ducats: 15 },
    { name: "Yareli Prime Blueprint", price: 30, ducats: 45 },
    { name: "Forma Blueprint", price: 0, ducats: 0 },
  ], deps({}));
  assert.deepEqual(orden.map((r) => r.name),
    ["Yareli Prime Blueprint", "Strun Prime Receiver", "Forma Blueprint"]);
});

// El Ducanator decidía "fundir" por un umbral de platino (todo lo de ≤15p a Baro) sin mirar
// los ducados, y esta pantalla por 10 ducados = 1 plat: una pieza de 12p con 45 ducados salía
// "fundir" en una pestaña y "vender" en la otra. Ahora las dos preguntan aquí.
test("fundir gana a vender solo cuando los ducados en platino superan la venta realizable", () => {
  assert.equal(ducatsBeatSale(45, 12), false, "4,5p de ducados contra 12p de venta");
  assert.equal(ducatsBeatSale(100, 9), true, "10p de ducados contra 9p de venta");
  // Por debajo del suelo la pieza no se vende, así que cualquier ducado gana.
  assert.equal(ducatsBeatSale(15, 2), true);
  // Sin ducados no hay nada que fundir.
  assert.equal(ducatsBeatSale(0, 2), false);
});

test("la regla del Ducanator es la misma que la ruta 'ducats' de rewardValue", () => {
  for (const [ducats, price] of [[45, 12], [100, 9], [15, 2], [65, 5], [25, 8]]) {
    const v = rewardValue({ name: "Strun Prime Receiver", price, ducats }, deps({}));
    assert.equal(ducatsBeatSale(ducats, price), v.route === "ducats", `${ducats} ducados a ${price}p`);
  }
});

// Captura real: Burston Prime Receiver (4p, 15d) y Orthos Prime Blueprint (4p, 45d) salían
// las dos con "MÁS PLATINO", y la etiqueta no decidía nada.
test("a igual platino desempatan los ducados, y al revés", () => {
  const items = [
    { name: "Burston Prime Receiver", price: 4, ducats: 15 },
    { name: "Orthos Prime Blueprint", price: 4, ducats: 45 },
    { name: "Caliban Prime Chassis Blueprint", price: 2, ducats: 15 },
  ];
  const m = mejoresPorMoneda(items);
  assert.deepEqual([...m.plat], ["Orthos Prime Blueprint"]);
  assert.deepEqual([...m.ducats], ["Orthos Prime Blueprint"]);

  const empateDucados = mejoresPorMoneda([
    { name: "A", price: 9, ducats: 45 }, { name: "B", price: 3, ducats: 45 },
  ]);
  assert.deepEqual([...empateDucados.ducats], ["A"], "a 45 ducados iguales gana la que además vale más");
  assert.deepEqual([...empateDucados.plat], ["A"]);

  // Piezas idénticas (la misma dos veces en la banda) sí empatan del todo.
  const iguales = mejoresPorMoneda([{ name: "A", price: 4, ducats: 15 }, { name: "A", price: 4, ducats: 15 }]);
  assert.deepEqual([...iguales.plat], ["A"]);
  // Sin precio no hay ganadora de platino; sin ducados, ninguna de ducados.
  assert.equal(mejoresPorMoneda([{ name: "Forma Blueprint", price: 0, ducats: 0 }]).plat.size, 0);
  assert.equal(mejoresPorMoneda([]).ducats.size, 0);
});
