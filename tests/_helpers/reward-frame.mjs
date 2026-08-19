/**
 * synthetic VOID FISSURE/REWARDS frame generator: real reward captures weigh ~6 MB and do not fit in the repo
 * geometry MEASURED on a real 2560x1440 capture: names row at y≈593 (41 % of the height), card text from x≈666 to x≈1907
 * what matters are the DECOYS: the bottom HUD (squad names, bonus, kill feed) has MORE text mass than four item names
 */

/** deterministic PRNG (mulberry32), like the inventory frame generator */
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * fills a rectangle with vertical strokes that mimic glyphs; both rules matter or detection sees nothing at 1440p:
 * - the stroke width scales with the text height, a fixed 3-on/2-off averages to flat grey after the 480px downscale
 * - the stroke width VARIES: a perfectly periodic pattern aliases against the `strideX` row profile sampling
 */
function texto(data, width, x0, y0, x1, y1, [r, g, b], seed = 7) {
    const cuerpo = Math.max(4, y1 - y0);
    const rnd = mulberry32(seed + x0 + y0);
    for (let x = x0; x < x1;) {
        const trazo = Math.max(2, Math.round(cuerpo * (0.25 + rnd() * 0.45)));
        const hueco = Math.max(2, Math.round(cuerpo * (0.18 + rnd() * 0.35)));
        const hasta = Math.min(x1, x + trazo);
        for (let y = y0; y < y1; y++) {
            for (let xx = x; xx < hasta; xx++) {
                const i = (y * width + xx) * 4;
                data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
            }
        }
        x = hasta + hueco;
    }
}

/** solid rectangle (translucent card panels, background) */
function bloque(data, width, x0, y0, x1, y1, [r, g, b]) {
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
    }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.width=2560]
 * @param {number} [opts.height=1440]
 * @param {number} [opts.cards=4]
 * @param {boolean} [opts.hud=true]
 * @param {[number,number,number]} [opts.tinte]
 * @returns {{width:number, height:number, data:Uint8ClampedArray}}
 */
export function makeRewardFrame(opts = {}) {
    const {
        width = 2560, height = 1440, cards = 4, hud = true,
        tinte = [92, 38, 30],
    } = opts;

    const data = new Uint8ClampedArray(width * height * 4);
    bloque(data, width, 0, 0, width, height, tinte);

    const NARANJA = [240, 134, 17];   // theme text (Default)
    const CREMA = [236, 230, 214];    // item names
    const PANEL = [38, 26, 24];       // translucent card panel

    // card row: centered, half the width (measured on the real capture)
    const filaX0 = Math.round(width * 0.26);
    const filaX1 = Math.round(width * 0.75);
    const anchoCard = (filaX1 - filaX0) / cards;
    const nombreY = Math.round(height * 0.412);
    const altoTexto = Math.max(2, Math.round(height * 0.019));

    for (let i = 0; i < cards; i++) {
        const cx0 = Math.round(filaX0 + i * anchoCard);
        const cx1 = Math.round(filaX0 + (i + 1) * anchoCard) - 4;
        bloque(data, width, cx0, Math.round(height * 0.16), cx1, Math.round(height * 0.44), PANEL);
        // name: centered in its card, clear of the edges, like the game
        const margen = Math.round((cx1 - cx0) * 0.08);
        texto(data, width, cx0 + margen, nombreY, cx1 - margen, nombreY + altoTexto, CREMA);
        // "N Owned / Crafted" badge above the art
        texto(data, width, cx0 + margen, Math.round(height * 0.175),
            cx0 + margen + Math.round((cx1 - cx0) * 0.45), Math.round(height * 0.19), NARANJA);
    }

    if (!hud) return { data, width, height };

    // decoys, at the positions of the log that broke the crop

    // title bar "VOID FISSURE/REWARDS" at the very top: it came out as "1 cards y=0"
    texto(data, width, Math.round(width * 0.15), Math.round(height * 0.055),
        Math.round(width * 0.43), Math.round(height * 0.08), NARANJA);

    // squad names under the cards, Steel Path bonus and kill feed: TOGETHER more text mass than the four item names
    // they won by mass and made the scanner read "TheDeathstroke76 / Steel Path Bonus"
    for (let fila = 0; fila < 3; fila++) {
        const y = Math.round(height * (0.46 + fila * 0.028));
        texto(data, width, Math.round(width * 0.26), y,
            Math.round(width * 0.72), y + altoTexto, NARANJA);
    }
    for (let fila = 0; fila < 2; fila++) {
        const y = Math.round(height * (0.60 + fila * 0.03));
        texto(data, width, Math.round(width * 0.38), y,
            Math.round(width * 0.60), y + altoTexto, NARANJA);
    }

    return { data, width, height };
}
