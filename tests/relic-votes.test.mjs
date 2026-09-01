import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { voteReadings, applyRelicCounts, VOTES_TO_APPLY } from "../deploy/js/utils/inventory/relic_votes.js";

// what the scanner writes to inventory when reading the relic grid
// there is no safety net: writes overwrite the user's real counts with no backup
// sweeps simulated frame sequences without camera or OCR

const nuevoEstado = () => ({ votes: new Map(), applied: new Map() });
/** replays N frames in sequence and returns the resulting inventory */
function escanea(frames, inventarioInicial = []) {
    const estado = nuevoEstado();
    let inv = inventarioInicial;
    const escrituras = [];
    for (const lectura of frames) {
        const changed = voteReadings(estado, lectura);
        escrituras.push(changed.length);
        if (changed.length) inv = applyRelicCounts(inv, changed);
    }
    return { inv, escrituras };
}
const cuenta = (inv, nombre) => inv.find((i) => i.name === nombre)?.count;

describe("consenso de lecturas", () => {
    test("un frame suelto NO escribe: hacen falta dos iguales", () => {
        const { inv, escrituras } = escanea([[{ name: "Lith A1", count: 5 }]]);
        assert.deepEqual(inv, []);
        assert.deepEqual(escrituras, [0]);
        assert.equal(VOTES_TO_APPLY, 2);
    });

    test("dos frames iguales escriben UNA vez, y el tercero ya no repite", () => {
        const lectura = [[{ name: "Lith A1", count: 5 }]];
        const { inv, escrituras } = escanea([...lectura, ...lectura, ...lectura]);
        assert.equal(cuenta(inv, "Lith A1"), 5);
        assert.deepEqual(escrituras, [0, 1, 0]);
    });

    test("un frame malo entre dos buenos no rompe el consenso de los buenos", () => {
        const { inv } = escanea([
            [{ name: "Axi A5", count: 12 }],
            [{ name: "Axi A5", count: 99 }],   // blurry frame
            [{ name: "Axi A5", count: 12 }],
        ]);
        assert.equal(cuenta(inv, "Axi A5"), 12, "debe ganar el número que se repite");
    });

    test("un número leído mal DOS veces sí entra: el consenso no adivina", () => {
        // documents the real limit: two identical readings cannot be distinguished from good ones; increasing
        // VOTES_TO_APPLY is the only lever and costs latency
        const { inv } = escanea([[{ name: "Neo N1", count: 99 }], [{ name: "Neo N1", count: 99 }]]);
        assert.equal(cuenta(inv, "Neo N1"), 99);
    });

    test("gastar reliquias baja la cuenta: el escaneo REEMPLAZA, no suma", () => {
        const inicial = [{ name: "Meso M2", count: 10 }];
        const { inv } = escanea([[{ name: "Meso M2", count: 3 }], [{ name: "Meso M2", count: 3 }]], inicial);
        assert.equal(cuenta(inv, "Meso M2"), 3);
    });

    test("una reliquia que se queda a cero desaparece del inventario", () => {
        const { inv } = escanea([[{ name: "Lith G1", count: 0 }], [{ name: "Lith G1", count: 0 }]],
            [{ name: "Lith G1", count: 4 }]);
        assert.equal(cuenta(inv, "Lith G1"), undefined);
    });

    test("lo que no sale en pantalla no se toca", () => {
        const inicial = [{ name: "Axi A1", count: 7 }, { name: "Lith B4", count: 2 }];
        const { inv } = escanea([[{ name: "Axi A1", count: 8 }], [{ name: "Axi A1", count: 8 }]], inicial);
        assert.equal(cuenta(inv, "Axi A1"), 8);
        assert.equal(cuenta(inv, "Lith B4"), 2, "una reliquia fuera de la pantalla no puede perderse");
    });
});

describe("escritura en el inventario", () => {
    test("'Lith A1' y 'Lith A1 Relic' son la misma y no se duplican", () => {
        const inv = applyRelicCounts([{ name: "Lith A1 Relic", count: 4 }], [{ name: "Lith A1", count: 9 }]);
        assert.equal(inv.length, 1);
        assert.equal(inv[0].count, 9);
    });

    test("el formato viejo (array de strings) se convierte sumando repetidos", () => {
        const inv = applyRelicCounts(["Axi A5", "Axi A5", "Lith C3"], [{ name: "Lith C3", count: 6 }]);
        assert.equal(cuenta(inv, "Axi A5"), 2, "las copias sueltas se cuentan");
        assert.equal(cuenta(inv, "Lith C3"), 6);
    });

    test("una reliquia nueva con cantidad 0 no se inventa", () => {
        assert.deepEqual(applyRelicCounts([], [{ name: "Neo N9", count: 0 }]), []);
    });

    test("un inventario nulo o corrupto no rompe la escritura", () => {
        assert.deepEqual(applyRelicCounts(null, [{ name: "Axi B2", count: 3 }]), [{ name: "Axi B2", count: 3 }]);
        const conBasura = applyRelicCounts([null, { count: 2 }, { name: "Meso F3", count: 1 }], []);
        assert.deepEqual(conBasura, [{ name: "Meso F3", count: 1 }]);
    });

    test("la misma reliquia dos veces en la MISMA lectura no se suma dos veces", () => {
        // happens when the grid duplicates a cell from a partial scroll
        const inv = applyRelicCounts([], [{ name: "Axi K9", count: 4 }, { name: "Axi K9", count: 4 }]);
        assert.equal(inv.length, 1);
        assert.equal(inv[0].count, 4);
    });
});
