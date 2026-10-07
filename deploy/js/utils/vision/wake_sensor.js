// wakes the scanner loop early when watched video regions change and settle
import { regionLumaRapida, firmaTexto, mismoTexto } from "./frame_hash.js";
import { FRANJA_TITULO_VIDEO, tituloHaCambiado } from "./context_latch.js";

export const CADA_MS = 250;

export function pantallaNuevaParada(previa, actual, base, cambia) {
    return previa != null && actual != null && base != null && !cambia(actual, previa) && cambia(actual, base);
}

export function creaSensor(vigias, despierta, { cadaMs = CADA_MS, reloj = globalThis } = {}) {
    let timer = null, vuelta = 0;
    // tracks notified state so a tick that skips reading does not rewake on every sample
    const avisadas = vigias.map(() => null);
    const para = () => {
        vuelta++;
        if (timer !== null) reloj.clearInterval(timer);
        timer = null;
    };
    const arma = () => {
        para();
        const previas = vigias.map(() => null);
        const mia = vuelta;
        let ocupado = false;
        timer = reloj.setInterval(async () => {
            if (ocupado) return;
            ocupado = true;
            try {
                for (const [i, v] of vigias.entries()) {
                    const actual = await v.muestra();
                    if (mia !== vuelta) return;
                    const base = v.base(), aviso = avisadas[i];
                    const repetida = aviso && aviso.base === base && !v.cambia(actual, aviso.muestra);
                    if (pantallaNuevaParada(previas[i], actual, base, v.cambia) && !repetida) {
                        avisadas[i] = { base, muestra: actual };
                        if (v.acepta && !v.acepta()) { previas[i] = actual; continue; }
                        para();
                        despierta([...previas]);
                        return;
                    }
                    previas[i] = actual;
                }
            } catch (e) {
                console.warn("[SENSOR] muestra fallida:", e);
            } finally {
                ocupado = false;
            }
        }, cadaMs);
    };
    return { arma, para };
}

export function sensorDelEscaner(escaner, video, opciones = {}) {
    return creaSensor([
        { muestra: () => regionLumaRapida(video, FRANJA_TITULO_VIDEO), base: () => escaner.lastHeaderHash, cambia: tituloHaCambiado, acepta: opciones.acepta },
        { muestra: () => (escaner._cartaVigilada ? firmaTexto(video, escaner._cartaVigilada) : null), base: () => escaner.lastHashL, cambia: (a, b) => !mismoTexto(a, b) },
    ], ([franja]) => {
        clearTimeout(escaner.scanInterval);
        if (franja) escaner._franjaTickAnterior = franja;
        escaner.loop();
    }, opciones);
}
