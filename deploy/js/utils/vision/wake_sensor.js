/**
 * Wakes the scanner loop early when a watched region changes and stops. In menus the tick sleeps up to 3 s;
 * each sample is a video thumbnail, not an OCR.
 */
import { regionLuma, videoRegionHash, compareHashes } from "./frame_hash.js";
import { FRANJA_TITULO_VIDEO, tituloHaCambiado } from "./context_latch.js";

export const CADA_MS = 250;

/** Still against the previous sample and different from the last one read: a new screen that stopped moving. */
export function pantallaNuevaParada(previa, actual, base, cambia) {
    return previa != null && actual != null && base != null && !cambia(actual, previa) && cambia(actual, base);
}

export function creaSensor(vigias, despierta, { cadaMs = CADA_MS, reloj = globalThis } = {}) {
    let timer = null;
    // if the woken tick does not get to read, the base does not move and without this it would wake every other
    // sample for the same screen
    const avisadas = vigias.map(() => null);
    const para = () => {
        if (timer !== null) reloj.clearInterval(timer);
        timer = null;
    };
    const arma = () => {
        para();
        const previas = vigias.map(() => null);
        timer = reloj.setInterval(() => {
            vigias.forEach((v, i) => {
                if (timer === null) return;
                const actual = v.muestra(), base = v.base(), aviso = avisadas[i];
                const repetida = aviso && aviso.base === base && !v.cambia(actual, aviso.muestra);
                if (pantallaNuevaParada(previas[i], actual, base, v.cambia) && !repetida) {
                    avisadas[i] = { base, muestra: actual };
                    para();
                    despierta([...previas]);
                }
                previas[i] = actual;
            });
        }, cadaMs);
    };
    return { arma, para, get armado() { return timer !== null; } };
}

/**
 * The desktop scanner sensor (ScannerService): watches the label strip against `lastHeaderHash` and, while
 * `_cartaVigilada` points to a riven card already read, that region against `lastHashL`. On wake it leaves
 * the previous strip in `_franjaTickAnterior` and calls `loop()`.
 */
export function sensorDelEscaner(escaner, video, opciones) {
    return creaSensor([
        { muestra: () => regionLuma(video, FRANJA_TITULO_VIDEO), base: () => escaner.lastHeaderHash, cambia: tituloHaCambiado },
        { muestra: () => (escaner._cartaVigilada ? videoRegionHash(video, escaner._cartaVigilada) : null), base: () => escaner.lastHashL, cambia: (a, b) => !compareHashes(a, b) },
    ], ([franja]) => {
        clearTimeout(escaner.scanInterval);
        if (franja) escaner._franjaTickAnterior = franja;
        escaner.loop();
    }, opciones);
}
