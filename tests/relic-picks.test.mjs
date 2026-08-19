// "Qué reliquia de las mías abro ahora".
//
// Es la vista inversa de buildFarmRoutes: aquella va set→reliquia y esta reliquia→qué me daría.
// Lo que decide es cuántas de las 6 recompensas son piezas que TE FALTAN: con una sola útil
// dependes de que caiga justo esa; con tres, casi cualquier resultado sirve.
//
// El fallo de esto es mudo: la lista sale igual de llena, solo que recomendando la reliquia
// equivocada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankRelicPicks, tierOfRelic } from "../deploy/js/utils/inventory/relic_picks.js";

const RAD = { rare: 0.1, uncommon: 0.4, common: 0.5 };
const SETS = {
  "Gara Prime": ["Gara Prime Blueprint", "Gara Prime Neuroptics", "Gara Prime Chassis"],
  "Nidus Prime": ["Nidus Prime Blueprint", "Nidus Prime Neuroptics"],
};
const getSetName = (p) => (p.match(/(.*?) (Prime|Vandal|Wraith)/) || [])[0]?.trim() || "Otros";

const relicsDatabase = {
  // Tres recompensas útiles si no tienes nada de Gara.
  "Lith TRIPLE": SETS["Gara Prime"].map((name) => ({ name, chance: 25.33 })),
  // Una sola útil.
  "Meso UNA": [{ name: "Nidus Prime Blueprint", chance: 25.33 }, { name: "Forma Blueprint", chance: 25.33 }],
  // Ninguna: no debe salir.
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

test("manda cuántas recompensas te sirven, no cuántas copias tienes", () => {
  // 1 copia de la triple contra 12 de la que solo aporta una: gana la triple.
  const r = rankRelicPicks({ ...base(), relicCounts: { "Lith TRIPLE": 1, "Meso UNA": 12 } });
  assert.equal(r[0].relic, "Lith TRIPLE");
  assert.equal(r[0].useful, 3);
  assert.equal(r[1].useful, 1);
});

test("una reliquia sin nada que te falte no se recomienda", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Neo NADA": 5 } });
  assert.deepEqual(r, [], "Forma no acerca ningún set");
});

test("las piezas que ya tienes dejan de contar como útiles", () => {
  const inv = { "Gara Prime Blueprint": 1, "Gara Prime Neuroptics": 1 };
  const r = rankRelicPicks({ ...base(inv), relicCounts: { "Lith TRIPLE": 1 } });
  assert.equal(r[0].useful, 1, "solo queda el chassis");
  assert.deepEqual(r[0].parts, ["Gara Prime Chassis"]);
});

// Mismo criterio que el panel de rutas: una reliquia perfecta de una era sin fisura viva no es
// una recomendación, es un recordatorio.
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

test("los sets no se repiten aunque la reliquia dé dos piezas del mismo", () => {
  const r = rankRelicPicks({ ...base(), relicCounts: { "Lith TRIPLE": 1 } });
  assert.deepEqual(r[0].sets, ["Gara Prime"]);
  assert.equal(r[0].parts.length, 3);
});

test("las copias desempatan por probabilidad real", () => {
  const una = rankRelicPicks({ ...base(), relicCounts: { "Meso UNA": 1 } })[0];
  const doce = rankRelicPicks({ ...base(), relicCounts: { "Meso UNA": 12 } })[0];
  assert.ok(doce.odds > una.odds, `12 copias deben dar más odds: ${doce.odds} vs ${una.odds}`);
  assert.equal(una.runs, doce.runs, "las runs son por apertura, no cambian con el stock");
});

// La vista "por reliquia" se quedaba en "cuántas te sirven": sabía QUÉ abrir pero no a dónde ir
// ni cuánto cuesta, que es la mitad del plan que sí da la vista por set.
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

// De una apertura sale UNA recompensa: sumar el precio de las piezas que te faltan prometería
// llevarte las tres.
test("el valor es la MEDIA de lo que te falta, no la suma", () => {
  const precios = { "Gara Prime Blueprint": 30, "Gara Prime Neuroptics": 60, "Gara Prime Chassis": 90 };
  const r = rankRelicPicks({
    ...base({}, [fisura("Lith")]), relicCounts: { "Lith TRIPLE": 1 },
    getPrice: (n) => precios[n] || 0,
  })[0];
  assert.equal(r.value, 60);
});

test("sin precios la pick sale sin valorar, no a cero", () => {
  const r = rankRelicPicks({ ...base({}, [fisura("Lith")]), relicCounts: { "Lith TRIPLE": 1 } })[0];
  assert.equal(r.value, null);
});

// La vista "por reliquia" se pintaba sin un solo filtro mientras la de rutas tenía nueve, así
// que con 60 reliquias en el inventario no había forma de llegar a una concreta.
test("los filtros de la vista por reliquia", async () => {
    const { filterRelicPicks } = await import("../deploy/js/utils/inventory/relic_picks.js");
    const picks = [
        { relic: "Axi S16", tier: "Axi", useful: 3, odds: 0.4, runs: 3, value: 20, minutes: 30, ready: true, sets: ["Saryn Prime"], parts: ["Saryn Prime Chassis"] },
        { relic: "Meso B9", tier: "Meso", useful: 1, odds: 0.9, runs: 1, value: 60, minutes: 10, ready: true, sets: ["Nyx Prime"], parts: ["Nyx Prime Blueprint"] },
        { relic: "Neo V10", tier: "Neo", useful: 2, odds: 0.2, runs: 9, value: null, minutes: null, ready: false, sets: ["Vasto Prime"], parts: ["Vasto Prime Barrel"] },
    ];
    const nombres = (o) => filterRelicPicks(picks, o).map((p) => p.relic);

    assert.deepEqual(nombres({ era: "Axi" }), ["Axi S16"]);
    // Una sola caja para las tres formas naturales de buscar aquí.
    assert.deepEqual(nombres({ query: "axi" }), ["Axi S16"], "por reliquia");
    assert.deepEqual(nombres({ query: "saryn" }), ["Axi S16"], "por set");
    assert.deepEqual(nombres({ query: "chassis" }), ["Axi S16"], "por pieza");
    assert.deepEqual(nombres({ readyOnly: true }), ["Axi S16", "Meso B9"]);

    // Lo que se pueda abrir YA manda sobre cualquier orden: una reliquia inmejorable de una era
    // sin fisura viva no es una recomendación. Por eso Neo V10 queda última aun sin filtrar.
    assert.deepEqual(nombres({ sortBy: "value" }), ["Meso B9", "Axi S16", "Neo V10"]);
    assert.deepEqual(nombres({ sortBy: "minutes" }), ["Meso B9", "Axi S16", "Neo V10"]);
    assert.deepEqual(nombres({ sortBy: "useful" }), ["Axi S16", "Meso B9", "Neo V10"]);

    // Sin valorar / sin minutos van al fondo de su orden en vez de empatar con un 0 inventado.
    const sinDatos = filterRelicPicks(
        [{ ...picks[2], ready: true }, picks[1]], { sortBy: "value" });
    assert.deepEqual(sinDatos.map((p) => p.relic), ["Meso B9", "Neo V10"]);
});
