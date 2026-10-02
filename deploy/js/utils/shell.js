// El atributo lo pone el script del <head> de index.html, antes del primer pintado.
export const ANCHO_ESCRITORIO = "(min-width: 900px)";

export function esEscritorio() {
  return document.documentElement.dataset.shell === "desktop";
}

// Por debajo del ancho mínimo la carcasa cede a la maqueta normal (ventana a media pantalla).
export function carcasaActiva() {
  return esEscritorio() && !!globalThis.matchMedia?.(ANCHO_ESCRITORIO).matches;
}
