/**
 * Preprocessing of the rewards crop for the OCR. Plain arithmetic and not `ctx.filter` so tests can run it:
 * CSS grayscale uses luminance weights and with the game's red tint the text ends up at its background level.
 */
import { inkRunRatio } from "./ink_runs.js";

/** Chromatic distance to the measured color and luma floor. */
const TEMA_DIST = 0.36;
const TEMA_LUMA_MIN = 40;
/**
 * Luma ceilings to try, in times the measured color's: card art has veins much brighter than the label in
 * the same hue. No single value works for every screen, the mask that looks most like text wins.
 */
const TECHOS = [Infinity, 1.3];
/**
 * Minimum ink for a mask to compete: `inkRunRatio` counts runs PER ink pixel, so an almost erased mask
 * scores very high. The four labels of a screen take 2.4-4.8% of the crop.
 */
const TINTA_MIN = 0.01;
/** Label strip heights to try, as a fraction of the crop height. */
const ALTURAS_ROTULO = [0.10, 0.14, 0.18];
const RADIO = 5;
/** Minimum votes for a theme to compete: below that they are stray art pixels. */
const VOTOS_MIN = 30;
/**
 * How much a pixel must stand out from its neighbourhood to count as a stroke, as a percentile of the crop
 * itself, never absolute. `PCT_TINTA` is the mask's; `PCTS_VOTO` the voting ones, each gives a different
 * color estimate and all are tried.
 */
const PCT_TINTA = 0.5;
const PCTS_VOTO = [0.75, 0.85, 0.92];

/**
 * How much each pixel stands out from its neighbourhood, and the percentile of that measure. Every contrast
 * threshold comes from here, RELATIVE to the crop: a fixed one wipes faint labels in dark captures and lets
 * the background through in light ones.
 */
function analisisLocal(px, w, h) {
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) {
        luma[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const sum = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            sum[(y + 1) * (w + 1) + x + 1] = luma[y * w + x] + sum[y * (w + 1) + x + 1]
                + sum[(y + 1) * (w + 1) + x] - sum[y * (w + 1) + x];
        }
    }
    const exceso = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
            const media = (sum[yb * (w + 1) + xb] - sum[ya * (w + 1) + xb]
                - sum[yb * (w + 1) + xa] + sum[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
            exceso[y * w + x] = luma[y * w + x] - media;
        }
    }
    const pos = Float32Array.from(exceso.filter((v) => v > 0)).sort();
    const umbral = (q) => (pos.length ? pos[Math.min(pos.length - 1, Math.floor(pos.length * q))] : 0);
    return { exceso, umbral };
}

let colorCache = null;

/** Called by the scanner on context change: the color can only change with the screen. */
export function olvidaColorTexto() { colorCache = null; }

/**
 * Real color of the most voted theme among the pixels that stand out: votes by HUE (brightness varies with
 * opacity) and returns the MEDIAN of the winning theme's real pixels.
 */
function votaColor(px, w, h, temas, exceso, minVoto) {
    const votos = new Map();
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const mx = Math.max(px[i], px[i + 1], px[i + 2]);
        if (mx < TEMA_LUMA_MIN || exceso[p] < minVoto) continue;
        let mejor = -1, dMin = Infinity;
        for (let t = 0; t < temas.length; t++) {
            const e = Math.max(temas[t].r, temas[t].g, temas[t].b) / mx;
            const d = Math.abs(px[i] * e - temas[t].r) + Math.abs(px[i + 1] * e - temas[t].g)
                + Math.abs(px[i + 2] * e - temas[t].b);
            if (d < dMin) { dMin = d; mejor = t; }
        }
        if (dMin > 120) continue;
        if (!votos.has(mejor)) votos.set(mejor, { r: [], g: [], b: [] });
        const v = votos.get(mejor);
        v.r.push(px[i]); v.g.push(px[i + 1]); v.b.push(px[i + 2]);
    }
    let gana = null, top = VOTOS_MIN;
    for (const [, v] of votos) if (v.r.length > top) { top = v.r.length; gana = v; }
    if (!gana) return null;
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return [med(gana.r), med(gana.g), med(gana.b)];
}

/** Is pixel `i` of color `col` (similar hue and brightness) and does it stand out from its neighbourhood? */
function esTexto(px, i, col, cl, techo, destaca) {
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (!(lum > TEMA_LUMA_MIN) || lum > cl * techo || !destaca) return false;
    const dr = px[i] / lum - col[0] / cl, dg = px[i + 1] / lum - col[1] / cl,
        db = px[i + 2] / lum - col[2] / cl;
    return Math.sqrt(dr * dr + dg * dg + db * db) < TEMA_DIST;
}

/** How much a candidate mask looks like TEXT; 0 with too little ink to be the label (see `TINTA_MIN`). */
export function puntuaMascara(m, tinta, w, h) {
    return tinta < w * h * TINTA_MIN ? 0 : inkRunRatio(m, w, h);
}

/** Mask of color `col`, and how many pixels it marked. */
function mascaraColor(px, w, h, col, exceso, minTinta, techo) {
    const cl = (col[0] + col[1] + col[2]) / 3 || 1;
    const m = new Uint8Array(w * h * 4).fill(255);
    let tinta = 0;
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (esTexto(px, i, col, cl, techo, exceso[p] > minTinta)) { m[i] = m[i + 1] = m[i + 2] = 0; tinta++; }
    }
    return { m, tinta };
}

/**
 * Mask WITHOUT color: only "stands out from its neighbourhood". Competes with the color ones when voting
 * finds no theme; a GLOBAL brightness cut would keep the art (the brightest) and dissolve the label.
 */
function mascaraContraste(px, w, h, exceso, minTinta) {
    const m = new Uint8Array(w * h * 4).fill(255);
    let tinta = 0;
    for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (lum > TEMA_LUMA_MIN && exceso[p] > minTinta) { m[i] = m[i + 1] = m[i + 2] = 0; tinta++; }
    }
    return { m, tinta };
}

export function colorDelTexto(px, w, h, temas, local = null) {
    // the screen is reread every 800 ms with three presets. `false` = measured and no theme color, `null` =
    // not measured
    if (colorCache !== null) return colorCache || null;
    const { exceso, umbral } = local || analisisLocal(px, w, h);
    const minTinta = umbral(PCT_TINTA);
    let mejor = null, mejorRatio = 0;
    // the mask with the most ink runs per pixel wins: letters are many short strokes per row, art and tinted
    // background few long ones (ink_runs.js)
    const vistos = new Set();
    const prueba = (col) => {
        if (!col || vistos.has(col.join())) return;
        vistos.add(col.join());
        for (const techo of TECHOS) {
            const { m, tinta } = mascaraColor(px, w, h, col, exceso, minTinta, techo);
            const ratio = puntuaMascara(m, tinta, w, h);
            if (ratio > mejorRatio) { mejorRatio = ratio; mejor = { color: col, techo }; }
        }
    };
    for (const q of PCTS_VOTO) prueba(votaColor(px, w, h, temas, exceso, umbral(q)));
    // contrast competes too: if no color mask beats it there is no theme color to isolate
    {
        const { m, tinta } = mascaraContraste(px, w, h, exceso, minTinta);
        const ratio = puntuaMascara(m, tinta, w, h);
        if (ratio > mejorRatio) { mejorRatio = ratio; mejor = { color: null, techo: Infinity }; }
    }
    if (!mejor) { colorCache = false; return null; }
    colorCache = mejor;
    return colorCache;
}

/**
 * The LABEL strip inside a crop, in crop rows. The crop holds the whole card and the art spoils anything
 * measured globally, and Tesseract does not segment the text with the art around.
 *
 * `inkRunRatio` PER STRIP over the CONTRAST mask, the only one holding the text when art and label share a
 * hue. Several heights are swept because the label height depends on the UI scale and the line count.
 */
export function franjaDeRotulo(px, w, h, { alturas = ALTURAS_ROTULO } = {}) {
    if (!w || !h) return null;
    const { exceso, umbral } = analisisLocal(px, w, h);
    const { m } = mascaraContraste(px, w, h, exceso, umbral(PCT_TINTA));
    let mejor = null, mejorR = 0;
    for (const frac of alturas) {
        const alto = Math.max(8, Math.round(h * frac));
        if (alto >= h) continue;
        for (let y = 0; y + alto <= h; y += Math.max(2, alto >> 2)) {
            const sub = m.subarray(y * w * 4, (y + alto) * w * 4);
            let tinta = 0;
            for (let i = 0; i < sub.length; i += 4) if (sub[i] < 128) tinta++;
            const r = puntuaMascara(sub, tinta, w, alto);
            if (r > mejorR) { mejorR = r; mejor = { y0: y, y1: y + alto }; }
        }
    }
    return mejor;
}

export const REWARD_PRESETS = {
    STANDARD: { contraste: 4.0, brillo: 1.3 },
    LOW_LIGHT: { contraste: 3.2, brillo: 1.9 },
    HIGH_GLARE: { contraste: 2.6, brillo: 0.85 },
};

export function maxChannelPreset(ctx, width, height, preset = "STANDARD", temas = null) {
    // "COLOR" = crop as is, for the network engine that reads color directly
    if (!width || !height || preset === "COLOR") return;
    const { contraste, brillo } = REWARD_PRESETS[preset] || REWARD_PRESETS.STANDARD;
    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data;
    // hue is NOT enough: the game tints the background in the theme color, what tells a letter apart is
    // standing out from its neighbourhood. Without a measured color it falls back to the max channel
    const local = temas && temas.length ? analisisLocal(px, width, height) : null;
    const elegido = local ? colorDelTexto(px, width, height, temas, local) : null;
    const color = elegido?.color || null;
    const minTinta = local ? local.umbral(PCT_TINTA) : 0;
    const cl = color ? (color[0] + color[1] + color[2]) / 3 || 1 : 1;
    for (let p = 0, i = 0; i < px.length; i += 4, p++) {
        let v;
        if (color) {
            v = esTexto(px, i, color, cl, elegido.techo, local.exceso[p] > minTinta) ? 1 : 0;
        } else if (elegido) {
            // the contrast mask won: the threshold is the crop's own percentile, not an absolute brightness
            const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
            v = lum > TEMA_LUMA_MIN && local.exceso[p] > minTinta ? 1 : 0;
        } else {
            v = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
            v = Math.min(1, Math.max(0, (v - 0.5) * contraste + 0.5)) * brillo;
        }
        px[i] = px[i + 1] = px[i + 2] = Math.min(255, Math.max(0, Math.round(v * 255)));
    }
    ctx.putImageData(img, 0, 0);
}
