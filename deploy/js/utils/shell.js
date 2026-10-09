export const ANCHO_ESCRITORIO = "(min-width: 900px)";

export function esEscritorio() {
  return document.documentElement.dataset.shell === "desktop";
}

export function carcasaActiva() {
  return esEscritorio() && !!globalThis.matchMedia?.(ANCHO_ESCRITORIO).matches;
}

export function seEstaMirando(doc = document) {
  if (doc.visibilityState === "hidden") return false;
  return doc.documentElement.dataset.shell !== "desktop" || doc.hasFocus();
}
