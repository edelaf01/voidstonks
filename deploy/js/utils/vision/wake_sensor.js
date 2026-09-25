/**
 * Despierta el bucle del escáner antes de hora cuando una región vigilada cambia y se para. En los
 * menús el tick duerme hasta 3 s y cambiar de pestaña tardaba eso en verse; cada muestra es una
 * miniatura del vídeo, no un OCR.
 */
import { regionLuma, firmaTexto, mismoTexto } from "./frame_hash.js";
import { FRANJA_TITULO_VIDEO, tituloHaCambiado } from "./context_latch.js";

export const CADA_MS = 250;

/** Quieta respecto a la muestra anterior y distinta de la última leída: pantalla nueva que ya no se mueve. */
export function pantallaNuevaParada(previa, actual, base, cambia) {
    return previa != null && actual != null && base != null && !cambia(actual, previa) && cambia(actual, base);
}

/**
 * @param vigias [{ muestra: () => muestra|null, base: () => muestra|null, cambia: (a, b) => boolean }]
 *   `muestra` a null apaga esa vigía.
 * @param despierta recibe la muestra previa de cada vigía (la de la franja le sirve a processFrame
 *   para saber que el rótulo estaba quieto).
 */
export function creaSensor(vigias, despierta, { cadaMs = CADA_MS, reloj = globalThis } = {}) {
    let timer = null;
    // Si el tick despertado no llega a leer (el reloj de la cabecera no lo deja), la base no se
    // mueve y sin esto se despertaría cada dos muestras por la misma pantalla.
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
    return { arma, para };
}

/**
 * El sensor del escáner de escritorio (ScannerService): vigila la franja del rótulo contra
 * `lastHeaderHash` y, mientras `_cartaVigilada` apunte a una carta de riven ya leída, esa región
 * contra `lastHashL`. Al despertar deja la franja previa en `_franjaTickAnterior` y lanza `loop()`.
 */
export function sensorDelEscaner(escaner, video, opciones) {
    return creaSensor([
        { muestra: () => regionLuma(video, FRANJA_TITULO_VIDEO), base: () => escaner.lastHeaderHash, cambia: tituloHaCambiado },
        { muestra: () => (escaner._cartaVigilada ? firmaTexto(video, escaner._cartaVigilada) : null), base: () => escaner.lastHashL, cambia: (a, b) => !mismoTexto(a, b) },
    ], ([franja]) => {
        clearTimeout(escaner.scanInterval);
        if (franja) escaner._franjaTickAnterior = franja;
        escaner.loop();
    }, opciones);
}
