function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// stroke scales with text height: fixed 3-on/2-off averages to flat grey after 480px downscale
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

function bloque(data, width, x0, y0, x1, y1, [r, g, b]) {
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
    }
}

export function makeRewardFrame(opts = {}) {
    const {
        width = 2560, height = 1440, cards = 4, hud = true,
        tinte = [92, 38, 30],
    } = opts;

    const data = new Uint8ClampedArray(width * height * 4);
    bloque(data, width, 0, 0, width, height, tinte);

    const NARANJA = [240, 134, 17];
    const CREMA = [236, 230, 214];
    const PANEL = [38, 26, 24];

    const filaX0 = Math.round(width * 0.26);
    const filaX1 = Math.round(width * 0.75);
    const anchoCard = (filaX1 - filaX0) / cards;
    const nombreY = Math.round(height * 0.412);
    const altoTexto = Math.max(2, Math.round(height * 0.019));

    for (let i = 0; i < cards; i++) {
        const cx0 = Math.round(filaX0 + i * anchoCard);
        const cx1 = Math.round(filaX0 + (i + 1) * anchoCard) - 4;
        bloque(data, width, cx0, Math.round(height * 0.16), cx1, Math.round(height * 0.44), PANEL);
        const margen = Math.round((cx1 - cx0) * 0.08);
        texto(data, width, cx0 + margen, nombreY, cx1 - margen, nombreY + altoTexto, CREMA);
        texto(data, width, cx0 + margen, Math.round(height * 0.175),
            cx0 + margen + Math.round((cx1 - cx0) * 0.45), Math.round(height * 0.19), NARANJA);
    }

    if (!hud) return { data, width, height };

    texto(data, width, Math.round(width * 0.15), Math.round(height * 0.055),
        Math.round(width * 0.43), Math.round(height * 0.08), NARANJA);

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
