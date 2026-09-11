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
        // previously returned null, losing the good prefix as well: one of two fused words can be misread
        // ("PRIMEBIUEPRINT", l -> i), leaving the card with no anchor or part; measured on a 1080p capture this
        // lost the entire card
        // the rest goes to normalization, which handles glyph confusions; background art noise fails catalog
        // resolution and drops there
        assert.deepEqual(splitFusedWord("BOLTORXXQZSTOCK", VOCAB), ["BOLTOR", "XXQZSTOCK"]);
        assert.deepEqual(splitFusedWord("PRIMEBIUEPRINT", VOCAB), ["PRIME", "BIUEPRINT"]);
        assert.equal(splitFusedWord("", VOCAB), null);
    });

    test("sin un prefijo del catálogo de al menos 4 letras no se parte", () => {
        // the remainder is preserved, but splitting still requires a recognizable prefix: splitting on three stray
        // letters invents structure that is not there
        assert.equal(splitFusedWord("XXQZSTOCKZZZ", VOCAB), null);
    });

    test("una palabra que ya está en el vocabulario no se trocea", () => {
        // "PRIMED" contains "PRIME"; without requiring 2+ words it would get chopped into fragments
        assert.equal(splitFusedWord("PRIMED", VOCAB), null);
    });

    test("prefiere la partición con MENOS palabras", () => {
        const v = new Set(["LEX", "PRIME", "BARREL", "LEXPRIME"]);
        assert.deepEqual(splitFusedWord("LEXPRIMEBARREL", v), ["LEXPRIME", "BARREL"]);
    });

    test("la caja se reparte a prorrata de las letras", () => {
        const [a, b, c] = splitFusedWords([caja("BoltorPrimeStock", 0, 160)], VOCAB);
        // camelCase splits via CASE, preserving original casing; vocabulary splitting below works on uppercase
        // tokens; callers do not care since normalizeOCRWords uppercases anyway
        assert.deepEqual([a.text, b.text, c.text], ["Boltor", "Prime", "Stock"]);
        assert.equal(a.bbox.x0, 0);
        assert.equal(a.bbox.x1, 60);     // 6 letters of 16 over 160 px
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
    // neural networks fuse words preserving the next word's casing, so case transitions mark boundaries; a
    // signal Tesseract lacks (it fuses in uppercase)
    test("separa lo que la red pegó, aunque los trozos vengan mal leídos", () => {
        // "Rrime" is misread "Prime": not in vocabulary, yet must split or the whole label is lost; checks the
        // WHOLE word, not each fragment; the slash comes from OCR
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
