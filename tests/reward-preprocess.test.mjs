import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { maxChannelPreset, colorDelTexto, olvidaColorTexto, puntuaMascara } from "../deploy/js/utils/vision/reward_preprocess.js";
import { inkRunRatio } from "../deploy/js/utils/vision/ink_runs.js";
import { WF_THEMES } from "../deploy/js/utils/vision/wf_themes.js";
import { pantallaFisura, TEMAS as TEMAS_SYNTH } from "./_helpers/reward-synth.mjs";

/** fake canvas context: maxChannelPreset only touches getImageData/putImageData */
function lienzo(pixeles) {
    const data = new Uint8ClampedArray(pixeles.length * 4);
    pixeles.forEach(([r, g, b], i) => { data.set([r, g, b, 255], i * 4); });
    const img = { data, width: pixeles.length, height: 1 };
    return { ctx: { getImageData: () => img, putImageData: () => {} }, img };
}
const gris = (img, i) => img.data[i * 4];

describe("preprocesado del recorte de recompensas", () => {
    test("el rojo del tema NO se aplana contra su fondo, que es lo que hacía el grayscale de CSS", () => {
        // text (240,65,51) over tinted background (110,25,20): luminance weights give a 24-level gap; max-channel
        // gives 130
        const { ctx, img } = lienzo([[240, 65, 51], [110, 25, 20]]);
        maxChannelPreset(ctx, 2, 1, "STANDARD");
        assert.ok(gris(img, 0) > gris(img, 1), "el texto tiene que quedar más claro que su fondo");
        assert.ok(gris(img, 0) - gris(img, 1) > 100, `separación insuficiente: ${gris(img, 0) - gris(img, 1)}`);
    });

    test("el contraste y el brillo del preset se aplican, y en ese orden", () => {
        const { ctx, img } = lienzo([[128, 128, 128]]);
        maxChannelPreset(ctx, 1, 1, "STANDARD");
        // 128/255=0.502 -> contrast 4 keeps it nearly flat (0.508) -> brightness 1.3 -> 0.66
        assert.equal(gris(img, 0), 168);
    });

    test("los presets separan de verdad: uno satura donde otro no", () => {
        // STANDARD and LOW_LIGHT saturate this pixel to 255; HIGH_GLARE leaves it at mid-level
        // that difference is the reason for the 3-attempt ladder on the same frame
        const val = (p) => { const { ctx, img } = lienzo([[150, 40, 30]]); maxChannelPreset(ctx, 1, 1, p); return gris(img, 0); };
        assert.equal(val("STANDARD"), 255);
        assert.equal(val("LOW_LIGHT"), 255);
        assert.equal(val("HIGH_GLARE"), 158);
    });

    test("un preset desconocido cae al estándar en vez de romper", () => {
        const { ctx, img } = lienzo([[150, 40, 30]]);
        maxChannelPreset(ctx, 1, 1, "NO_EXISTE");
        const { ctx: c2, img: i2 } = lienzo([[150, 40, 30]]);
        maxChannelPreset(c2, 1, 1, "STANDARD");
        assert.equal(gris(img, 0), gris(i2, 0));
    });

    test("no revienta con un lienzo vacío", () => {
        const { ctx, img } = lienzo([[10, 10, 10]]);
        maxChannelPreset(ctx, 0, 0, "STANDARD");
        assert.equal(gris(img, 0), 10);
    });
});

describe("color exacto del texto, con los temas como guía", () => {
    /** crop of w×h: pinta(x,y) returns pixel RGB */
    const escena = (w, h, pinta) => {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const [r, g, b] = pinta(x, y);
                d.set([r, g, b, 255], (y * w + x) * 4);
            }
        }
        return d;
    };
    // color is cached until context changes; each case starts fresh
    const limpio = (f) => () => { olvidaColorTexto(); f(); };
    const STALKER = [{ name: "Stalker", r: 255, g: 61, b: 51 }, { name: "Tenno", r: 6, g: 106, b: 74 }];

    test("devuelve el color MEDIDO del trazo, no el del catálogo", limpio(() => {
        // muted red text (real in-game ramp) over background tinted to the same hue
        const w = 200, h = 40;
        const px = escena(w, h, (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [214, 52, 44] : [70, 18, 15]));
        assert.deepEqual(colorDelTexto(px, w, h, STALKER)?.color, [214, 52, 44]);
    }));

    test("sin trazos que destaquen no inventa un color", limpio(() => {
        const w = 60, h = 20;
        assert.equal(colorDelTexto(escena(w, h, () => [70, 18, 15]), w, h, STALKER), null);
    }));

    test("elige el tema por TONO, no por brillo: un rojo apagado sigue siendo Stalker", limpio(() => {
        const w = 200, h = 40;
        const px = escena(w, h, (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [120, 30, 25] : [20, 6, 5]));
        assert.deepEqual(colorDelTexto(px, w, h, STALKER)?.color, [120, 30, 25],
            "un trazo a media opacidad no puede caerse por brillo");
    }));

    // PENDING, unresolved: in-game FPS counter sits over the crop as white-on-dark text, outvoting the theme
    // in real captures the percentile ladder eventually surfaces the theme color and wins by ink runs, but
    // here overlay captures all 3 percentiles
    // requires regional voting instead of a single crop-wide color; kept as todo to avoid masking the bug
    test("un overlay blanco que destaca más que los rótulos no se lleva el voto", { todo: true }, limpio(() => {
        const w = 240, h = 60;
        const CLAROS = [...STALKER, { name: "Lotus", r: 226, g: 226, b: 236 }];
        const px = escena(w, h, (x, y) => {
            if (y >= 4 && y < 12 && x >= 10 && x < 46) return [232, 230, 238];   // compact overlay
            if (y >= 30 && y <= 34 && x % 10 < 2) return [153, 31, 35];          // theme labels
            return [34, 11, 9];
        });
        assert.deepEqual(colorDelTexto(px, w, h, CLAROS)?.color, [153, 31, 35],
            "ganó el trazo más marcado en vez del que parece texto");
    }));

    test("el color se cachea hasta que el escáner avisa de que cambió el contexto", () => {
        olvidaColorTexto();
        const w = 200, h = 40;
        const rojo = escena(w, h, (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [214, 52, 44] : [70, 18, 15]));
        const verde = escena(w, h, (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [10, 170, 118] : [4, 40, 28]));
        assert.deepEqual(colorDelTexto(rojo, w, h, STALKER)?.color, [214, 52, 44]);
        assert.deepEqual(colorDelTexto(verde, w, h, STALKER)?.color, [214, 52, 44], "recalculó sin cambiar de contexto");
        olvidaColorTexto();
        assert.deepEqual(colorDelTexto(verde, w, h, STALKER)?.color, [10, 170, 118]);
    });

    test("una pantalla sin color de tema se mide una vez, no en cada frame", () => {
        olvidaColorTexto();
        const w = 60, h = 20;
        const plano = escena(w, h, () => [70, 18, 15]);
        assert.equal(colorDelTexto(plano, w, h, STALKER), null);
        const conTexto = escena(w, h, (x, y) => (y >= 8 && y <= 12 && x % 7 < 3 ? [214, 52, 44] : [70, 18, 15]));
        assert.equal(colorDelTexto(conTexto, w, h, STALKER), null, "volvió a medir tras un fallo");
    });
});

describe("binarización por el color medido", () => {
    /** w×h crop with maxChannelPreset output: text = 255, background = 0 */
    function binariza(w, h, pinta, temas) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const [r, g, b] = pinta(x, y);
                data.set([r, g, b, 255], (y * w + x) * 4);
            }
        }
        const img = { data, width: w, height: h };
        olvidaColorTexto();
        maxChannelPreset({ getImageData: () => img, putImageData: () => {} }, w, h, "STANDARD", temas);
        let blancos = 0;
        for (let p = 0; p < w * h; p++) if (data[p * 4] > 128) blancos++;
        /** pixels marked as text in a row range */
        const enFilas = (y0, y1) => {
            let n = 0;
            for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] > 128) n++;
            return n;
        };
        return { en: (x, y) => data[(y * w + x) * 4], enFilas, blancos, total: w * h };
    }
    const TEMAS = [{ name: "Stalker", r: 255, g: 61, b: 51 }, { name: "Tenno", r: 6, g: 106, b: 74 }];
    const w = 200, h = 40;
    // background tinted to the SAME hue as text and above the luminance floor: lower luminance triggers the
    // floor cutoff before contrast gating runs
    const conTinte = (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [214, 52, 44] : [110, 28, 23]);

    test("con la lista de temas se binariza por color, no se apaga el recorte entero", () => {
        // theme list arrived where a SINGLE theme was expected: temas.r was undefined, distances became NaN and
        // all pixels failed, leaving the crop black with "0 text pixels"
        const r = binariza(w, h, conTinte, TEMAS);
        assert.ok(r.enFilas(14, 21) > 100, `las filas del trazo quedaron en negro: ${r.enFilas(14, 21)} px`);
        assert.ok(r.blancos > 100, `el recorte quedó en negro: solo ${r.blancos} px de texto`);
    });

    test("el fondo teñido del MISMO tono que el texto no se marca como texto", () => {
        // matching chromatic similarity alone marked 39% of the crop: game tints background to theme color, so hue
        // alone cannot separate text
        const r = binariza(w, h, conTinte, TEMAS);
        assert.equal(r.enFilas(0, 10), 0, "el fondo teñido, del mismo tono que el texto, se coló");
        assert.ok(r.blancos / r.total < 0.2, `máscara inundada: ${(100 * r.blancos / r.total).toFixed(1)}%`);
    });

    test("sin temas se conserva el canal máximo con contraste y brillo", () => {
        // without measured color, output is continuous rather than binary: max channel with preset contrast and
        // brightness for badge pass
        const r = binariza(2, 1, (x) => (x === 0 ? [240, 65, 51] : [110, 25, 20]), null);
        assert.equal(r.en(0, 0), 255);
        assert.equal(r.en(1, 0), 75);
    });

    // PENDING, unresolved: fissure screen places bright ART above each label, winning the vote (cream
    // 232,226,197 instead of red 153,37,31) and retaining 0 of 14,080 label pixels
    // real captures win by ink runs, so this is a narrow margin rather than safe behaviour
    // per-band contrast fixes this here but loses precision in real captures ("Voruna Prime Blueprint" for
    // "Voruna Prime Chassis Blueprint", another item): keeping global threshold (20/20)
    test("el arte brillante de la tarjeta no se lleva el color del rótulo", { todo: true }, () => {
        const escena = pantallaFisura({ tema: TEMAS_SYNTH.stalker, brilloRotulo: 0.6, tinte: 0.55, manchasArte: 10, width: 1280, height: 720 });
        const b = escena.banda;
        const data = new Uint8ClampedArray(b.w * b.h * 4);
        for (let y = 0; y < b.h; y++) {
            const src = ((b.y + y) * escena.img.width + b.x) * 4;
            data.set(escena.img.data.subarray(src, src + b.w * 4), y * b.w * 4);
        }
        olvidaColorTexto();
        assert.deepEqual(colorDelTexto(data, b.w, b.h, WF_THEMES)?.color, [153, 37, 31]);
    });
});

describe("elegir entre máscaras candidatas", () => {
    const W = 300, H = 100;
    /** blank RGBA mask with pinta(x,y) marking ink (black), and its pixel count */
    function mascara(pinta) {
        const m = new Uint8Array(W * H * 4).fill(255);
        let tinta = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!pinta(x, y)) continue;
                const i = (y * W + x) * 4;
                m[i] = m[i + 1] = m[i + 2] = 0;
                tinta++;
            }
        }
        return { m, tinta };
    }
    // what excessive brightness ceiling left behind: label shattered into stray speckles
    const motas = mascara((x, y) => x % 13 === 0 && y % 11 === 0);
    // four lines of short strokes matching a real label
    const texto = mascara((x, y) => [20, 34, 60, 74].some((f) => y >= f && y < f + 9) && x % 5 < 3);

    test("una máscara casi vacía puntúa MÁS que el texto por tramos de tinta", () => {
        // without this the rest of the case proves nothing: the trap to avoid
        assert.ok(motas.tinta < texto.tinta / 5, "las motas tienen que ser mucha menos tinta");
        assert.ok(inkRunRatio(motas.m, W, H) > inkRunRatio(texto.m, W, H),
            "el criterio a secas ya prefería el texto; el caso no reproduce nada");
    });

    test("aun así gana el texto: una máscara borrada no es un rótulo", () => {
        // with the washed-out mask winning, output was "Voruna Prime Blueprint" instead of "Voruna Prime
        // Neuroptics Blueprint" (ANOTHER item that auto-committed)
        assert.equal(puntuaMascara(motas.m, motas.tinta, W, H), 0, "las motas siguen compitiendo");
        assert.ok(puntuaMascara(texto.m, texto.tinta, W, H) > 0);
    });

    test("el listón mira la tinta, no el número de píxeles del recorte", () => {
        // same pattern in a 4x larger crop is still text: threshold is an area fraction and must not depend on
        // capture resolution
        const grande = mascara((x, y) => [20, 34, 60, 74].some((f) => y >= f && y < f + 9) && x % 5 < 3);
        assert.ok(puntuaMascara(grande.m, grande.tinta, W, H) > 0);
        assert.equal(puntuaMascara(grande.m, Math.floor(W * H * 0.009), W, H), 0);
    });
});
