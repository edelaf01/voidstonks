import { copiesForMaxRank, maxRankOf } from "../vosfor_math.js";

export const UMBRAL_ARCANO = 0.6;

export function emparejaArcano(texto, tradables, similitud) {
  if (!texto || !tradables || !similitud) return null;

  const textoNorm = texto.replace(/\n/g, " ").replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (!textoNorm) return null;

  let mejorSlug = null;
  let mejorNombre = null;
  let mejorPuntuacion = -1;

  for (const [slug, datos] of Object.entries(tradables)) {
    const nombreEN = datos[0].toUpperCase();

    const puntuacion = similitud(textoNorm, nombreEN);
    if (puntuacion > mejorPuntuacion) {
      mejorPuntuacion = puntuacion;
      mejorSlug = slug;
      mejorNombre = datos[0];
    }
  }

  if (mejorPuntuacion >= UMBRAL_ARCANO) {
    return { slug: mejorSlug, name: mejorNombre };
  }
  return null;
}

export function filaArcano({ slug, name, qty }, meta, veredicto) {
  const maxRank = maxRankOf(meta);
  const copiesMax = copiesForMaxRank(meta);
  const rangosMax = Math.floor(qty / copiesMax);
  const accion = veredicto?.bestAction || "pending";

  return { name, qty, maxRank, rangosMax, accion };
}
