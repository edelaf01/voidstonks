// generates UI text mask matching theme hue and local contrast across brightness levels

const TOL_SQ = 1944;
const RADIO = 7;
const CONTRASTE_MIN = 20;
const BRILLO_MIN = 40;

function integralLuma(data, w, h) {
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
        luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const suma = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            suma[(y + 1) * (w + 1) + x + 1] = luma[y * w + x] + suma[y * (w + 1) + x + 1]
                + suma[(y + 1) * (w + 1) + x] - suma[y * (w + 1) + x];
        }
    }
    return { luma, suma };
}

export function matchesThemeHue(r, g, b, theme) {
    const max = Math.max(r, g, b);
    if (max < BRILLO_MIN) return false;
    const escala = Math.max(theme.r, theme.g, theme.b) / max;
    const dr = r * escala - theme.r, dg = g * escala - theme.g, db = b * escala - theme.b;
    return dr * dr + dg * dg + db * db < TOL_SQ;
}

export function themeTextMask(imageData, themes) {
    const { data, width: w, height: h } = imageData;
    const { luma, suma } = integralLuma(data, w, h);
    const orden = Float32Array.from(luma).sort();
    const pct = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
    const minContraste = Math.min(CONTRASTE_MIN, Math.max(6, (pct(0.99) - pct(0.5)) * 0.12));
    let marcados = 0;
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let texto = false;
            for (const t of themes) {
                if (matchesThemeHue(data[i], data[i + 1], data[i + 2], t)) { texto = true; break; }
            }
            if (texto) {
                const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
                const media = (suma[yb * (w + 1) + xb] - suma[ya * (w + 1) + xb]
                    - suma[yb * (w + 1) + xa] + suma[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
                // relative to local level because dark themes have half the absolute luma difference
                const l = luma[y * w + x];
                texto = l - media > Math.max(6, Math.min(minContraste, media * 0.25));
            }
            if (texto) marcados++;
            data[i] = data[i + 1] = data[i + 2] = texto ? 0 : 255;
        }
    }
    return marcados;
}
