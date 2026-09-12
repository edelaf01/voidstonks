// which of the four rewards yields the most platinum
// earlier tags pointed to different cards without declaring a winner: "completes set" fired equally on
// Akbronco (~0 premium) as on a 200p set, and mistakes fail silently with the user taking the worse part

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saleValue, rewardValue, pickBestReward, rankRewards, DUCATS_PER_PLAT, ducatsBeatSale,
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

// real capture: Strun Prime Receiver (7p, duplicate) against the blueprint that CLOSES Akbronco; closing a
// set with a 3p premium does not beat 7p direct sale
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

// the reverse, which the tag must tell apart: the same set with its other part unsellable loose is worth
// the ENTIRE set when closed, having no other way to cash out
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
  const prices = { "Yareli Prime Set": 200, "Yareli Prime Blueprint": 3 };
  const inv = Object.fromEntries(SETS["Yareli Prime"].map((p) => [p, 1]));
  const v = rewardValue({ name: "Yareli Prime Blueprint", price: 3, ducats: 45 }, deps(inv, prices));
  assert.equal(v.setGain, 0);
  assert.equal(v.route, "ducats", "3p no se venden; 45 ducados sí valen algo");
  assert.equal(v.plat, 45 / DUCATS_PER_PLAT);
});

// without this, "nears set" would equal "completes set": the full premium only applies when the part is
// the last one missing
test("acercar a un set vale menos que cerrarlo", () => {
  const prices = { "Yareli Prime Set": 200, "Yareli Prime Neuroptics": 20 };
  const cierra = Object.fromEntries(SETS["Yareli Prime"].slice(1).map((p) => [p, 1]));
  const lejos = { "Yareli Prime Neuroptics": 1 };
  const vCierra = rewardValue({ name: "Yareli Prime Blueprint", price: 3 }, deps(cierra, prices));
  const vLejos = rewardValue({ name: "Yareli Prime Blueprint", price: 3 }, deps(lejos, prices));
  assert.equal(vCierra.left, 0);
  assert.equal(vLejos.left, 2);
  assert.ok(vLejos.setGain < vCierra.setGain / 4);
});

test("una pieza sin precio no infla la prima del set", () => {
  const inv = { "Yareli Prime Neuroptics": 1, "Yareli Prime Chassis": 1, "Yareli Prime Systems": 1 };
  const sinNada = rewardValue({ name: "Yareli Prime Blueprint", price: 3 },
    deps(inv, { "Yareli Prime Set": 200 }));
  assert.equal(sinNada.premium, 0, "sin ningún precio de pieza no se cobra prima");

  const conUna = rewardValue({ name: "Yareli Prime Blueprint", price: 3 },
    deps(inv, { "Yareli Prime Set": 200, "Yareli Prime Neuroptics": 30 }));
  assert.ok(conUna.premium > 0 && conUna.premium < 200 - 3 * 30);
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

// prices arrive over network and the screen lasts 15 seconds: without them it must still give an answer,
// not zero
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

// ducanator decided "melt" by a platinum threshold (anything <=15p to Baro) without checking ducats, and
// this screen by 10 ducats = 1 plat: a 12p part with 45 ducats showed "melt" on one tab and "sell" on the
// other; now both ask here
test("fundir gana a vender solo cuando los ducados en platino superan la venta realizable", () => {
  assert.equal(ducatsBeatSale(45, 12), false, "4,5p de ducados contra 12p de venta");
  assert.equal(ducatsBeatSale(100, 9), true, "10p de ducados contra 9p de venta");
  // below the floor the part does not sell, so any ducats win
  assert.equal(ducatsBeatSale(15, 2), true);
  // with no ducats there is nothing to melt
  assert.equal(ducatsBeatSale(0, 2), false);
});

test("la regla del Ducanator es la misma que la ruta 'ducats' de rewardValue", () => {
  for (const [ducats, price] of [[45, 12], [100, 9], [15, 2], [65, 5], [25, 8]]) {
    const v = rewardValue({ name: "Strun Prime Receiver", price, ducats }, deps({}));
    assert.equal(ducatsBeatSale(ducats, price), v.route === "ducats", `${ducats} ducados a ${price}p`);
  }
});
