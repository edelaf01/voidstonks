/**
 * Cheap hint that the frame is the PAUSE menu, so the menu OCR is not paid on every poll while the player is
 * just playing. Darkness is no signal: the menu crop mean luma overlaps mission complete and red themed relic
 * screens. What separates with margin is the STRUCTURE: 9 menu rows (RESUME … ABORT MISSION) at a constant
 * step.
 */
import { sharedFrame } from "./frame_freeze.js";

/** Vertical strip over the menu text, in frame fractions, sampled at cols×rows. */
export const FRANJA_MENU_PAUSA = Object.freeze({ x: 0.15, y: 0.27, w: 0.06, h: 0.54, cols: 24, filas: 144 });

const HITS_MIN = 2;
// the red menu text has luma ≈ 80 (R≈200, G,B≈30): invisible by luma, visible by max(R,G,B). The threshold
// adapts to the background because a bright mission under the pause veil raises the median
const UMBRAL_MIN = 60, MARGEN_UMBRAL = 50;
const BANDAS = [8, 10], ALTURA = [4, 14], PASO = [11, 19];

let franjaCvs = null;

/** max(R,G,B) per sample of the menu strip; own canvas, reused. */
export function muestreaFranjaMenu(video, franja = FRANJA_MENU_PAUSA) {
    if (!franjaCvs) franjaCvs = document.createElement("canvas");
    if (franjaCvs.width !== franja.cols || franjaCvs.height !== franja.filas) { franjaCvs.width = franja.cols; franjaCvs.height = franja.filas; }
    const ctx = franjaCvs.getContext("2d", { willReadFrequently: true });
    const W = video.videoWidth, H = video.videoHeight;
    ctx.drawImage(sharedFrame(video), Math.floor(W * franja.x), Math.floor(H * franja.y), Math.floor(W * franja.w), Math.floor(H * franja.h), 0, 0, franja.cols, franja.filas);
    const px = ctx.getImageData(0, 0, franja.cols, franja.filas).data;
    const out = new Uint8Array(franja.cols * franja.filas);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    return out;
}

/** Adaptive threshold: median + MARGIN with UMBRAL_MIN as floor (histogram, no sorting). */
export function umbralTexto(muestras) {
    const hist = new Uint32Array(256);
    for (const v of muestras) hist[v]++;
    let acumulado = 0, mediana = 0;
    for (let v = 0; v < 256; v++) { acumulado += hist[v]; if (acumulado * 2 >= muestras.length) { mediana = v; break; } }
    return Math.max(UMBRAL_MIN, mediana + MARGEN_UMBRAL);
}

/** Bands [{ini, fin}] of rows with ≥ HITS_MIN samples above the threshold; a one row gap does not split. */
export function bandasDeTexto(muestras, cols, filas, umbral) {
    const conTexto = new Uint8Array(filas);
    for (let y = 0; y < filas; y++) {
        let n = 0;
        for (let x = 0; x < cols; x++) if (muestras[y * cols + x] > umbral) n++;
        conTexto[y] = n >= HITS_MIN ? 1 : 0;
    }
    const bandas = [];
    let ini = -1;
    for (let y = 0; y <= filas; y++) {
        const on = y < filas && (conTexto[y] || (ini >= 0 && y + 1 < filas && conTexto[y + 1]));
        if (on && ini < 0) ini = y;
        else if (!on && ini >= 0) { bandas.push({ ini, fin: y - 1 }); ini = -1; }
    }
    return bandas;
}

/** { ok, bandas, alturas, pasos, umbral }: pure, for the test and for the log. */
export function pareceMenuPausa(muestras, { cols, filas } = FRANJA_MENU_PAUSA) {
    const umbral = umbralTexto(muestras);
    const bandas = bandasDeTexto(muestras, cols, filas, umbral);
    const alturas = bandas.map((b) => b.fin - b.ini + 1);
    const centros = bandas.map((b) => (b.ini + b.fin) / 2);
    const pasos = centros.slice(1).map((c, i) => c - centros[i]);
    const ok = bandas.length >= BANDAS[0] && bandas.length <= BANDAS[1]
        && alturas.every((a) => a >= ALTURA[0] && a <= ALTURA[1])
        && pasos.every((p) => p >= PASO[0] && p <= PASO[1]);
    return { ok, bandas: bandas.length, alturas, pasos, umbral };
}

export function hayPistaMenuPausa(video) { return pareceMenuPausa(muestreaFranjaMenu(video)); }
