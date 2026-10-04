import { test } from "node:test";
import assert from "node:assert/strict";
import { eligeReliquias, escasez, fuentesDePiezas, porVestigio, refinoQueCompensa } from "../deploy/js/utils/inventory/relic_objetivos.js";

const TABLAS = {
  Intact: { rare: 0.02, uncommon: 0.22, common: 0.76 },
  Exceptional: { rare: 0.04, uncommon: 0.26, common: 0.7 },
  Flawless: { rare: 0.06, uncommon: 0.34, common: 0.6 },
  Rad: { rare: 0.1, uncommon: 0.4, common: 0.5 },
};

const relicsDatabase = {
  "Lith A8": [
    { name: "Akarius Prime Receiver", chance: 2 }, { name: "Daikyu Prime Lower Limb", chance: 11 },
    { name: "Masseter Prime Blueprint", chance: 11 }, { name: "Bronco Prime Receiver", chance: 25.33 },
    { name: "Braton Prime Barrel", chance: 25.33 }, { name: "Akbronco Prime Blueprint", chance: 25.33 },
  ],
  "Lith A12": [
    { name: "Alternox Prime Blueprint", chance: 2 }, { name: "Daikyu Prime Lower Limb", chance: 11 },
    { name: "Xaku Prime Systems Blueprint", chance: 11 }, { name: "Forma Blueprint", chance: 25.33 },
    { name: "Burston Prime Receiver", chance: 25.33 }, { name: "Akbronco Prime Blueprint", chance: 25.33 },
  ],
  "Lith B11": [
    { name: "Baruuk Prime Blueprint", chance: 2 }, { name: "Braton Prime Blueprint", chance: 11 },
    { name: "Harrow Prime Blueprint", chance: 11 }, { name: "Akbronco Prime Blueprint", chance: 25.33 },
    { name: "Knell Prime Blueprint", chance: 25.33 }, { name: "Lex Prime Blueprint", chance: 25.33 },
  ],
  "Lith K9": [
    { name: "Khora Prime Blueprint", chance: 2 }, { name: "Guandao Prime Blueprint", chance: 11 },
    { name: "Astilla Prime Stock", chance: 11 }, { name: "Braton Prime Barrel", chance: 25.33 },
    { name: "Forma Blueprint", chance: 25.33 }, { name: "Akbronco Prime Blueprint", chance: 25.33 },
  ],
};

const setsDatabase = {
  "Akarius Prime": ["Akarius Prime Blueprint", "Akarius Prime Barrel", "Akarius Prime Receiver"],
  "Akbronco Prime": ["Akbronco Prime Blueprint", "Akbronco Prime Link"],
  "Bronco Prime": ["Bronco Prime Blueprint", "Bronco Prime Barrel", "Bronco Prime Receiver"],
  "Braton Prime": ["Braton Prime Blueprint", "Braton Prime Barrel", "Braton Prime Receiver", "Braton Prime Stock"],
};

const PRECIOS = { "Akarius Prime Receiver": 30, "Khora Prime Blueprint": 25, "Baruuk Prime Blueprint": 10, "Braton Prime Barrel": 2 };

const deps = (extra = {}) => ({
  relicsDatabase, setsDatabase, tablas: TABLAS, squadSize: 4,
  relicCounts: { "Lith A8": 5, "Lith A12": 54, "Lith B11": 63, "Lith K9": 23 },
  primeInventory: { "Akarius Prime Blueprint": 1, "Akarius Prime Barrel": 1, "Akbronco Prime Link": 1 },
  getSetName: (p) => (p.match(/^(.*? Prime)/) || [])[1] || null,
  getRequiredCount: () => 1,
  getPrice: (n) => PRECIOS[n] || 0,
  getDucats: (n) => (n === "Forma Blueprint" ? 0 : n.includes("Akarius") || n.includes("Khora") || n.includes("Baruuk") || n.includes("Alternox") ? 100 : 15),
  ...extra,
});

test("una pieza que tus otras reliquias dan igual de fácil apenas pesa al elegir el refino", () => {
  const fuentes = fuentesDePiezas(deps().relicCounts, relicsDatabase);
  assert.equal(escasez("Akarius Prime Receiver", "Lith A8", 2, fuentes), 1);
  assert.equal(escasez("Akbronco Prime Blueprint", "Lith A8", 25.33, fuentes), 1 / (1 + 54 + 63 + 23));
});

test("con cualquier refino, Lith A8 va en radiante por el receptor de Akarius aunque también cierre Akbronco", () => {
  const a8 = eligeReliquias(deps()).find((p) => p.relic === "Lith A8");
  assert.equal(a8.refino, "Rad");
  assert.deepEqual(a8.closes.sort(), ["Akarius Prime", "Akbronco Prime"]);
});

test("con intacta elegida, Lith A8 no sale primera: abrirla así tira el receptor de Akarius", () => {
  const intactas = eligeReliquias(deps(), { refino: "Intact" });
  assert.ok(intactas.every((p) => p.refino === "Intact"));
  const encaja = (p) => (p.refino === p.mejorRefino ? 1 : 0);
  assert.ok(intactas.slice(1).every((p, i) => encaja(p) < encaja(intactas[i]) || (encaja(p) === encaja(intactas[i]) && p.puntos <= intactas[i].puntos)), "primero las que rinden en intacta");
  const a8 = intactas.find((p) => p.relic === "Lith A8");
  assert.notEqual(intactas[0].relic, "Lith A8");
  assert.equal(a8.mejorRefino, "Rad");
  assert.equal(a8.clave.name, "Akarius Prime Receiver");
  assert.ok(Math.abs(a8.clave.chance - (1 - 0.98 ** 4)) < 1e-9, "la probabilidad es la de ESA pieza, no la de cualquiera");
  assert.equal(a8.clave.price, 30);
  assert.equal(intactas[0].clave.name, "Akbronco Prime Blueprint");
  assert.equal(intactas.at(-1).relic, "Lith A8", "la de la rara va detrás de todas las que sí van bien en intacta");
  assert.deepEqual({ ...a8.ganancia, chance: +a8.ganancia.chance.toFixed(4) }, { refino: "Rad", pieza: "Akarius Prime Receiver", set: "Akarius Prime", chance: +(1 - 0.9 ** 4).toFixed(4) });
  assert.equal(intactas.find((p) => p.relic === "Lith K9").ganancia, null);
  assert.ok(eligeReliquias(deps(), { refino: "Rad" }).every((p) => p.refino === "Rad"));
});

test("objetivo platino: valor esperado de la apertura con todo lo que suelta, no solo lo que falta", () => {
  const plat = eligeReliquias(deps({ primeInventory: {} }), { objetivo: "plat", refino: "Rad" });
  assert.deepEqual(plat.map((p) => p.relic), ["Lith A8", "Lith K9", "Lith B11"]);
  assert.deepEqual(plat[0].mejor, { name: "Akarius Prime Receiver", valor: 30, chance: 1 - 0.9 ** 4 });
  assert.ok(plat.every((p) => p.ev > 0 && p.refino === "Rad"));
  const cualquiera = eligeReliquias(deps(), { objetivo: "plat" });
  assert.equal(cualquiera.find((p) => p.relic === "Lith A8").refino, "Rad");
  const enIntacta = eligeReliquias(deps({ primeInventory: {} }), { objetivo: "plat", refino: "Intact" }).find((p) => p.relic === "Lith A8");
  assert.deepEqual({ ...enIntacta.ganancia, chance: +enIntacta.ganancia.chance.toFixed(4) }, { refino: "Rad", pieza: "Akarius Prime Receiver", chance: +(1 - 0.9 ** 4).toFixed(4) });
});

test("objetivo ducados y filtro de era", () => {
  const duc = eligeReliquias(deps(), { objetivo: "ducados", refino: "Intact" });
  assert.equal(duc.length, 4);
  assert.ok(duc.slice(1).every((p, i) => p.ev <= duc[i].ev));
  assert.deepEqual(eligeReliquias(deps(), { era: "Meso" }), []);
  assert.equal(eligeReliquias(deps(), { era: "Lith" }).length > 0, true);
});

test("platino por vestigio: se refina donde cada vestigio rinde por encima de lo normal en tus reliquias", () => {
  const evs = { Intact: 4, Exceptional: 5, Flawless: 6.5, Rad: 14 };
  const v = porVestigio(evs);
  assert.deepEqual(v.por, { Exceptional: 1 / 25, Flawless: 2.5 / 50, Rad: 10 / 100 });
  assert.equal(v.valor, 0.1);
  assert.equal(refinoQueCompensa(evs, v, 0.05), "Rad", "de las que compensan, la que más da");
  assert.equal(refinoQueCompensa(evs, v, 0.2), "Intact", "si refinarla rinde menos que en tus otras reliquias, intacta");
});

test("con intacta en platino salen primero las que no merece la pena refinar: las de las runs de vestigios", () => {
  const lista = eligeReliquias(deps({ primeInventory: {} }), { objetivo: "plat", refino: "Intact" });
  const primero = lista.findIndex((p) => p.mejorRefino !== "Intact");
  assert.ok(primero === -1 || lista.slice(primero).every((p) => p.mejorRefino !== "Intact"), "las que piden refinar van detrás");
  const a8 = lista.find((p) => p.relic === "Lith A8");
  assert.equal(a8.mejorRefino, "Rad");
  assert.ok(a8.porVestigio > 0);
  assert.ok(lista.filter((p) => p.mejorRefino === "Intact").every((p) => p.porVestigio <= a8.porVestigio));
});
