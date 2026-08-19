// TEXTS access for tests that check a UI text exists in both languages, by walking the real tree
// counting `clave:` in the source broke whenever TEXTS moved file

export { TEXTS } from "../../deploy/js/config.js";

/**
 * does `clave` exist at any level of a language text tree? recursive because TEXTS nests by section
 * and tests know the key, not the full path
 */
export function buscaClave(nodo, clave) {
  if (!nodo || typeof nodo !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(nodo, clave)) return true;
  return Object.values(nodo).some((hijo) => buscaClave(hijo, clave));
}
