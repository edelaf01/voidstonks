// locates where the item label starts inside a mission complete cell from the mask

const LINEA_MIN = 0.04;
const LINEA_MAX = 0.13;
const HUECO_MAX = 0.06;
const BLANCO_REL = 0.3;
const TECHO = 0.45;
const SUELO = 0.955;
// drops the cell bottom edge, a 1-2 row strip that otherwise left the whole label out
const TINTA_MIN = 0.04;

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
    return Math.max(0, Math.round(top - h * 0.05));
}
