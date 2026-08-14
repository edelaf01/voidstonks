// escapes untrusted data before interpolation, including quotes for attributes
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHTML(str) {
  // !str and not str == null: 0 and false keep rendering empty instead of showing zeros
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
