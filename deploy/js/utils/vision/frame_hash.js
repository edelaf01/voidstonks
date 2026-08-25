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

/** Hash de un canvas ya preparado (p. ej. la franja del header). */
export function smallCanvasHash(canvas) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 16, 9);
    return hashFromTiny(ctx);
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
