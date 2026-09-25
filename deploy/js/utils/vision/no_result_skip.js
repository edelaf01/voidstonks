import { compareHashes } from "./frame_hash.js";

/**
 * Pantalla estática que ya se sabe sin resultado: cacheamos su hash para no repetir el OCR en
 * cada frame hasta que la imagen cambie de verdad. El mismo patrón vivía duplicado a mano para
 * rivens (cartas de reroll) y recompensas (banda de nombres) dentro de scanner.service.js.
 *
 * CADUCA a los `caducidadMs`: un OCR puede fallar sobre un fade-in (popup entrando, transición)
 * y el hash de ese fade casi completo cae dentro del umbral del de la pantalla final — sin
 * caducidad, ese primer fallo silenciaría la pantalla buena para siempre. Reintentar cada
 * pocos segundos una pantalla estática cuesta casi nada.
 *
 * Puro: entra el estado {hash, time} y sale el siguiente, para poder probarlo sin vídeo.
 */

export const ESTADO_INICIAL = Object.freeze({ hash: null, time: 0 });

/** ¿Toca saltarse el OCR? El hash de este frame coincide con el de un intento sin resultado reciente. */
export function saltaPorSinResultado(hash, estado, ahora, caducidadMs, iguales = compareHashes) {
  return iguales(hash, estado?.hash) && (ahora - (estado?.time || 0) < caducidadMs);
}

/** Próximo estado tras un intento: guarda el hash si NO hubo resultado, lo limpia si SÍ lo hubo. */
export function siguienteEstadoSinResultado(hayResultado, hash, ahora) {
  return hayResultado ? ESTADO_INICIAL : { hash, time: ahora };
}
