import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedPlatPerCrack, rankRelicPicks, tierOfRelic } from "../deploy/js/utils/inventory/relic_picks.js";

const RAD = { rare: 0.1, uncommon: 0.4, common: 0.5 };
const SETS = {
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis"],
  "Nidus Prime": ["Nidus Prime Blueprint", "Nidus Prime Neuroptics"],
};
const getSetName = (p) => (p.match(/(.*?) (Prime|Vandal|Wraith)/) || [])[0]?.trim() || "Otros";

const relicsDatabase = {
  "Lith TRIPLE": SETS["Gara Prime"].map((name) => ({ name, chance: 25.33 })),
  "Meso UNA": [{ name: "Nidus Prime Blueprint", chance: 25.33 }, { name: "Forma Blueprint", chance: 25.33 }],
  "Neo NADA": [{ name: "Forma Blueprint", chance: 25.33 }],
};

const fisura = (tier) => ({ tier, node: "Ío (Júpiter)", type: "Capture", eta: "35m" });
const base = (primeInventory = {}, fissures = []) => ({
  relicsDatabase, setsDatabase: SETS, primeInventory, fissures,
  getSetName, getRequiredCount: () => 1, dropChances: RAD, squadSize: 4,
});

test("la era sale de la primera palabra, y Vanguard es Axi", () => {
  assert.equal(tierOfRelic("Lith G1"), "Lith");
  assert.equal(tierOfRelic("Vanguard A2"), "Axi");
  assert.equal(tierOfRelic(""), "");
});

test("no mandan las copias que tienes, sino lo que te acerca a cerrar un set", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Lith TRIPLE": 1, "Meso UNA": 12 } });
  assert.equal(r[0].relic, "Lith TRIPLE");
  assert.equal(r[0].useful, 3);
  assert.equal(r[1].useful, 1);
});

// 87 of 767 relics have all 6 rewards useful: alphabetical ties pushed set-closing relics down
test("la que CIERRA un set gana a la que trae más recompensas sueltas", () => {
  const inv = { "Nidus Prime Neuroptics": 1 };
  const r = rankRelicPicks({ ...base(inv), relicCounts: { "Lith TRIPLE": 1, "Meso UNA": 1 } });
  assert.equal(r[0].relic, "Meso UNA");
  assert.equal(r[0].useful, 1, "y aun así con menos recompensas útiles que la otra");
  assert.deepEqual(r[0].closes, ["Nidus Prime"]);
  assert.ok(r[0].closeOdds > 0.5, `probabilidad de cerrarlo en una apertura: ${r[0].closeOdds}`);
  assert.equal(r[1].relic, "Lith TRIPLE");
  assert.deepEqual(r[1].closes, [], "Gara sin empezar no se cierra con una pieza");
});

test("una reliquia sin nada que te falte no se recomienda", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Neo NADA": 5 } });
  assert.deepEqual(r, [], "Forma no acerca ningún set");
});

test("las piezas que ya tienes dejan de contar como útiles", () => {
  const inv = { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1 };
  const r = rankRelicPicks({ ...base(inv), relicCounts: { "Lith TRIPLE": 1 } });
  assert.equal(r[0].useful, 1, "solo queda el chassis");
  assert.deepEqual(r[0].parts.map((x) => x.name), ["Gara Prime Chassis"]);
});

test("con fisuras conocidas, primero lo que se puede abrir ya", () => {
  const r = rankRelicPicks({
    ...base({}, [fisura("Meso")]),
    relicCounts: { "Lith TRIPLE": 1, "Meso UNA": 1 },
  });
  assert.equal(r[0].relic, "Meso UNA", "aunque aporte menos, es la que puedes abrir");
  assert.equal(r[0].ready, true);
  assert.equal(r[1].ready, false);
});

test("sin datos de fisuras no se marca ninguna como lista", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Lith TRIPLE": 1 } });
  assert.equal(r[0].ready, false, "sin fisuras conocidas no se marca ninguna como lista");
});

test("cada pieza útil dice lo que le falta a SU set", () => {
  const inv = { "Gara Prime Blueprint": 1, "Nidus Prime Neuroptics": 1 };
  const r = rankRelicPicks({ ...base(inv), relicCounts: { "Lith TRIPLE": 1, "Meso UNA": 1 } });

  const gara = r.find((x) => x.relic === "Lith TRIPLE").parts;
  assert.deepEqual(gara.map((x) => [x.name, x.missing, x.total]), [
    ["Gara Prime Neuroptics", 2, 3],
    ["Gara Prime Chassis", 2, 3],
  ], "faltan dos de las tres, y esta es una de ellas");

  const nidus = r.find((x) => x.relic === "Meso UNA").parts;
  assert.deepEqual(nidus.map((x) => [x.set, x.missing]), [["Nidus Prime", 1]],
    "missing 1 es la última pieza: la fila la marca aparte");
});

test("los sets no se repiten aunque la reliquia dé dos piezas del mismo", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Lith TRIPLE": 1 } });
  assert.deepEqual(r[0].sets, ["Gara Prime"]);
  assert.equal(r[0].parts.length, 3);
});

test("la probabilidad es por apertura y no crece con las copias", () => {
  const una = rankRelicPicks({ ...base(), relicCounts: { "Meso UNA": 1 } })[0];
  const doce = rankRelicPicks({ ...base(), relicCounts: { "Meso UNA": 12 } })[0];
  assert.equal(Math.round(una.odds * 1000), Math.round((1 - (1 - 0.5 / 3) ** 4) * 1000));
  assert.equal(doce.odds, una.odds);
  assert.equal(una.runs, doce.runs, "las runs son por apertura, no cambian con el stock");
  const solo = rankRelicPicks({ ...base(), squadSize: 1, relicCounts: { "Meso UNA": 61 } })[0];
  assert.equal(Math.round(solo.odds * 1000), 167, "en solitario, la del roll");
});

test("con fisura abierta dice a qué misión ir y cuánto tarda", () => {
  const r = rankRelicPicks({ ...base({}, [fisura("Lith")]), relicCounts: { "Lith TRIPLE": 1 } })[0];
  assert.ok(r.fissure, "la fisura concreta, ya elegida por rapidez");
  assert.equal(r.fissure.node, "Ío (Júpiter)");
  assert.ok(r.minutes > 0, `minutos estimados: ${r.minutes}`);
});

test("sin fisura de su era no se inventa un plan", () => {
  const r = rankRelicPicks({ ...base({}, [fisura("Axi")]), relicCounts: { "Lith TRIPLE": 1 } })[0];
  assert.equal(r.ready, false);
  assert.equal(r.fissure, null);
  assert.equal(r.minutes, null, "sin misión no hay minutos que estimar");
});

test("el valor es el platino esperado por apertura, ponderado por probabilidad", () => {
  const precios = { "Gara Prime Blueprint": 30, "Gara Prime Neuroptics": 60, "Gara Prime Chassis": 90 };
  const getPrice = (n) => precios[n] || 0;
  const solo = rankRelicPicks({
    ...base({}, [fisura("Lith")]), squadSize: 1, relicCounts: { "Lith TRIPLE": 1 }, getPrice,
  })[0];
  assert.equal(solo.value, 30);
  // in a squad of 4 you keep best of 4: expectation of the maximum, not sum of chances
  const squad = rankRelicPicks({
    ...base({}, [fisura("Lith")]), relicCounts: { "Lith TRIPLE": 1 }, getPrice,
  })[0];
  const pAl = (k) => 1 - (1 - k / 6) ** 4;
  const esperado = 90 * pAl(1) + 60 * (pAl(2) - pAl(1)) + 30 * (pAl(3) - pAl(2));
  assert.equal(squad.value, Math.round(esperado * 10) / 10);
  assert.ok(squad.value < 90, `nunca promete más que la pieza más cara: ${squad.value}`);
});

test("expectedPlatPerCrack ignora piezas sin precio y devuelve null si no hay ninguna", () => {
  assert.equal(expectedPlatPerCrack([{ part: "x", single: 0.1, chance: 0.1 }], () => 0, 1), null);
  assert.equal(expectedPlatPerCrack([
    { part: "cara", single: 0.1, chance: 0.1 }, { part: "sin precio", single: 0.5, chance: 0.5 },
  ], (n) => (n === "cara" ? 35 : 0), 1), 3.5);
});

test("sin precios la pick sale sin valorar, no a cero", () => {
  const r = rankRelicPicks({ ...base({}, [fisura("Lith")]), relicCounts: { "Lith TRIPLE": 1 } })[0];
  assert.equal(r.value, null);
});

test("los filtros de la vista por reliquia", async () => {
    const { filterRelicPicks } = await import("../deploy/js/utils/inventory/relic_picks.js");
    const picks = [
        { relic: "Axi S16", tier: "Axi", useful: 3, progress: 0.17, closes: [], odds: 0.4, runs: 3, value: 20, minutes: 30, ready: true, sets: ["Saryn Prime"], parts: ["Saryn Prime Chassis"] },
        { relic: "Meso B9", tier: "Meso", useful: 1, progress: 0.52, closes: ["Nyx Prime"], odds: 0.9, runs: 1, value: 60, minutes: 10, ready: true, sets: ["Nyx Prime"], parts: ["Nyx Prime Blueprint"] },
        { relic: "Neo V10", tier: "Neo", useful: 2, progress: 0.06, closes: [], odds: 0.2, runs: 9, value: null, minutes: null, ready: false, sets: ["Vasto Prime"], parts: ["Vasto Prime Barrel"] },
    ];
    const nombres = (o) => filterRelicPicks(picks, o).map((p) => p.relic);

    assert.deepEqual(nombres({ era: "Axi" }), ["Axi S16"]);
    assert.deepEqual(nombres({ query: "axi" }), ["Axi S16"], "por reliquia");
    assert.deepEqual(nombres({ query: "saryn" }), ["Axi S16"], "por set");
    assert.deepEqual(nombres({ query: "chassis" }), ["Axi S16"], "por pieza");
    assert.deepEqual(nombres({ readyOnly: true }), ["Meso B9", "Axi S16"]);
    assert.deepEqual(nombres({ sortBy: "best" }), ["Meso B9", "Axi S16", "Neo V10"]);

    assert.deepEqual(nombres({ sortBy: "value" }), ["Meso B9", "Axi S16", "Neo V10"]);
    assert.deepEqual(nombres({ sortBy: "minutes" }), ["Meso B9", "Axi S16", "Neo V10"]);
    assert.deepEqual(nombres({ sortBy: "useful" }), ["Axi S16", "Meso B9", "Neo V10"]);

    const sinDatos = filterRelicPicks(
        [{ ...picks[2], ready: true }, picks[1]], { sortBy: "value" });
    assert.deepEqual(sinDatos.map((p) => p.relic), ["Meso B9", "Neo V10"]);
});
