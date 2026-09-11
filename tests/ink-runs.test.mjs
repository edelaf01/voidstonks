import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inkRunRatio } from "../deploy/js/utils/vision/ink_runs.js";

/** Máscara de w×h: `pinta(x,y)` decide si el píxel es tinta (negro). */
function mascara(w, h, pinta) {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (pinta(x, y)) data[(y * w + x) * 4] = 0;
    }
    return data;
}

describe("cuánto se parece a texto una máscara", () => {
    test("trazos finos separados puntúan mucho más que una mancha maciza", () => {
        // 20 trazos de 1 px por fila: cada uno es su propio tramo -> ratio 1.
        const trazos = mascara(60, 10, (x) => x % 3 === 0);
        assert.equal(inkRunRatio(trazos, 60, 10), 1);
        // Una mancha de 20x10: un solo tramo por fila sobre 20 píxeles -> 0.05.
        const mancha = mascara(60, 10, (x) => x >= 20 && x < 40);
        assert.equal(inkRunRatio(mancha, 60, 10), 0.05);
    });

    test("sin tinta devuelve 0 y no divide por cero", () => {
        assert.equal(inkRunRatio(mascara(8, 4, () => false), 8, 4), 0);
    });

    test("un tramo que llega al borde derecho se cuenta igual", () => {
        // Sin reiniciar el estado al cambiar de fila, dos filas seguidas contarían un tramo.
        const pegado = mascara(4, 3, (x) => x >= 2);
        assert.equal(inkRunRatio(pegado, 4, 3), 0.5);
    });
});
