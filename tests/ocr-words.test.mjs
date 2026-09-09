import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeOCRWords, confirmaPrime } from "../deploy/js/utils/inventory/ocr_words.js";
import { OCRService } from "../deploy/js/services/scanner/ocr.service.js";

// Etapa que prepara las palabras del OCR para parseRewards. Salió de ocr.service.js, que estaba
// en su techo de tamaño; aquí se puede probar sin arrastrar el servicio entero.
const ctx = {
    knownParts: new Set(["BOLTOR", "PRIME", "STOCK", "LAVOS", "CHASSIS", "BLUEPRINT"]),
    cachedDbItems: [{ originalName: "Boltor Prime Stock" }, { originalName: "Lavos Prime Chassis Blueprint" }],
    similarityOCR: (a, b) => {
        if (a === b) return 1;
        if (a.length !== b.length) return 0;
        let d = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
        return d === 1 ? 0.83 : 0;
    },
    editDistance: (a, b) => {
        if (a.length !== b.length) return Math.abs(a.length - b.length) || 9;
        let d = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
        return d;
    },
};
const caja = (t, x) => ({ text: t, confidence: 90, bbox: { x0: x, y0: 0, x1: x + 60, y1: 20 } });

describe("normalizar las palabras del OCR", () => {
    test("las palabras pegadas se separan y conservan su posición", () => {
        const r = normalizeOCRWords({ words: [caja("BoltorPrimeStock", 0)], imageW: 600 }, ctx);
        assert.deepEqual(r.map((w) => w.text), ["BOLTOR", "PRIME", "STOCK"]);
        assert.ok(r[0].x < r[1].x && r[1].x < r[2].x, "las X tienen que quedar en orden");
    });

    test("un token que no se parece a nada del catálogo se descarta", () => {
        assert.deepEqual(normalizeOCRWords({ words: [caja("ZZQX", 10)], imageW: 600 }, ctx), []);
    });

    test("los badges y los números pasan tal cual, sin buscarles parecido", () => {
        const r = normalizeOCRWords({ words: [caja("OWNED", 10), caja("14", 80)], imageW: 600 }, ctx);
        assert.deepEqual(r.map((w) => w.text), ["OWNED", "14"]);
    });

    test("dentro de una tarjeta se corrige un glifo en 5 letras; fuera no", () => {
        const cols = [{ x0: 0, x1: 0.5 }];
        const dentro = normalizeOCRWords({ words: [caja("LAVQS", 60)], imageW: 600, columnas: cols }, ctx);
        assert.deepEqual(dentro.map((w) => w.text), ["LAVOS"]);
        const fuera = normalizeOCRWords({ words: [caja("LAVQS", 500)], imageW: 600, columnas: cols }, ctx);
        assert.deepEqual(fuera.map((w) => w.text), []);
    });
});

// Con el similarityOCR REAL: lo que se prueba es el umbral contra confusiones de verdad.
describe("confirmar que el rótulo dice PRIME", () => {
    const UMBRAL = 0.6;

    test("PRIME entero, o con una confusión de glifo, se confirma", () => {
        assert.equal(confirmaPrime(["BOLTOR", "PRIME", "STOCK"], OCRService, UMBRAL), true);
        assert.equal(confirmaPrime(["BOLTOR", "FRIME", "STOCK"], OCRService, UMBRAL), true);
    });

    test("partido en dos tokens se confirma uniéndolo al siguiente", () => {
        // Sin la unión, ni "PR" (0.4) ni "ME" (0.4) llegan solos y la celda se quedaba sin match.
        assert.equal(confirmaPrime(["AKSTILETTO", "PR", "ME", "LINK"], OCRService, UMBRAL), true);
        assert.equal(confirmaPrime(["AKBRON", "OPR", "ME", "LINK"], OCRService, UMBRAL), true);
    });

    test("una palabra ajena parecida NO lo confirma", () => {
        // "POINT" (0.52) es el caso real que motivó el umbral: sin él se apuntaban primes falsos.
        assert.equal(confirmaPrime(["POINT"], OCRService, UMBRAL), false);
        assert.equal(confirmaPrime(["BOLTOR", "STOCK"], OCRService, UMBRAL), false);
    });

    test("sin tokens no confirma nada", () => {
        assert.equal(confirmaPrime([], OCRService, UMBRAL), false);
    });
});
