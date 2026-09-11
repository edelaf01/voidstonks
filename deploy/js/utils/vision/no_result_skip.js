import { compareHashes } from "./frame_hash.js";

// expires so a failed OCR during fade-in does not silence the final screen forever

export const ESTADO_INICIAL = Object.freeze({ hash: null, time: 0 });

export function saltaPorSinResultado(hash, estado, ahora, caducidadMs) {
  return compareHashes(hash, estado?.hash) && (ahora - (estado?.time || 0) < caducidadMs);
}

export function siguienteEstadoSinResultado(hayResultado, hash, ahora) {
  return hayResultado ? ESTADO_INICIAL : { hash, time: ahora };
}
