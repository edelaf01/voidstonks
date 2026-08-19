/**
 * Escapes data the code does not control (warframe.market API, worldstate, OCR, user input) before
 * interpolating it into `innerHTML`. Quotes are escaped too, because the output often goes INSIDE an
 * attribute:
 *     `<div class="preset-chip" title="${escapeHTML(p.text)}">`
 * and there a double quote closes the attribute: a saved trade preset like `" onmouseover=alert(1) x="` would
 * become a real handler.
 *
 * No DOM on purpose: so it lives in utils/ and the layers that do not paint can use it (the layer contract
 * forbids utils/ and services/ importing from ui.components/).
 */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHTML(str) {
  // `!str` and not `str == null`: 0 and false keep rendering empty. Changing it would show zeros in counters
  // that show nothing today
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
