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
        // Antes devolvía null y se perdía TAMBIÉN el prefijo bueno. Una de las dos palabras
        // pegadas puede venir mal leída —"PRIMEBIUEPRINT" (l -> i)— y entonces la tarjeta se
        // quedaba sin ancla y sin pieza: medido, una captura a 1080p perdía la carta entera.
        // El resto se lo queda la normalización, que sí sabe de confusiones de glifo; si es
        // basura del arte no resuelve contra el catálogo y se cae allí.
        assert.deepEqual(splitFusedWord("BOLTORXXQZSTOCK", VOCAB), ["BOLTOR", "XXQZSTOCK"]);
        assert.deepEqual(splitFusedWord("PRIMEBIUEPRINT", VOCAB), ["PRIME", "BIUEPRINT"]);
        assert.equal(splitFusedWord("", VOCAB), null);
    });

    test("sin un prefijo del catálogo de al menos 4 letras no se parte", () => {
        // El resto viaja, pero la decisión de partir sigue necesitando una palabra reconocible
        // delante: partir por tres letras sueltas es inventarse una estructura que no está.
        assert.equal(splitFusedWord("XXQZSTOCKZZZ", VOCAB), null);
    });

    test("una palabra que ya está en el vocabulario no se trocea", () => {
        // "PRIMED" contiene "PRIME"; sin exigir 2+ palabras saldría troceada en fragmentos.
        assert.equal(splitFusedWord("PRIMED", VOCAB), null);
    });

    test("prefiere la partición con MENOS palabras", () => {
        const v = new Set(["LEX", "PRIME", "BARREL", "LEXPRIME"]);
        assert.deepEqual(splitFusedWord("LEXPRIMEBARREL", v), ["LEXPRIME", "BARREL"]);
    });

    test("la caja se reparte a prorrata de las letras", () => {
        const [a, b, c] = splitFusedWords([caja("BoltorPrimeStock", 0, 160)], VOCAB);
        // Con mayúscula intermedia parte el corte por CAJA, que conserva el texto tal cual; la
        // partición por vocabulario (la de abajo) trabaja sobre el token ya en mayúsculas. A
        // quien lo consume le da igual: normalizeOCRWords lo pasa a mayúsculas de todos modos.
        assert.deepEqual([a.text, b.text, c.text], ["Boltor", "Prime", "Stock"]);
        assert.equal(a.bbox.x0, 0);
        assert.equal(a.bbox.x1, 60);     // 6 letras de 16 sobre 160 px
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
    // Los motores de red pegan palabras conservando la mayúscula de la siguiente, así que el
    // cambio de caja marca la juntura. Es la señal que Tesseract no da (él pega en mayúsculas).
    test("separa lo que la red pegó, aunque los trozos vengan mal leídos", () => {
        // "Rrime" es "Prime" mal leído: no está en el vocabulario, y aun así hay que cortar ahí
        // o el rótulo entero se pierde. Por eso la condición mira la palabra ENTERA, no cada
        // trozo. La barra la mete el propio OCR.
        const v = new Set(["LAVOS", "PRIME", "CHASSIS", "RECEIVER", "BLUEPRINT"]);
        const [a, b, c] = splitFusedWords([caja("Lavos/RrimeChassis", 0, 180)], v);
        assert.deepEqual([a.text, b.text, c.text], ["Lavos/", "Rrime", "Chassis"]);
    });

    test("una palabra del catálogo con una mayúscula por error NO se parte", () => {
        // Medido: "Lex Prime ReceIver" acababa como "Rece Iver" y la pieza desaparecía.
        const v = new Set(["LEX", "PRIME", "RECEIVER"]);
        assert.deepEqual(splitFusedWords([caja("ReceIver", 0, 80)], v).map((w) => w.text), ["ReceIver"]);
    });
});
