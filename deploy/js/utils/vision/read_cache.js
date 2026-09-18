import { compareHashes } from "./frame_hash.js";

/**
 * Lecturas por objeto, válidas mientras el recorte no cambie.
 *
 * Fin de misión releía las 20 casillas en cada vuelta (2,5-3 s por frame) para una pantalla
 * que no se mueve hasta que el jugador pulsa. Con el hash del recorte como llave, la segunda
 * vuelta —la que confirma el consenso— sale de aquí y cuesta nada. La tolerancia admite el
 * ruido del stream y los brillos animados de la interfaz; un cambio real de casilla (otra
 * recompensa al desplazar el panel) se pasa de largo y vuelve a leerse.
 */
export function createReadCache(tolerance = 8) {
    const entries = new Map();
    return {
        /** La lectura guardada para `key` si su recorte sigue siendo el mismo; si no, null. */
        get(key, hash) {
            const e = entries.get(key);
            return e && compareHashes(hash, e.hash, tolerance) ? e.value : null;
        },
        set(key, hash, value) { entries.set(key, { hash, value }); },
        clear() { entries.clear(); },
        get size() { return entries.size; },
    };
}
