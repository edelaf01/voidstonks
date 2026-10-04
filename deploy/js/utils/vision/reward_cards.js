// finds the card row by the art brightness. The threshold is relative (percentile) so it depends on neither
// the theme nor the resolution. colaRotulo stretches the band down because the label sits under the art

import { connectedComponents } from "./mission_complete_grid.js";

export function detectCardRow(img, { percentil = 0.97, minLado = 0.03, colaRotulo = 1.4, tolAncho = 0.25 } = {}) {
  const { data, width: W, height: H } = img;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) lum[p] = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
  const orden = Float32Array.from(lum).sort();
  const corte = orden[Math.floor(orden.length * percentil)];
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (lum[p] >= corte) mask[p] = 1;
  const comps = connectedComponents({ mask, w: W, h: H })
    .filter((c) => c.w >= W * minLado && c.h >= H * minLado);
  if (comps.length < 2) return null;
  // cards are boxes of the SAME width in a row, otherwise the bigger background art won. The group with MORE
  // members wins, not the heaviest: two background blobs can match by chance, four equal cards in a row cannot
  const usados = new Set(); let mejor = null;
  for (const s of [...comps].sort((a, b) => b.area - a.area)) {
    if (usados.has(s)) continue;
    const g = comps.filter((c) => !usados.has(c) && c.y < s.y + s.h && c.y + c.h > s.y
      && Math.abs(c.w - s.w) <= s.w * tolAncho);
    if (g.length < 2) continue;
    for (const c of g) usados.add(c);
    const masa = g.reduce((a, c) => a + c.area, 0);
    if (!mejor || g.length > mejor.g.length || (g.length === mejor.g.length && masa > mejor.masa)) {
      mejor = { g, masa };
    }
  }
  if (!mejor) return null;
  const g = mejor.g;
  const y0 = Math.min(...g.map((c) => c.y)), y1 = Math.max(...g.map((c) => c.y + c.h));
  // the band starts WHERE THE ART ENDS: the label is below. colaRotulo 1.4 because the label can take TWO
  // lines and its height does not scale with the art
  const alto = y1 - y0;
  const centros = g.map((c) => c.x + c.w / 2);
  const fila = filaCentrada(centros, W);
  if (fila) {
    const columnas = fila.centros.map((cx) => ({ x0: (cx - fila.paso / 2) / W, x1: (cx + fila.paso / 2) / W }));
    return { x: 0, w: W, y: y1, h: Math.round(Math.min(H - y1, alto * colaRotulo)), cardCount: fila.n, columnas };
  }
  // `columnas` as a width fraction: a word outside a card cannot be a reward name, and that is all that tells
  // "LOVOS"->LAVOS (good) from "FRONT"->FROST (HUD garbage). The column is the CARD, not the art blob: its width
  // comes from the STEP between blobs
  const columnas = columnasDesdeCentros(centros, W, Math.max(...g.map((c) => c.w)) * 2);
  return { x: 0, w: W, y: y1, h: Math.round(Math.min(H - y1, alto * colaRotulo)), cardCount: g.length, columnas };
}

const PASO_CARTA_MAX = 0.18;

export function filaCentrada(centros, W, { maxCartas = 4, tol = 0.2 } = {}) {
  if (!W || !centros?.length) return null;
  const medio = W / 2;
  const lejano = centros.reduce((a, c) => (Math.abs(c - medio) > Math.abs(a - medio) ? c : a));
  for (let n = centros.length; n <= maxCartas; n++) {
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      const paso = k ? (lejano - medio) / k : 0;
      if (paso < W * 0.05 || paso > W * PASO_CARTA_MAX) continue;
      const usadas = new Set();
      const encaja = centros.every((c) => {
        const j = Math.round((c - medio) / paso + (n - 1) / 2);
        if (j < 0 || j >= n || usadas.has(j)) return false;
        usadas.add(j);
        return Math.abs(medio + (j - (n - 1) / 2) * paso - c) <= paso * tol;
      });
      if (encaja) return { n, paso, centros: Array.from({ length: n }, (_, j) => medio + (j - (n - 1) / 2) * paso) };
    }
  }
  return null;
}

/**
 * Columns (width fraction) from the blob centers of a card row. The width comes from the STEP between
 * centers, not from each blob box: the blob only takes a narrow part of its card.
 *
 * @param {number} pasoFallback  width to use with a single center, where there is no step to measure.
 */
export function columnasDesdeCentros(centros, W, pasoFallback = 0) {
  const cs = [...(centros || [])].sort((a, b) => a - b);
  if (!cs.length || !W) return undefined;
  const saltos = cs.slice(1).map((v, i) => v - cs[i]);
  const orden = [...saltos].sort((a, b) => a - b);
  const paso = orden.length ? orden[orden.length >> 1] : pasoFallback;
  if (!paso) return undefined;
  // plausibility guard: junk columns always beat none because whoever gets them trusts them, and here they do
  // ACTIVE harm: a tiny step shrinks the dedup radius and the same card comes back twice.
  // - STEP: a card takes ~12.6 % of the frame width and the UI scale goes from 50 to 100 %, so below 5 % it is
  //   not a card row.
  // - REGULARITY: cards are evenly spaced, random art blobs are not.
  const PASO_MIN = W * 0.05, PASO_MAX = W * 0.35;
  if (paso < PASO_MIN || paso > PASO_MAX) return undefined;
  if (saltos.some((g) => Math.abs(g - paso) > paso * 0.3)) return undefined;
  return cs.map((cx) => ({ x0: (cx - paso / 2) / W, x1: (cx + paso / 2) / W }));
}

/** Moves the columns (FRAME fraction) to the crop the OCR sees, which eats a margin per side. */
export function columnasEnRecorte(columnas, width, cropRect) {
    if (!columnas) return undefined;
    const margen = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
    const ancho = (cropRect ? cropRect.w : width) - margen * 2;
    // the crop origin, not only the margin: prepareRewardOCRCanvas starts drawing at cropRect.x + margin
    const x0 = (cropRect ? Math.floor(cropRect.x) : 0) + margen;
    const f = (v) => (v * width - x0) / ancho;
    return columnas.map((c) => ({ x0: f(c.x0), x1: f(c.x1) }));
}

/**
 * Dedup radius: two candidates closer than this are the SAME label. A fraction of the STEP between cards,
 * not of the image width: when the row takes less of the frame (phone photo, webcam, full width crop) a fixed
 * 0.1·W made each card eat its neighbour. Capped at 0.1·W so it can only SHRINK.
 */
export function radioDeDedup(itemMatches, imgW, columnas) {
    const MAX = imgW * 0.1;
    const anchos = (columnas || []).map(c => (c.x1 - c.x0) * imgW).filter(v => v > 0).sort((a, b) => a - b);
    // columns are one step wide by construction
    const paso = anchos.length ? anchos[anchos.length >> 1] : pasoEntreTarjetas(itemMatches, imgW);
    return paso ? Math.min(MAX, paso * 0.65) : MAX;
}

/**
 * Step between cards measured on the candidates themselves, for when nobody passed columns (the PHOTO
 * path). Only trusts a regular row: three or more evenly spaced centers are cards, two loose matches could
 * be two candidates of the same label.
 */
export function pasoEntreTarjetas(itemMatches, imgW) {
    const centros = [];
    for (const x of itemMatches.map(m => m.x).sort((a, b) => a - b)) {
        if (!centros.length || x - centros[centros.length - 1] > imgW * 0.03) centros.push(x);
    }
    if (centros.length < 3) return 0;
    const saltos = centros.slice(1).map((v, i) => v - centros[i]);
    const med = [...saltos].sort((a, b) => a - b)[saltos.length >> 1];
    return saltos.every(g => Math.abs(g - med) <= med * 0.3) ? med : 0;
}

/**
 * Zones holding a label, to look for cards that gave no match: the columns or, without them, the "PRIME" of
 * the crop (every prime part has it on its label and the OCR reads it well). Without this a card whose FIRST
 * word was unreadable could not be rescued.
 */
export function zonasDeRotulo(columnas, palabras, imgW, paso) {
    if (columnas?.length) return columnas.map((c) => ({ x0: c.x0 * imgW, x1: c.x1 * imgW }));
    const ancho = (paso || imgW * 0.15) / 2;
    return palabras.filter((w) => w.text === "PRIME").map((w) => ({ x0: w.x - ancho, x1: w.x + ancho }));
}
