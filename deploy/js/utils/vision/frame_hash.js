/**
 * Cheap image hashes to tell whether the screen CHANGED, so the scanner skips the OCR while the player does
 * nothing. Always a 16×9 gray thumbnail in hex, compared by DISTANCE, not equality: with compressed video two
 * frames of a still screen are never bit identical.
 */

// 16x9 canvas shared by every hash, to avoid GC churn
let tinyCvs = null;

function tinyCtx() {
    if (!tinyCvs) {
        tinyCvs = document.createElement("canvas");
        tinyCvs.width = 16;
        tinyCvs.height = 9;
    }
    return tinyCvs.getContext("2d", { willReadFrequently: true });
}

function hashFromTiny(ctx) {
    const d = ctx.getImageData(0, 0, 16, 9).data;
    let hash = "";
    for (let i = 0; i < d.length; i += 4) {
        const avg = Math.floor((d[i] + d[i + 1] + d[i + 2]) / 3);
        hash += avg.toString(16).padStart(2, "0");
    }
    return hash;
}

/**
 * Hash of a FIXED video region (rect relative 0..1 over videoWidth/Height). The video rect and not the tight
 * crop, whose width jitters between frames even on a still screen, so its hash never matched.
 */
export function videoRegionHash(video, crop) {
    const ctx = tinyCtx();
    ctx.drawImage(video,
        Math.floor(video.videoWidth * crop.x), Math.floor(video.videoHeight * crop.y),
        Math.floor(video.videoWidth * crop.w), Math.floor(video.videoHeight * crop.h),
        0, 0, 16, 9);
    return hashFromTiny(ctx);
}

/** Hash of a pixel rect of a canvas (a mission end cell). */
export function canvasRegionHash(canvas, rect) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, 16, 9);
    return hashFromTiny(ctx);
}

/** Hash of an already prepared canvas (e.g. the header strip). */
export function smallCanvasHash(canvas) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 16, 9);
    return hashFromTiny(ctx);
}

let miniCvs = null;
let regionCvs = null;

function lumaDe(ctx, w, h) {
    const px = ctx.getImageData(0, 0, w, h).data;
    const luma = new Uint8Array(w * h);
    for (let i = 0; i < luma.length; i++) luma[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    return luma;
}

/**
 * `w`×`h` thumbnail of the whole video and its per pixel luma, to compare with `fraccionCambiada`. The canvas
 * is reused.
 */
export function miniaturaLuma(video, w, h) {
    if (!miniCvs) miniCvs = document.createElement("canvas");
    if (miniCvs.width !== w || miniCvs.height !== h) { miniCvs.width = w; miniCvs.height = h; }
    const ctx = miniCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, w, h);
    return { cvs: miniCvs, luma: lumaDe(ctx, w, h) };
}

/**
 * Luma of a REGION of `source` (fractions of its size) sampled at `rect.cols`×`rect.filas`. Own canvas: the
 * recorder uses the thumbnail one every frame at another size.
 */
export function regionLuma(source, rect) {
    const W = source.videoWidth || source.width, H = source.videoHeight || source.height;
    if (!regionCvs) regionCvs = document.createElement("canvas");
    if (regionCvs.width !== rect.cols || regionCvs.height !== rect.filas) { regionCvs.width = rect.cols; regionCvs.height = rect.filas; }
    const ctx = regionCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, Math.floor(W * rect.x), Math.floor(H * rect.y), Math.floor(W * rect.w), Math.floor(H * rect.h), 0, 0, rect.cols, rect.filas);
    return lumaDe(ctx, rect.cols, rect.filas);
}

let maxCanalCvs = null;

/**
 * Mean of the max channel per cell: the red text of some themes has almost no luma. Averaged here at `sub`
 * times the resolution so it does not depend on browser rescaling.
 */
export function muestraMaxCanal(source, rect, cols, filas, sub = 4) {
    const W = source.videoWidth || source.width, H = source.videoHeight || source.height;
    if (!W || !H) return null;
    const cw = cols * sub, ch = filas * sub;
    if (!maxCanalCvs) maxCanalCvs = document.createElement("canvas");
    if (maxCanalCvs.width !== cw || maxCanalCvs.height !== ch) { maxCanalCvs.width = cw; maxCanalCvs.height = ch; }
    const ctx = maxCanalCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, Math.floor(W * rect.x), Math.floor(H * rect.y), Math.floor(W * rect.w), Math.floor(H * rect.h), 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    const out = new Float32Array(cols * filas);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        out[Math.floor(y / sub) * cols + Math.floor(x / sub)] += Math.max(px[i], px[i + 1], px[i + 2]);
    }
    for (let k = 0; k < out.length; k++) out[k] /= sub * sub;
    return out;
}

/**
 * Fraction of samples changing more than `umbral` between two reads of the SAME region. Summed brightness
 * cannot tell one relic page from another (same cards, other text).
 */
export function fraccionCambiada(a, b, umbral = 24) {
    if (!a || !b || a.length !== b.length) return 1;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > umbral) n++;
    return n / a.length;
}

/**
 * Same screen? Compares the MEAN difference per sample, not equality. The default tolerance 18 is for full
 * riven/inventory screens; the HEADER skip uses 6 because the title is thin text.
 */
export function compareHashes(hash1, hash2, tolerance = 18) {
    if (!hash1 || !hash2) return false;
    if (hash1.length !== hash2.length) return false;
    let diff = 0;
    for (let i = 0; i < hash1.length; i += 2) {
        diff += Math.abs(
            parseInt(hash1.substring(i, i + 2), 16) - parseInt(hash2.substring(i, i + 2), 16),
        );
    }
    return diff / (hash1.length / 2) < tolerance;
}

// on the cycling screen a 1 px shift or a stream rescale changes ~0 % of the samples, other stats ~2 %,
// another roll ~10 %
const FIRMA_COLS = 96, FIRMA_FILAS = 36, FIRMA_UMBRAL = 16, FIRMA_CORTE = 0.005;
let firmaCvs = null;

/**
 * Fingerprint of a zone with TEXT (riven cards), which the 16×9 hash misses: new stats barely move its mean.
 * HIGH smoothing on purpose: a low one samples instead of averaging and a 1 px shift already changes it.
 */
export function firmaTexto(source, crop) {
    // one fingerprint per card, concatenated: with another card count the lengths do not match
    if (Array.isArray(crop)) {
        const partes = crop.map((c) => firmaTexto(source, c));
        const todo = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
        partes.reduce((o, p) => { todo.set(p, o); return o + p.length; }, 0);
        return todo;
    }
    if (!firmaCvs) {
        firmaCvs = document.createElement("canvas");
        firmaCvs.width = FIRMA_COLS;
        firmaCvs.height = FIRMA_FILAS;
    }
    const ctx = firmaCvs.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const W = source.videoWidth || source.width, H = source.videoHeight || source.height;
    ctx.drawImage(source, Math.floor(W * crop.x), Math.floor(H * crop.y), Math.floor(W * crop.w), Math.floor(H * crop.h),
        0, 0, FIRMA_COLS, FIRMA_FILAS);
    return lumaDe(ctx, FIRMA_COLS, FIRMA_FILAS);
}

export function mismoTexto(a, b) {
    return fraccionCambiada(a, b, FIRMA_UMBRAL) < FIRMA_CORTE;
}
