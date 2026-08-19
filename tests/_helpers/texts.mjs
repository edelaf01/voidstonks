export { TEXTS } from "../../deploy/js/config.js";

export function buscaClave(nodo, clave) {
  if (!nodo || typeof nodo !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(nodo, clave)) return true;
  return Object.values(nodo).some((hijo) => buscaClave(hijo, clave));
}
