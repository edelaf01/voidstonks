/**
 * ¿Sigue valiendo la rejilla cacheada, o hay que volver a detectarla?
 *
 * Detectar la rejilla cuesta un getImageData del frame entero más los perfiles, así que se hace
 * una vez y se reutiliza. El problema es cuándo tirarla: exigir que la página no casara NADA
 * dejaba escapar el caso del FINAL de la lista, donde el scroll se queda a media fila, la rejilla
 * cae entre celdas y aun así acierta las que por casualidad cuadran. `detectRowPhase`, que
 * absorbía ese desfase, está deshabilitada (ver su comentario en vision.service.js), así que la
 * única salida es volver a detectar.
 */

/** Menos de un tercio de celdas casadas = la rejilla no está donde creemos. */
const FRACCION_MALA = 3;
/** La mitad o más casadas = la rejilla es buena; se permite volver a reintentar en el futuro. */
const FRACCION_BUENA = 2;
/** Con muy pocas celdas activas el porcentaje no dice nada. */
const CELDAS_MINIMAS = 4;

/**
 * @param aciertos       celdas que casaron algo (ítem o reliquia).
 * @param celdas         celdas activas de la página.
 * @param yaReintentado  si ya se re-detectó por este motivo y aún no se ha visto una página buena.
 * @returns {{reDetectar: boolean, yaReintentado: boolean}}
 */
export function revisaRejillaCacheada(aciertos, celdas, yaReintentado) {
    // Una página buena rearma el reintento: lo contrario deja el escáner sin segunda oportunidad
    // durante el resto de la sesión en cuanto la rejilla se desalinea una vez.
    if (celdas > 0 && aciertos * FRACCION_BUENA >= celdas) {
        return { reDetectar: false, yaReintentado: false };
    }
    if (!celdas || yaReintentado) return { reDetectar: false, yaReintentado };
    // Sin este tope se re-detectaría página tras página cuando el problema no es la rejilla sino
    // que la página tiene poco que casar (mods, recursos), y detectar cuesta un frame entero.
    const mala = celdas >= CELDAS_MINIMAS && aciertos * FRACCION_MALA < celdas;
    const vacia = aciertos === 0;
    return mala || vacia ? { reDetectar: true, yaReintentado: true } : { reDetectar: false, yaReintentado };
}
