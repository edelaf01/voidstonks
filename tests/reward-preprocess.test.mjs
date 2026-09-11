import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { maxChannelPreset, colorDelTexto, olvidaColorTexto, puntuaMascara } from "../deploy/js/utils/vision/reward_preprocess.js";
import { inkRunRatio } from "../deploy/js/utils/vision/ink_runs.js";
import { WF_THEMES } from "../deploy/js/utils/vision/wf_themes.js";
import { pantallaFisura, TEMAS as TEMAS_SYNTH } from "./_helpers/reward-synth.mjs";

/** ctx de mentira: maxChannelPreset solo usa getImageData/putImageData. */
function lienzo(pixeles) {
    const data = new Uint8ClampedArray(pixeles.length * 4);
    pixeles.forEach(([r, g, b], i) => { data.set([r, g, b, 255], i * 4); });
    const img = { data, width: pixeles.length, height: 1 };
    return { ctx: { getImageData: () => img, putImageData: () => {} }, img };
}
const gris = (img, i) => img.data[i * 4];

describe("preprocesado del recorte de recompensas", () => {
    test("el rojo del tema NO se aplana contra su fondo, que es lo que hacía el grayscale de CSS", () => {
        // Texto (240,65,51) sobre fondo teñido (110,25,20). Con pesos de luminancia la
        // diferencia es de 24 niveles; por canal máximo, de 130.
        const { ctx, img } = lienzo([[240, 65, 51], [110, 25, 20]]);
        maxChannelPreset(ctx, 2, 1, "STANDARD");
        assert.ok(gris(img, 0) > gris(img, 1), "el texto tiene que quedar más claro que su fondo");
        assert.ok(gris(img, 0) - gris(img, 1) > 100, `separación insuficiente: ${gris(img, 0) - gris(img, 1)}`);
    });

    test("el contraste y el brillo del preset se aplican, y en ese orden", () => {
        const { ctx, img } = lienzo([[128, 128, 128]]);
        maxChannelPreset(ctx, 1, 1, "STANDARD");
        // 128/255=0.502 -> contraste 4 lo deja casi igual (0.508) -> brillo 1.3 -> 0.66
        assert.equal(gris(img, 0), 168);
    });

    test("los presets separan de verdad: uno satura donde otro no", () => {
        // STANDARD y LOW_LIGHT saturan este píxel a 255; HIGH_GLARE lo deja a media altura.
        // Esa diferencia es la razón de la escalera de tres intentos sobre el mismo frame.
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
    /** Recorte de w×h: `pinta(x,y)` devuelve el RGB del píxel. */
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
    // El color se cachea hasta que cambia el contexto; cada caso parte de cero.
    const limpio = (f) => () => { olvidaColorTexto(); f(); };
    const STALKER = [{ name: "Stalker", r: 255, g: 61, b: 51 }, { name: "Tenno", r: 6, g: 106, b: 74 }];

    test("devuelve el color MEDIDO del trazo, no el del catálogo", limpio(() => {
        // Texto rojo apagado (la rampa real del juego) sobre fondo teñido del mismo tono.
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

    // PENDIENTE, no arreglado. La captura trae el contador de FPS del juego encima del recorte:
    // es texto blanco sobre fondo oscuro, o sea el trazo que MÁS destaca de todo, y se lleva la
    // votación. En las capturas reales la escalera de percentiles acaba proponiendo también el
    // color del tema y gana por tramos de tinta, pero eso NO es una defensa: aquí el overlay se
    // lleva los tres percentiles y no hay más candidato que comparar. Hace falta votar por
    // regiones, no un color para todo el recorte. Queda en `todo` a propósito: relajar la
    // aserción taparía justo el agujero que este caso existe para enseñar.
    test("un overlay blanco que destaca más que los rótulos no se lleva el voto", { todo: true }, limpio(() => {
        const w = 240, h = 60;
        const CLAROS = [...STALKER, { name: "Lotus", r: 226, g: 226, b: 236 }];
        const px = escena(w, h, (x, y) => {
            if (y >= 4 && y < 12 && x >= 10 && x < 46) return [232, 230, 238];   // overlay compacto
            if (y >= 30 && y <= 34 && x % 10 < 2) return [153, 31, 35];          // rótulos del tema
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
    /** Recorte w×h con la salida de maxChannelPreset: texto = 255, fondo = 0. */
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
        /** Píxeles marcados como texto en un rango de filas. */
        const enFilas = (y0, y1) => {
            let n = 0;
            for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4] > 128) n++;
            return n;
        };
        return { en: (x, y) => data[(y * w + x) * 4], enFilas, blancos, total: w * h };
    }
    const TEMAS = [{ name: "Stalker", r: 255, g: 61, b: 51 }, { name: "Tenno", r: 6, g: 106, b: 74 }];
    const w = 200, h = 40;
    // Fondo teñido del MISMO tono que el texto y por encima del suelo de luminancia: por debajo
    // lo tira ese suelo y la puerta de contraste, que es lo que se prueba, no llega a correr.
    const conTinte = (x, y) => (y >= 14 && y <= 20 && x % 7 < 3 ? [214, 52, 44] : [110, 28, 23]);

    test("con la lista de temas se binariza por color, no se apaga el recorte entero", () => {
        // La lista llegaba donde se esperaba UN tema: `temas.r` era undefined, toda distancia
        // salía NaN y ningún píxel la pasaba, así que el recorte entero quedaba negro y el OCR
        // no leía nada ("0 text pixels" en los logs con la banda bien detectada).
        const r = binariza(w, h, conTinte, TEMAS);
        assert.ok(r.enFilas(14, 21) > 100, `las filas del trazo quedaron en negro: ${r.enFilas(14, 21)} px`);
        assert.ok(r.blancos > 100, `el recorte quedó en negro: solo ${r.blancos} px de texto`);
    });

    test("el fondo teñido del MISMO tono que el texto no se marca como texto", () => {
        // Pedir solo parecido cromático marcaba el 39% del recorte en una captura real: el
        // juego tiñe el fondo del color del tema, así que el tono no distingue nada por sí solo.
        const r = binariza(w, h, conTinte, TEMAS);
        assert.equal(r.enFilas(0, 10), 0, "el fondo teñido, del mismo tono que el texto, se coló");
        assert.ok(r.blancos / r.total < 0.2, `máscara inundada: ${(100 * r.blancos / r.total).toFixed(1)}%`);
    });

    test("sin temas se conserva el canal máximo con contraste y brillo", () => {
        // Sin color medido la salida es continua, no binaria: canal máximo con el contraste y
        // el brillo del preset, que es lo que espera la pasada de badges.
        const r = binariza(2, 1, (x) => (x === 0 ? [240, 65, 51] : [110, 25, 20]), null);
        assert.equal(r.en(0, 0), 255);
        assert.equal(r.en(1, 0), 75);
    });

    // PENDIENTE, no arreglado. La pantalla de fisura pone ARTE brillante encima de cada rótulo,
    // y el arte se lleva la votación: el color elegido es su crema (232,226,197) en vez del rojo
    // del rótulo (153,37,31), y la máscara se queda con 0 de los 14.080 píxeles de rótulo que
    // hay en el recorte. En las cinco capturas reales no pasa —el rótulo acaba ganando por
    // tramos de tinta—, así que esto es un margen estrecho, no una defensa.
    //
    // Medir el listón de contraste POR FRANJAS lo arregla aquí (elige 153,37,31 y deja solo el
    // rótulo), pero en las capturas reales cuesta precisión: se pierde una palabra intermedia
    // ("Voruna Prime Blueprint" por "Voruna Prime Chassis Blueprint", que es OTRO ítem) y un
    // ítem entero. Se deja el global, que lee 20 de 20, y esto queda apuntado.
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
    /** Máscara RGBA en blanco con `pinta(x,y)` marcando tinta (negro), y su cuenta. */
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
    // Lo que dejaba el techo de brillo cuando se pasaba: el rótulo deshecho en píxeles sueltos.
    const motas = mascara((x, y) => x % 13 === 0 && y % 11 === 0);
    // Cuatro renglones de trazos cortos, que es como se ve un rótulo de verdad.
    const texto = mascara((x, y) => [20, 34, 60, 74].some((f) => y >= f && y < f + 9) && x % 5 < 3);

    test("una máscara casi vacía puntúa MÁS que el texto por tramos de tinta", () => {
        // Sin esto el resto del caso no prueba nada: es la trampa que hay que esquivar.
        assert.ok(motas.tinta < texto.tinta / 5, "las motas tienen que ser mucha menos tinta");
        assert.ok(inkRunRatio(motas.m, W, H) > inkRunRatio(texto.m, W, H),
            "el criterio a secas ya prefería el texto; el caso no reproduce nada");
    });

    test("aun así gana el texto: una máscara borrada no es un rótulo", () => {
        // Con la máscara borrada ganando salía "Voruna Prime Blueprint" en vez de "Voruna Prime
        // Neuroptics Blueprint", que es OTRA pieza y se apuntaba sola en el inventario.
        assert.equal(puntuaMascara(motas.m, motas.tinta, W, H), 0, "las motas siguen compitiendo");
        assert.ok(puntuaMascara(texto.m, texto.tinta, W, H) > 0);
    });

    test("el listón mira la tinta, no el número de píxeles del recorte", () => {
        // Mismo dibujo en un recorte cuatro veces mayor sigue siendo texto: el listón es una
        // fracción del área, así que no puede depender de la resolución de la captura.
        const grande = mascara((x, y) => [20, 34, 60, 74].some((f) => y >= f && y < f + 9) && x % 5 < 3);
        assert.ok(puntuaMascara(grande.m, grande.tinta, W, H) > 0);
        assert.equal(puntuaMascara(grande.m, Math.floor(W * H * 0.009), W, H), 0);
    });
});
