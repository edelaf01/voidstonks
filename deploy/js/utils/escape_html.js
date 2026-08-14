/**
 * Escapa datos que no controla el código (API de warframe.market, worldstate, OCR, entradas
 * del usuario) antes de interpolarlos en `innerHTML`.
 *
 * Escapa también las comillas, y esa es la diferencia con la implementación anterior. La de
 * antes hacía `p.textContent = str; return p.innerHTML`, que es lo que hace el navegador con
 * el texto de un nodo: convierte `& < >` y deja las comillas intactas. Vale para texto, pero
 * en este repo la salida entra en ~106 sitios DENTRO de un atributo:
 *
 *     `<div class="preset-chip" title="${escapeHTML(p.text)}">`   (ui_lfg.js:293)
 *     `<a href="${escapeHTML(w.wikiUrl)}" ...>`                   (ui_lich_weapons.js:134)
 *
 * y ahí una comilla doble cierra el atributo: un preset de trade guardado como
 * `" onmouseover=alert(1) x="` se convertía en un handler de verdad. `p.text` lo teclea el
 * usuario y `w.wikiUrl` viene del worker, así que las dos vías tenían dato externo.
 *
 * Sin DOM a propósito: así vive en utils/ y lo pueden usar las capas que no pintan (el
 * contrato de capas prohíbe que utils/ y services/ importen de ui.components/).
 */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHTML(str) {
  // `!str` y no `str == null`: se conserva el comportamiento de siempre, donde 0 y false
  // renderizan vacío. Cambiarlo haría aparecer ceros en contadores que hoy no muestran nada.
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
