/**
 * Where the inventory header (the icon row) ends, measured in the image. At the end of the list (and when
 * scrolling stops mid row) the game leaves the first row under the HUD: the name stays visible but the
 * quantity badge is covered by the icons and read as garbage, or nothing.
 *
 * The HUD height changes with the UI scale, so it is MEASURED, where no cards confuse it: in the margin the
 * page crop leaves above the first row of the session's first page. The light art of a helmet alternates as
 * much as the icons.
 */

/**
 * Of a strip: what fraction of columns has some light pixel, and how many times light/dark alternates across
 * the width. A white helmet covers a lot but is ONE block; the icon row and labels cover a lot AND keep
 * alternating.
 */
export function brightProfile({ data, width, height }, minDelta = 45) {
    if (!width || !height) return { cover: 0, cambios: 0 };
    // "light" is relative to the band BACKGROUND: on the Stalker theme icons are dark red and an absolute
    // threshold misses them. The background is the darkest level with presence (≥10% of the pixels), not the
    // mode, which a dense icon row would win
    const lum = new Uint8Array(width * height), hist = new Uint32Array(32);
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
        lum[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        hist[lum[p] >> 3]++;
    }
    let fondo = 31;
    for (let k = 0; k < 32; k++) if (hist[k] >= lum.length * 0.1) { fondo = k; break; }
    const umbral = (fondo << 3) + 4 + minDelta;
    let cols = 0, cambios = 0, prev = false;
    for (let x = 0; x < width; x++) {
        let claro = false;
        for (let y = 0; y < height && !claro; y++) claro = lum[y * width + x] >= umbral;
        if (claro) cols++;
        if (claro !== prev) { cambios++; prev = claro; }
    }
    return { cover: cols / width, cambios };
}

export function brightColumnCoverage(img, minDelta = 45) { return brightProfile(img, minDelta).cover; }

// the icon row covers 25-35% of the width with many alternations; a row's six badges ~12%; art peeking from
// above can cover half, but in six blocks. Bands of few rows so a thin icon row is not diluted
export const HUD_MIN_COVER = 0.2;
export const HUD_MIN_CAMBIOS = 60;
const BANDA = 6;

/**
 * Bottom edge of the HUD inside `img` (zone image from its top edge), or null when no band covers enough.
 * The LOWEST band that does: the header can have several (title, tabs, icons) and the one covering the badge
 * is the last.
 */
export function hudBottom(img, minCover = HUD_MIN_COVER) {
    const { data, width, height } = img;
    let fondo = null;
    for (let y = 0; y + BANDA <= height; y += BANDA) {
        const banda = { data: data.subarray(y * width * 4, (y + BANDA) * width * 4), width, height: BANDA };
        const { cover, cambios } = brightProfile(banda);
        if (cover >= minCover && cambios >= HUD_MIN_CAMBIOS) fondo = y + BANDA;
    }
    return fondo;
}
