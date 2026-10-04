const HUECO = 8;
const MARGEN = 8;

export const DEBAJO_PRIMERO = ["abajo", "arriba", "derecha", "izquierda"];
export const AL_LADO_PRIMERO = ["derecha", "izquierda", "abajo", "arriba"];

export function posicionFuera(rect, ancho, alto, vista, orden = DEBAJO_PRIMERO) {
  const encaja = (v, tam, max) => Math.max(MARGEN, Math.min(v, max - tam - MARGEN));
  const x = encaja(rect.left + rect.width / 2 - ancho / 2, ancho, vista.ancho);
  const y = encaja(rect.top, alto, vista.alto);
  const lados = {
    abajo: [x, rect.bottom + HUECO],
    arriba: [x, rect.top - HUECO - alto],
    derecha: [rect.right + HUECO, y],
    izquierda: [rect.left - HUECO - ancho, y],
  };
  const cabe = ([l, t]) => l >= MARGEN && t >= MARGEN && l + ancho <= vista.ancho - MARGEN && t + alto <= vista.alto - MARGEN;
  const [left, top] = orden.map((l) => lados[l]).find(cabe) || lados[orden[0]];
  return { left: encaja(left, ancho, vista.ancho), top: encaja(top, alto, vista.alto) };
}
