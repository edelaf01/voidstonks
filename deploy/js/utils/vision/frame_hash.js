/**
 * Hashes baratos de imagen para saber si la pantalla ha CAMBIADO.
 *
 * El escáner los usa para saltarse el OCR mientras el jugador no toca nada: reconocer una
 * carta cuesta cientos de ms y la pantalla suele estar quieta.
 *
 * Se hashea siempre una miniatura de 16×9 en gris, en hexadecimal, para que dos hashes se
 * puedan comparar por DISTANCIA y no por igualdad: con vídeo comprimido dos frames de una
 * pantalla estática nunca salen idénticos bit a bit.
 */

// Canvas 16x9 reutilizado por todos los hashes: crear uno nuevo por llamada (cada 400 ms)
// generaba churn de GC para nada.
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
 * Hash de una REGIÓN FIJA del vídeo (rect relativo 0..1 sobre videoWidth/Height).
 *
 * Se hashea el rect del vídeo y no el recorte ya ajustado porque los canvases
 * tight-cropped jitteran de ancho entre frames (749–1538 px con la pantalla QUIETA), así
 * que un hash calculado sobre ellos no coincidía nunca: el skip no enganchaba jamás y se
 * re-OCReaba cada frame.
 */
export function videoRegionHash(video, crop) {
    const ctx = tinyCtx();
    ctx.drawImage(video,
        Math.floor(video.videoWidth * crop.x), Math.floor(video.videoHeight * crop.y),
        Math.floor(video.videoWidth * crop.w), Math.floor(video.videoHeight * crop.h),
        0, 0, 16, 9);
    return hashFromTiny(ctx);
}

/** Hash de un rectángulo en píxeles de un canvas (una casilla de fin de misión). */
export function canvasRegionHash(canvas, rect) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, 16, 9);
    return hashFromTiny(ctx);
}

/** Hash de un canvas ya preparado (p. ej. la franja del header). */
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

/** Miniatura `w`×`h` del vídeo entero y su luma por píxel, para comparar con `fraccionCambiada`. El canvas se reutiliza. */
export function miniaturaLuma(video, w, h) {
    if (!miniCvs) miniCvs = document.createElement("canvas");
    if (miniCvs.width !== w || miniCvs.height !== h) { miniCvs.width = w; miniCvs.height = h; }
    const ctx = miniCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, w, h);
    return { cvs: miniCvs, luma: lumaDe(ctx, w, h) };
}

/**
 * Luma de una REGIÓN de `source` (fracciones de su tamaño) muestreada a `rect.cols`×`rect.filas`.
 * Canvas propio: el de la miniatura lo usa la grabadora cada frame con otro tamaño.
 */
export function regionLuma(source, rect) {
    const W = source.videoWidth || source.width, H = source.videoHeight || source.height;
    if (!regionCvs) regionCvs = document.createElement("canvas");
    if (regionCvs.width !== rect.cols || regionCvs.height !== rect.filas) { regionCvs.width = rect.cols; regionCvs.height = rect.filas; }
    const ctx = regionCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, Math.floor(W * rect.x), Math.floor(H * rect.y), Math.floor(W * rect.w), Math.floor(H * rect.h), 0, 0, rect.cols, rect.filas);
    return lumaDe(ctx, rect.cols, rect.filas);
}

/**
 * Fracción de muestras que cambian más de `umbral` entre dos lecturas de la MISMA región.
 *
 * Sumar el brillo no distingue una página de reliquias de otra (mismas cards, otro texto). Medido:
 * misma página 0,0%, reliquias 2,8%, página distinta ≥13% — de ahí el corte del 1% del escáner.
 */
export function fraccionCambiada(a, b, umbral = 24) {
    if (!a || !b || a.length !== b.length) return 1;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > umbral) n++;
    return n / a.length;
}

/**
 * ¿Son la misma pantalla? Compara la diferencia MEDIA por muestra, no la igualdad.
 *
 * tolerance 18 (por defecto) vale para pantallas completas de riven/inventario; el skip
 * del HEADER usa 6, porque el título es texto fino y con 18 los cambios de pantalla se
 * colaban como "no ha cambiado nada".
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

// Medido sobre capturas de la pantalla de ciclar a 1440p: desplazar 1 px o reescalar el stream
// cambia el 0,0 % de las muestras; otras tres líneas de stats, el 1,9 %; otra tirada o quitar la
// carta lateral, el 10-11 %.
const FIRMA_COLS = 96, FIRMA_FILAS = 36, FIRMA_UMBRAL = 16, FIRMA_CORTE = 0.005;
let firmaCvs = null;

/**
 * Huella de una zona con TEXTO (las cartas de riven). El hash de 16×9 no lo ve: cambiar los stats
 * de una carta movía su media 2,3 y quitar la carta lateral 3,9, frente a una tolerancia de 18, así
 * que una tirada nueva solo se leía si además se movía el cristal del fondo.
 * Suavizado ALTO a propósito: el bajo muestrea en vez de promediar y un desplazamiento de 1 px ya
 * cambiaba el 8,7 % de las muestras.
 */
export function firmaTexto(source, crop) {
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
