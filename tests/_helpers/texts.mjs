// Acceso a TEXTS para los tests que comprueban que un texto de UI existe en los dos idiomas.
//
// Antes cada test leía config.js y contaba apariciones de `clave:` con una regex, esperando
// exactamente 2 (una por idioma). Eso se rompía por dos motivos ajenos al invariante: al mover
// TEXTS a otro fichero (pasó al sacarlo de config.js), y si la misma clave aparecía en otro
// objeto del fuente. Mirar el árbol real comprueba lo que de verdad importa.

export { TEXTS } from "../../deploy/js/config.js";

/**
 * ¿Existe `clave` en algún nivel del árbol de textos de un idioma?
 *
 * Recursivo porque TEXTS anida por apartado (`TEXTS.es.rewardScanner.toastCopied`) y los tests
 * conocen la clave, no la ruta completa hasta ella.
 */
export function buscaClave(nodo, clave) {
  if (!nodo || typeof nodo !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(nodo, clave)) return true;
  return Object.values(nodo).some((hijo) => buscaClave(hijo, clave));
}
