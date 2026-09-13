/**
 * Dónde termina la cabecera del inventario (la fila de iconos), medido en la imagen.
 *
 * Al final de la lista (y al parar el scroll a media fila) el juego deja la primera fila debajo
 * del HUD: el nombre sigue a la vista, pero el badge de cantidad queda tapado por los iconos y
 * se leía basura ("Trumna BDG 86"), o nada. La altura del HUD cambia con la escala de interfaz,
 * así que se MIDE, y se mide donde no hay cards que confundan: en el margen que el recorte de
 * página deja por encima de la primera fila de la primera página de la sesión. Con las cards
 * dentro no vale: el arte claro de un casco alterna tanto como los iconos.
 */

/**
 * De una franja: qué fracción de columnas tiene algún píxel claro, y cuántas veces se alterna
 * claro/oscuro a lo ancho. Un casco blanco cubre mucho pero es UN bloque; la fila de iconos y
 * los rótulos cubren mucho Y alternan sin parar.
 */
export function brightProfile({ data, width, height }, minDelta = 45) {
    if (!width || !height) return { cover: 0, cambios: 0 };
    // "Claro" es relativo al FONDO de la banda: en el tema Stalker los iconos son rojo oscuro
    // (luma ~100 sobre ~20) y un umbral absoluto no los ve. El fondo es el nivel más oscuro con
    // presencia (≥10% de los píxeles), no la moda: una fila de iconos densa la ganaría.
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

// Medido sobre la zona (1662 px a 1440p): la fila de iconos cubre un 25-35% del ancho con
// 120-170 alternancias; los seis badges de una fila, un 12% con ~36; el arte que asoma por
// arriba puede cubrir la mitad, pero en seis bloques (≤24). Bandas de pocas filas para que una
// fila fina de iconos no se diluya.
export const HUD_MIN_COVER = 0.2;
export const HUD_MIN_CAMBIOS = 60;
const BANDA = 6;

/**
 * Borde inferior del HUD dentro de `img` (imagen de la zona desde su borde superior), o null si
 * ninguna banda cubre lo bastante. Es la banda MÁS BAJA que lo hace: la cabecera puede tener
 * varias (título, pestañas, iconos) y la que tapa el badge es la última.
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
