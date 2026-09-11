import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inkRunRatio } from "../deploy/js/utils/vision/ink_runs.js";

/** w×h mask: `pinta(x,y)` decides whether the pixel is ink (black) */
function mascara(w, h, pinta) {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (pinta(x, y)) data[(y * w + x) * 4] = 0;
    }
    return data;
}

describe("cuánto se parece a texto una máscara", () => {
    test("trazos finos separados puntúan mucho más que una mancha maciza", () => {
        // 20 strokes 1 px wide per row: each one is its own run -> ratio 1
        const trazos = mascara(60, 10, (x) => x % 3 === 0);
        assert.equal(inkRunRatio(trazos, 60, 10), 1);
        // a 20x10 blot: one run per row over 20 pixels -> 0.05
        const mancha = mascara(60, 10, (x) => x >= 20 && x < 40);
        assert.equal(inkRunRatio(mancha, 60, 10), 0.05);
    });

    test("sin tinta devuelve 0 y no divide por cero", () => {
        assert.equal(inkRunRatio(mascara(8, 4, () => false), 8, 4), 0);
    });

    test("un tramo que llega al borde derecho se cuenta igual", () => {
        // without resetting the state on a row change, two consecutive rows would count as one run
        const pegado = mascara(4, 3, (x) => x >= 2);
        assert.equal(inkRunRatio(pegado, 4, 3), 0.5);
    });
});
