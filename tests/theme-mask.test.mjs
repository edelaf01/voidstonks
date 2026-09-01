import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchesThemeHue, themeTextMask } from "../deploy/js/utils/vision/theme_mask.js";
import { WF_THEMES } from "../deploy/js/utils/vision/wf_themes.js";

const STALKER = WF_THEMES.find((t) => t.name === "Stalker");

/** ImageData de mentira: themeTextMask solo mira data/width/height. */
function lienzo(w, h, pinta) {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b] = pinta(x, y);
            const i = (y * w + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
    }
    return { data, width: w, height: h };
}
const esNegro = (img, x, y) => img.data[(y * img.width + x) * 4] === 0;

describe("máscara de texto por color de tema", () => {
    // Los tres colores salen de contar píxeles en relicscreenredred.png: el tema es Stalker
    // (255,61,51) y el texto aparece a varias opacidades, no solo en su color puro.
    for (const [rgb, n] of [[[248, 56, 48], 6053], [[152, 24, 32], 33540], [[120, 24, 24], 2093]]) {
        test(`la rampa del tema cuenta como texto: ${rgb} (${n} px en la captura)`, () => {
            assert.equal(matchesThemeHue(...rgb, STALKER), true);
        });
    }

    test("un tono distinto no cuela por mucho brillo que tenga", () => {
        assert.equal(matchesThemeHue(24, 152, 152, STALKER), false);
        assert.equal(matchesThemeHue(255, 255, 255, STALKER), false);
        assert.equal(matchesThemeHue(60, 250, 55, STALKER), false);
    });

    test("casi negro no es texto: escalarlo amplificaría el ruido hasta cualquier tono", () => {
        assert.equal(matchesThemeHue(20, 4, 4, STALKER), false);
        assert.equal(matchesThemeHue(39, 9, 8, STALKER), false);
        assert.equal(matchesThemeHue(41, 10, 8, STALKER), true);
    });

    test("el arte de fondo teñido del color del tema NO se marca: le falta el contraste", () => {
        // Degradado rojo suave de 60 a 150: mismo tono que Stalker y por encima del mínimo de
        // brillo, así que sin la puerta de contraste se marcaría la pantalla entera.
        const img = lienzo(80, 40, (x) => {
            const v = 60 + Math.round(x * 90 / 80);
            return [v, Math.round(v * 0.24), Math.round(v * 0.2)];
        });
        assert.equal(themeTextMask(img, [STALKER]), 0);
    });

    test("un trazo del tema sobre fondo oscuro sí se marca", () => {
        const img = lienzo(80, 40, (x, y) => (
            y >= 18 && y <= 21 && x >= 20 && x < 60 ? [152, 24, 32] : [16, 0, 0]
        ));
        const marcados = themeTextMask(img, [STALKER]);
        assert.equal(marcados, 160);
        assert.equal(esNegro(img, 30, 20), true);
        assert.equal(esNegro(img, 30, 5), false);
    });

    test("con varios temas basta que encaje uno", () => {
        const tenno = WF_THEMES.find((t) => t.name === "Tenno");
        const img = lienzo(60, 30, (x, y) => (y >= 14 && y <= 16 && x >= 10 && x < 50
            ? [tenno.r, tenno.g, tenno.b] : [8, 8, 8]));
        assert.equal(themeTextMask(img, [STALKER]), 0);
        const img2 = lienzo(60, 30, (x, y) => (y >= 14 && y <= 16 && x >= 10 && x < 50
            ? [tenno.r, tenno.g, tenno.b] : [8, 8, 8]));
        assert.equal(themeTextMask(img2, [STALKER, tenno]), 120);
    });
});

describe("umbral por distancia al tema", () => {
    test("sin tema no toca la imagen: el título de FIN DE MISIÓN no da tema fiable", async () => {
        // Reventaba con `theme.actualR` sobre null y el catch del bucle del escáner se comía la
        // excepción, así que el contexto MISSION_COMPLETE no se activaba en ningún frame.
        const { installFakeDocument } = await import("./_helpers/fake-canvas.mjs");
        installFakeDocument();
        const { VisionService } = await import("../deploy/js/services/scanner/vision.service.js");
        const cvs = globalThis.document.createElement("canvas");
        cvs.width = 4; cvs.height = 2;
        const ctx = cvs.getContext("2d");
        const antes = ctx.getImageData(0, 0, 4, 2);
        antes.data[0] = 200; antes.data[1] = 50; antes.data[2] = 40;
        ctx.putImageData(antes, 0, 0);

        VisionService.applyThemeDistanceThreshold(ctx, 4, 2, null);

        const despues = ctx.getImageData(0, 0, 4, 2);
        assert.deepEqual([...despues.data.slice(0, 3)], [200, 50, 40]);
    });
});
