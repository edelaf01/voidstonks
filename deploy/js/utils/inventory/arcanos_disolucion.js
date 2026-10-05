import { copiesForMaxRank, maxRankOf } from "../vosfor_math.js";

export const UMBRAL_ARCANO = 0.6;

export const CONTEXTOS_ARCANOS = Object.freeze(["ARCANE_DISSOLUTION", "INVENTORY_ARCANES"]);
export function esContextoArcanos(ctx) { return CONTEXTOS_ARCANOS.includes(ctx); }

export const BANDA_NOMBRE_ARCANO = Object.freeze({ y: 0.58, h: 0.26 });
const FRANJA_FIRMA_ARCANO = Object.freeze({ y: 0.70, h: 0.13 });

export function tirasDeNombreArcano({ gridX, gridY, cellW, cellH, cols, rows }, zona, ancho, alto) {
  return Array.from({ length: rows }, (_, r) => ({
    x: (zona.x + gridX) / ancho,
    y: (zona.y + gridY + (r + FRANJA_FIRMA_ARCANO.y) * cellH) / alto,
    w: (cols * cellW) / ancho,
    h: (FRANJA_FIRMA_ARCANO.h * cellH) / alto,
  })).filter((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= 1 && t.y + t.h <= 1);
}

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

export function filaArcano({ name, qty, r, c }, meta, veredicto) {
  const maxRank = maxRankOf(meta);
  const copiesMax = copiesForMaxRank(meta);
  const rangosMax = Math.floor(qty / copiesMax);
  const accion = veredicto?.bestAction || "pending";

  return { name, qty, maxRank, rangosMax, accion, r, c, precioR0: veredicto?.sell ?? null, precioMax: veredicto?.sellR5 ?? null };
}

export function rejillaArcanos(filas, colsSinSitio = 6) {
  if (!filas?.length) return { cols: 0, celdas: [] };
  const conSitio = filas.every((f) => Number.isInteger(f.r) && Number.isInteger(f.c));
  const colocadas = conSitio ? filas : filas.map((f, i) => ({ ...f, r: Math.floor(i / colsSinSitio), c: i % colsSinSitio }));
  const cols = Math.max(...colocadas.map((f) => f.c)) + 1;
  const r0 = Math.min(...colocadas.map((f) => f.r));
  const filasN = Math.max(...colocadas.map((f) => f.r)) - r0 + 1;
  const celdas = Array(cols * filasN).fill(null);
  for (const f of colocadas) celdas[(f.r - r0) * cols + f.c] = f;
  return { cols, celdas };
}

export function veredictoArcano({ accion, maxRank }, t) {
  const mapa = {
    "sell_max": { texto: `${t.vosfor.verdictSell} R${maxRank}`, tono: "verde" },
    "sell_r0": { texto: t.vosfor.verdictSellR0, tono: "verde" },
    "dissolve": { texto: t.vosfor.verdictDissolve, tono: "cian" },
    "even": { texto: t.vosfor.verdictEven, tono: "gris" }
  };
  return mapa[accion] || { texto: "…", tono: "gris" };
}

const pl = (v) => (v > 0 ? `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} pl` : "—");

export function lineasArcano(f, t) {
  return [
    { texto: f.name },
    { texto: f.rangosMax > 0 ? `${f.qty} · ${f.rangosMax}×R${f.maxRank}` : String(f.qty) },
    { texto: `R0 ${pl(f.precioR0)}`, tono: "oro" },
    { texto: `R${f.maxRank} ${pl(f.precioMax)}`, tono: "oro" },
    veredictoArcano(f, t),
  ];
}
