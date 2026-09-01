import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeOCRWords } from "../deploy/js/utils/inventory/ocr_words.js";

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
