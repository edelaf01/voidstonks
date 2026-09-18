// detects where the inventory HUD icon row ends to avoid reading covered badges

export function brightProfile({ data, width, height }, minDelta = 45) {
    if (!width || !height) return { cover: 0, cambios: 0 };
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

// icon row covers 25-35% of width with alternations; a row's six badges ~12%
export const HUD_MIN_COVER = 0.2;
export const HUD_MIN_CAMBIOS = 60;
const BANDA = 6;

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
