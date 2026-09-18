/**
 * Where the label starts inside a MISSION COMPLETE cell, from the mask. The mask is made by the theme color,
 * and on golden themes the icon art (a Larkspur, a relic) has that same color, so Tesseract got the whole
 * drawing on top of the name.
 *
 * The label is one to three text lines against the bottom edge: ink bands are walked bottom up and accepted
 * while they have line height and line spacing; whatever is above is art.
 */

/** Band height to be a text line (a line is ~0.09 of the height). */
const LINEA_MIN = 0.04;
const LINEA_MAX = 0.13;
/** Maximum gap between two lines of the same label. */
const HUECO_MAX = 0.06;
/** Fraction of the densest row under which a row counts as blank. */
const BLANCO_REL = 0.3;
/**
 * Strip where the label can be: three lines start at 0.59 and the last ends at 0.95. Below is the cell's
 * bottom edge, theme colored on golden themes, which passed for a text line.
 */
const TECHO = 0.45;
const SUELO = 0.955;
/**
 * Minimum ink in the densest row to count as a line (width fraction). With LINEA_MIN it drops the cell's
 * bottom edge, a 1-2 row strip that, taken as a line, left the whole label out.
 */
const TINTA_MIN = 0.04;

/**
 * @param {Uint8Array} mask 1 = text pixel, w*h
 * @returns {number} row (px) where the label starts, or 0 when none stands out
 */
export function labelTop(mask, w, h) {
    const desde = Math.floor(h * TECHO), hasta = Math.floor(h * SUELO);
    const filas = new Uint32Array(h);
    let pico = 0;
    for (let y = desde; y < hasta; y++) {
        let tinta = 0;
        for (let x = 0; x < w; x++) tinta += mask[y * w + x];
        filas[y] = tinta;
        if (tinta > pico) pico = tinta;
    }
    // "blank row" is relative to the densest one: art reaching the label leaves far fewer pixels per row than a
    // text line, and with blank = 0 both merged into one band
    const blanco = pico * BLANCO_REL;
    const bandas = [];
    let abierta = null;
    for (let y = desde; y < hasta; y++) {
        const tinta = filas[y];
        if (tinta > blanco) {
            if (abierta) { abierta[1] = y; abierta[2] = Math.max(abierta[2], tinta); } else abierta = [y, y, tinta];
        } else if (abierta) { bandas.push(abierta); abierta = null; }
    }
    if (abierta) bandas.push(abierta);

    let top = null, siguiente = null;
    for (let i = bandas.length - 1; i >= 0; i--) {
        const [y0, y1, max] = bandas[i];
        if (max < w * TINTA_MIN || y1 - y0 + 1 < h * LINEA_MIN) continue;
        if (y1 - y0 + 1 > h * LINEA_MAX) break;
        if (siguiente !== null && siguiente - y1 > h * HUECO_MAX) break;
        top = y0;
        siguiente = y0;
    }
    if (top === null) return 0;
    // margin on top: the band starts where the ink passes the threshold, and the tall strokes of the first line
    // sit a few rows higher
    return Math.max(0, Math.round(top - h * 0.05));
}
