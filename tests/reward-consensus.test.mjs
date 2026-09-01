import { test } from "node:test";
import assert from "node:assert/strict";
import {
    nextConsensus,
    getWinningQty,
    getItemConsensus,
    INITIAL_CONSENSUS,
} from "../deploy/js/utils/inventory/reward_consensus.js";

const pieza = (name, qty = 1, weight) => (weight !== undefined ? { name, qty, weight } : { name, qty });

test("dos frames seguidos con el mismo ítem lo confirman (equivalente a la regla de hoy)", () => {
    // Frame 1: score = 0 * 0.75 + 1 = 1.0 (< 1.5) -> no confirma
    const r1 = nextConsensus(INITIAL_CONSENSUS, [pieza("Lex Prime Barrel", 1)]);
    assert.deepEqual(r1.confirmed, []);
    assert.equal(r1.commit, null);
    assert.equal(r1.state.items["Lex Prime Barrel"].score, 1.0);
    assert.equal(r1.state.items["Lex Prime Barrel"].confirmed, false);

    // Frame 2: score = 1.0 * 0.75 + 1 = 1.75 (>= 1.5) -> confirma exactamente en 2 frames
    const r2 = nextConsensus(r1.state, [pieza("Lex Prime Barrel", 1)]);
    assert.deepEqual(r2.confirmed, [{ name: "Lex Prime Barrel", qty: 1 }]);
    assert.deepEqual(r2.commit, [{ name: "Lex Prime Barrel", qty: 1 }]);
    assert.equal(r2.state.items["Lex Prime Barrel"].score, 1.75);
    assert.equal(r2.state.items["Lex Prime Barrel"].confirmed, true);
});

test("un frame ruidoso en medio de dos buenos no impide la confirmación", () => {
    // Frame 1 (bueno): score = 1.0
    const r1 = nextConsensus(INITIAL_CONSENSUS, [pieza("Paris Prime String", 1)]);
    assert.deepEqual(r1.confirmed, []);
    assert.equal(r1.state.items["Paris Prime String"].score, 1.0);

    // Frame 2 (ruidoso/vacío): decaimiento a 1.0 * 0.75 = 0.75
    const r2 = nextConsensus(r1.state, []);
    assert.deepEqual(r2.confirmed, []);
    assert.equal(r2.state.items["Paris Prime String"].score, 0.75);
    assert.equal(r2.state.items["Paris Prime String"].confirmed, false);

    // Frame 3 (bueno): score = 0.75 * 0.75 + 1.0 = 1.5625 (>= 1.5) -> confirma
    const r3 = nextConsensus(r2.state, [pieza("Paris Prime String", 1)]);
    assert.deepEqual(r3.confirmed, [{ name: "Paris Prime String", qty: 1 }]);
    assert.equal(r3.state.items["Paris Prime String"].score, 1.5625);
    assert.equal(r3.state.items["Paris Prime String"].confirmed, true);
});

test("un ítem visto una sola vez y luego nunca más no se confirma por muchos frames que pasen", () => {
    // Visto una sola vez
    let s = nextConsensus(INITIAL_CONSENSUS, [pieza("Braton Prime Stock", 1)]).state;
    assert.equal(s.items["Braton Prime Stock"].score, 1.0);

    // Pasan 30 frames vacíos
    for (let i = 0; i < 30; i++) {
        const r = nextConsensus(s, []);
        s = r.state;
        assert.deepEqual(r.confirmed, []);
        assert.equal(r.commit, null);
    }

    // El decaimiento tras 30 frames vacíos deja la puntuación prácticamente en 0 (0.75^30 ≈ 0.0001785)
    const scoreFinal = s.items["Braton Prime Stock"].score;
    assert.equal(s.items["Braton Prime Stock"].confirmed, false);
    assert.ok(scoreFinal < 0.001);
    assert.equal(scoreFinal, 1.0 * Math.pow(0.75, 30));
});

test("ver un ítem un frame de cada cinco durante veinte frames no lo confirma (el decaimiento se lo come)", () => {
    // 1 frame visto, 4 frames vacíos -> patrón repetido 4 veces (20 frames en total)
    let s = INITIAL_CONSENSUS;
    const confirmadosTotales = [];

    for (let frame = 0; frame < 20; frame++) {
        const items = frame % 5 === 0 ? [pieza("Orthos Prime Handle", 1)] : [];
        const r = nextConsensus(s, items);
        s = r.state;
        if (r.confirmed.length > 0) confirmadosTotales.push(...r.confirmed);
    }

    assert.equal(confirmadosTotales.length, 0);
    assert.equal(s.items["Orthos Prime Handle"].confirmed, false);
    // El pico máximo en este patrón oscila alrededor de ~1.307 y nunca supera 1.5
    assert.ok(s.items["Orthos Prime Handle"].score < 1.5);
});

test("con qty 1, 3, 3 para el mismo nombre gana 3", () => {
    // Frame 1: lee qty 1
    const r1 = nextConsensus(INITIAL_CONSENSUS, [pieza("Forma Blueprint", 1)]);
    assert.equal(r1.state.items["Forma Blueprint"].qty, 1);

    // Frame 2: lee qty 3
    const r2 = nextConsensus(r1.state, [pieza("Forma Blueprint", 3)]);

    // Frame 3: lee qty 3
    const r3 = nextConsensus(r2.state, [pieza("Forma Blueprint", 3)]);

    const item = r3.state.items["Forma Blueprint"];
    assert.equal(item.qty, 3);
    assert.equal(item.qtyVotes[3], 2);
    assert.equal(item.qtyVotes[1], 1);
});

test("un ítem ya confirmado no se vuelve a confirmar en frames posteriores", () => {
    const items = [pieza("Soma Prime Receiver", 1)];
    let s = INITIAL_CONSENSUS;
    let totalConfirmaciones = 0;

    for (let i = 0; i < 10; i++) {
        const r = nextConsensus(s, items);
        s = r.state;
        if (r.confirmed.length > 0) {
            totalConfirmaciones += r.confirmed.length;
            assert.deepEqual(r.confirmed, [{ name: "Soma Prime Receiver", qty: 1 }]);
        }
    }

    assert.equal(totalConfirmaciones, 1);
    assert.equal(s.items["Soma Prime Receiver"].confirmed, true);
});

test("la cantidad más votada gana aunque el último frame lea un valor erróneo (3, 3, 1)", () => {
    let s = nextConsensus(INITIAL_CONSENSUS, [pieza("Ducats", 3)]).state;
    s = nextConsensus(s, [pieza("Ducats", 3)]).state;
    s = nextConsensus(s, [pieza("Ducats", 1)]).state;

    assert.equal(s.items["Ducats"].qty, 3);
    assert.equal(s.items["Ducats"].qtyVotes[3], 2);
    assert.equal(s.items["Ducats"].qtyVotes[1], 1);
});

test("múltiples ítems en el mismo frame acumulan evidencia y confirman independientemente", () => {
    // Frame 1: dos ítems
    const r1 = nextConsensus(INITIAL_CONSENSUS, [
        pieza("ItemA", 1),
        pieza("ItemB", 2),
    ]);
    assert.deepEqual(r1.confirmed, []);

    // Frame 2: ItemA se lee bien, ItemB se pierde por ruido
    const r2 = nextConsensus(r1.state, [pieza("ItemA", 1)]);
    assert.deepEqual(r2.confirmed, [{ name: "ItemA", qty: 1 }]);
    assert.equal(r2.state.items["ItemA"].confirmed, true);
    assert.equal(r2.state.items["ItemB"].confirmed, false);
    assert.equal(r2.state.items["ItemB"].score, 0.75);

    // Frame 3: ambos ítems presentes de nuevo
    const r3 = nextConsensus(r2.state, [
        pieza("ItemA", 1),
        pieza("ItemB", 2),
    ]);
    // ItemA ya estaba confirmado (no repite), ItemB alcanza 0.75 * 0.75 + 1.0 = 1.5625 y confirma
    assert.deepEqual(r3.confirmed, [{ name: "ItemB", qty: 2 }]);
    assert.equal(r3.state.items["ItemB"].confirmed, true);
});

test("entradas con nombres vacíos, nulos o cantidades no numéricas se sanean", () => {
    const invalidItems = [
        null,
        undefined,
        { name: "" },
        { name: null },
        { name: 123 },
        { name: true },
        { name: "Pieza Valida", qty: -3 },
        { name: "Otra Pieza", qty: "4" },
        { name: "Pieza Sin Qty" },
        { name: "Pieza Qty NaN", qty: "no-numero" },
    ];
    const r = nextConsensus(null, invalidItems);

    assert.equal(Object.keys(r.state.items).length, 4);
    assert.equal(r.state.items["Pieza Valida"].qty, 1);
    assert.equal(r.state.items["Otra Pieza"].qty, 4);
    assert.equal(r.state.items["Pieza Sin Qty"].qty, 1);
    assert.equal(r.state.items["Pieza Qty NaN"].qty, 1);
});

test("admite pesos personalizados por ítem y opciones de umbral/decaimiento", () => {
    const customOptions = { decay: 0.5, threshold: 2.0, weight: 1.0 };
    // Frame 1: score = 0 * 0.5 + 1.0 = 1.0 (< 2.0)
    let r = nextConsensus(INITIAL_CONSENSUS, [pieza("Custom Item", 1)], customOptions);
    assert.equal(r.state.items["Custom Item"].score, 1.0);
    assert.deepEqual(r.confirmed, []);

    // Frame 2: score = 1.0 * 0.5 + 1.0 = 1.5 (< 2.0)
    r = nextConsensus(r.state, [pieza("Custom Item", 1)], customOptions);
    assert.equal(r.state.items["Custom Item"].score, 1.5);
    assert.deepEqual(r.confirmed, []);

    // Frame 3 con peso explícito 0.8: score = 1.5 * 0.5 + 0.8 = 1.55 (< 2.0)
    r = nextConsensus(r.state, [pieza("Custom Item", 1, 0.8)], customOptions);
    assert.equal(r.state.items["Custom Item"].score, 1.55);
    assert.deepEqual(r.confirmed, []);

    // Frame 4 con peso 1.5: score = 1.55 * 0.5 + 1.5 = 2.275 (>= 2.0) -> confirma
    r = nextConsensus(r.state, [pieza("Custom Item", 1, 1.5)], customOptions);
    assert.equal(r.state.items["Custom Item"].score, 2.275);
    assert.deepEqual(r.confirmed, [{ name: "Custom Item", qty: 1 }]);
});

test("getWinningQty resuelve mayorías, empates y fallback", () => {
    assert.equal(getWinningQty(null, 2), 2);
    assert.equal(getWinningQty("no-objeto", 5), 5);
    assert.equal(getWinningQty({}, 1), 1);
    assert.equal(getWinningQty({ 1: 1, 2: 3, 3: 2 }), 2);
    // En empate, prioriza el fallback si coincide
    assert.equal(getWinningQty({ 1: 2, 4: 2 }, 4), 4);
    assert.equal(getWinningQty({ 1: 2, 4: 2 }, 1), 1);
});

test("getItemConsensus devuelve la entrada o null si no existe", () => {
    const s = nextConsensus(INITIAL_CONSENSUS, [pieza("Fang Prime Blade", 2)]).state;
    assert.equal(getItemConsensus(null, "Fang Prime Blade"), null);
    assert.equal(getItemConsensus({}, "Fang Prime Blade"), null);
    assert.equal(getItemConsensus(s, ""), null);
    assert.equal(getItemConsensus(s, "Inexistente"), null);
    const item = getItemConsensus(s, "Fang Prime Blade");
    assert.equal(item.qty, 2);
    assert.equal(item.score, 1.0);
    assert.equal(item.confirmed, false);
});

test("nextConsensus es una función pura que no muta el estado anterior", () => {
    const s0 = INITIAL_CONSENSUS;
    const r1 = nextConsensus(s0, [pieza("Lex Prime Barrel", 1)]);
    assert.deepEqual(s0, INITIAL_CONSENSUS);

    const s1Copy = JSON.parse(JSON.stringify(r1.state));
    nextConsensus(r1.state, [pieza("Lex Prime Barrel", 1)]);
    assert.deepEqual(r1.state, s1Copy);
});
