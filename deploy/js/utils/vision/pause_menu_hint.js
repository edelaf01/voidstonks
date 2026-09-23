/**
 * Pista barata de que el frame es el menú de PAUSA, para no pagar el OCR del menú en cada
 * sondeo mientras el jugador simplemente juega.
 *
 * La oscuridad no sirve de señal: la luma media del recorte del menú da 10–23 en las pausas del
 * corpus pero también 14–51 en fin de misión y 20–22 en reliquias con tema rojo. Lo que separa
 * con margen es la ESTRUCTURA: 9 filas de menú (RESUME … ABORT MISSION) a paso constante.
 * Medido en 4 pausas y 29 pantallas reales (tests/pause-menu-hint.test.mjs): las pausas dan 9
 * bandas de 7–11 filas a paso 14,5–16; el negativo más cercano (celdas de inventario) tiene bandas
 * de 17+ filas y pasos de 21.
 */

/** Franja vertical sobre el texto del menú, en fracciones del frame, muestreada a cols×filas. */
export const FRANJA_MENU_PAUSA = Object.freeze({ x: 0.15, y: 0.27, w: 0.06, h: 0.54, cols: 24, filas: 144 });

const HITS_MIN = 2;
// El texto rojo del menú tiene luma ≈ 80 (R≈200, G,B≈30): por luma no se ve, por max(R,G,B) sí.
// Y el umbral se adapta al fondo porque una misión clara bajo el velo de pausa sube la mediana.
const UMBRAL_MIN = 60, MARGEN_UMBRAL = 50;
const BANDAS = [8, 10], ALTURA = [4, 14], PASO = [11, 19];

let franjaCvs = null;

/** max(R,G,B) por muestra de la franja del menú; canvas propio reutilizado. */
export function muestreaFranjaMenu(video, franja = FRANJA_MENU_PAUSA) {
    if (!franjaCvs) franjaCvs = document.createElement("canvas");
    if (franjaCvs.width !== franja.cols || franjaCvs.height !== franja.filas) { franjaCvs.width = franja.cols; franjaCvs.height = franja.filas; }
    const ctx = franjaCvs.getContext("2d", { willReadFrequently: true });
    const W = video.videoWidth, H = video.videoHeight;
    ctx.drawImage(video, Math.floor(W * franja.x), Math.floor(H * franja.y), Math.floor(W * franja.w), Math.floor(H * franja.h), 0, 0, franja.cols, franja.filas);
    const px = ctx.getImageData(0, 0, franja.cols, franja.filas).data;
    const out = new Uint8Array(franja.cols * franja.filas);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    return out;
}

/** Umbral adaptativo: mediana + MARGEN con suelo UMBRAL_MIN (histograma, sin ordenar). */
export function umbralTexto(muestras) {
    const hist = new Uint32Array(256);
    for (const v of muestras) hist[v]++;
    let acumulado = 0, mediana = 0;
    for (let v = 0; v < 256; v++) { acumulado += hist[v]; if (acumulado * 2 >= muestras.length) { mediana = v; break; } }
    return Math.max(UMBRAL_MIN, mediana + MARGEN_UMBRAL);
}

/** Bandas [{ini, fin}] de filas con ≥ HITS_MIN muestras por encima del umbral; un hueco de una fila no parte. */
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

/** { ok, bandas, alturas, pasos, umbral }: puro, para el test y para el log. */
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
