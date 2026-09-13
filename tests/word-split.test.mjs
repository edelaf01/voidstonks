import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitFusedWord, splitFusedWords, catalogVocab } from "../deploy/js/utils/vision/word_split.js";

const VOCAB = new Set(["BOLTOR", "CEDO", "PRIME", "STOCK", "BARREL", "BLUEPRINT", "NEUROPTICS", "LEX", "PRIMED"]);
const caja = (texto, x0, x1) => ({ text: texto, bbox: { x0, y0: 0, x1, y1: 10 } });

describe("palabras pegadas por el OCR", () => {
    test("parte un rótulo sin espacios en las palabras del catálogo", () => {
        assert.deepEqual(splitFusedWord("BOLTORPRIMESTOCK", VOCAB), ["BOLTOR", "PRIME", "STOCK"]);
        assert.deepEqual(splitFusedWord("CEDOPRIMEBARREL", VOCAB), ["CEDO", "PRIME", "BARREL"]);
    });

    test("lo que no casa entero vuelve como token aparte, no se tira", () => {
        assert.deepEqual(splitFusedWord("BOLTORXXQZSTOCK", VOCAB), ["BOLTOR", "XXQZSTOCK"]);
        assert.deepEqual(splitFusedWord("PRIMEBIUEPRINT", VOCAB), ["PRIME", "BIUEPRINT"]);
        assert.equal(splitFusedWord("", VOCAB), null);
    });

    test("si la mal leída va delante, el sufijo del catálogo la separa igual", () => {
        assert.deepEqual(splitFusedWord("PFIMECHASSIS", new Set([...VOCAB, "CHASSIS"])), ["PFIME", "CHASSIS"]);
        assert.equal(splitFusedWord("XXQZSTOCKZZZ", VOCAB), null);
    });

    test("sin un prefijo del catálogo de al menos 4 letras no se parte", () => {
        assert.equal(splitFusedWord("XXQZSTOCKZZZ", VOCAB), null);
    });

    test("una palabra que ya está en el vocabulario no se trocea", () => {
        assert.equal(splitFusedWord("PRIMED", VOCAB), null);
    });

    test("prefiere la partición con MENOS palabras", () => {
        const v = new Set(["LEX", "PRIME", "BARREL", "LEXPRIME"]);
        assert.deepEqual(splitFusedWord("LEXPRIMEBARREL", v), ["LEXPRIME", "BARREL"]);
    });

    test("la caja se reparte a prorrata de las letras", () => {
        const [a, b, c] = splitFusedWords([caja("BoltorPrimeStock", 0, 160)], VOCAB);
        assert.deepEqual([a.text, b.text, c.text], ["Boltor", "Prime", "Stock"]);
        assert.equal(a.bbox.x0, 0);
        assert.equal(a.bbox.x1, 60);
        assert.equal(b.bbox.x0, 60);
        assert.equal(c.bbox.x1, 160);
    });

    test("una palabra corta o ya conocida pasa intacta", () => {
        const original = caja("STOCK", 0, 50);
        assert.deepEqual(splitFusedWords([original], VOCAB), [original]);
    });

    test("el vocabulario sale del catálogo, no de una lista escrita a mano", () => {
        const v = catalogVocab([{ originalName: "Boltor Prime Stock" }, { originalName: "Lex Prime Barrel" }]);
        assert.deepEqual([...v].sort(), ["BARREL", "BOLTOR", "LEX", "PRIME", "STOCK"]);
    });
});

describe("corte por cambio de caja", () => {
    test("separa lo que la red pegó, aunque los trozos vengan mal leídos", () => {
        const v = new Set(["LAVOS", "PRIME", "CHASSIS", "RECEIVER", "BLUEPRINT"]);
        const [a, b, c] = splitFusedWords([caja("Lavos/RrimeChassis", 0, 180)], v);
        assert.deepEqual([a.text, b.text, c.text], ["Lavos/", "Rrime", "Chassis"]);
    });

    test("una palabra del catálogo con una mayúscula por error NO se parte", () => {
        // measured: "Lex Prime ReceIver" ended up as "Rece Iver" and the item disappeared
        const v = new Set(["LEX", "PRIME", "RECEIVER"]);
        assert.deepEqual(splitFusedWords([caja("ReceIver", 0, 80)], v).map((w) => w.text), ["ReceIver"]);
    });
});
