import { compareHashes } from "./frame_hash.js";

/**
 * Static screen already known to have no result: its hash is cached so the OCR does not repeat on every frame
 * until the image really changes.
 *
 * It EXPIRES after `caducidadMs`: an OCR can fail on a fade-in and the hash of an almost complete fade falls
 * within the threshold of the final screen, so without expiry that first failure would silence the good screen
 * forever. Retrying a static screen every few seconds costs almost nothing.
 *
 * Pure: the {hash, time} state goes in and the next one comes out, testable without video.
 */

export const ESTADO_INICIAL = Object.freeze({ hash: null, time: 0 });

/** Should the OCR be skipped? This frame's hash matches a recent attempt with no result. */
export function saltaPorSinResultado(hash, estado, ahora, caducidadMs, iguales = compareHashes) {
  return iguales(hash, estado?.hash) && (ahora - (estado?.time || 0) < caducidadMs);
}

/** Next state after an attempt: stores the hash when there was NO result, clears it when there was. */
export function siguienteEstadoSinResultado(hayResultado, hash, ahora) {
  return hayResultado ? ESTADO_INICIAL : { hash, time: ahora };
}
