import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { OCRService } = await import("../deploy/js/services/scanner/ocr.service.js");
const { state } = await import("../deploy/js/state.js");
const { recuperaPorSufijo } = await import("../deploy/js/utils/inventory/component_recover.js");

const FIX = JSON.parse(readFileSync(new URL("./_fixtures/reward-hydroid-words.json", import.meta.url), "utf8"));

function indexa(nombres) {
    state.itemsDatabase = Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15 }]]));
    OCRService.cachedDbItems = [];
    OCRService.knownParts = new Set();
    OCRService._vocabCache = null;
    OCRService.initMatcherData();
}

const FRAMES = ["Hydroid", "Gyre", "Voruna", "Xaku", "Nekros", "Zephyr", "Revenant", "Styanax",
    "Caliban", "Lavos", "Ash", "Ember", "Frost", "Mag", "Rhino", "Trinity", "Nova", "Nyx"];
const PIEZAS = FRAMES.flatMap((f) => [
    `${f} Prime Blueprint`, `${f} Prime Neuroptics Blueprint`,
    `${f} Prime Chassis Blueprint`, `${f} Prime Systems Blueprint`,
]);

describe("una tarjeta cuyo nombre llegó mal leído", () => {
    test("se recupera por el sufijo: 4 recompensas, no 3", () => {
        indexa(PIEZAS);
        const words = FIX.words.map((w) => ({
            text: w.text, confidence: 90,
            bbox: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 },
        }));
        const leidos = OCRService.parseRewards({ words, imageW: FIX.canvas.w, columnas: FIX.columnas })
            .map((i) => i.name);
        assert.deepEqual([...leidos].sort(), [...FIX.esperado].sort());
    });

    test("la palabra mal leída la tira la normalización, así que el rescate mira las CRUDAS", () => {
        const sim = (a, b) => OCRService.similarityOCR(a, b);
        assert.equal(recuperaPorSufijo(["PRIME", "NEUROPTICS", "BLUEPRINT"], PIEZAS, sim), null);
        assert.equal(recuperaPorSufijo(["Hydiid", "Prime", "Neuroptics", "Blueprint"], PIEZAS, sim),
            "Hydroid Prime Neuroptics Blueprint");
    });
});

describe("el rescate por sufijo no puede inventarse una pieza", () => {
    const sim = (a, b) => OCRService.similarityOCR(a, b);

    test("sin un parecido CLARAMENTE mejor que el segundo, no devuelve nada", () => {
        // without uniqueness margin, rescue hallucinated "Nekros Prime Chassis Blueprint" over Gyre
        const empatan = ["Naxos", "Prime", "Chassis", "Blueprint"];
        const puntos = FRAMES
            .map((f) => ({ f, s: sim("NAXOS", f.toUpperCase()) }))
            .sort((a, b) => b.s - a.s);
        assert.ok(puntos[0].s - puntos[1].s < 0.12,
            `el token elegido ya distingue solo (${puntos[0].f} ${puntos[0].s.toFixed(2)} vs ${puntos[1].f} ${puntos[1].s.toFixed(2)})`);
        assert.equal(recuperaPorSufijo(empatan, PIEZAS, sim), null);
    });

    test("con un parecido claro sí lo devuelve", () => {
        assert.equal(recuperaPorSufijo(["Hydrbid", "prime", "Neuroptics", "Blueprint"], PIEZAS, sim),
            "Hydroid Prime Neuroptics Blueprint");
    });
});
