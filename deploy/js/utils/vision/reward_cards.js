// finds the reward card row and columns by relative brightness of card art

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
  const alto = y1 - y0;
  const columnas = columnasDesdeCentros(g.map((c) => c.x + c.w / 2), W,
    Math.max(...g.map((c) => c.w)) * 2);
  return { x: 0, w: W, y: y1, h: Math.round(Math.min(H - y1, alto * colaRotulo)), cardCount: g.length, columnas };
}

export function columnasDesdeCentros(centros, W, pasoFallback = 0) {
  const cs = [...(centros || [])].sort((a, b) => a - b);
  if (!cs.length || !W) return undefined;
  const saltos = cs.slice(1).map((v, i) => v - cs[i]);
  const orden = [...saltos].sort((a, b) => a - b);
  const paso = orden.length ? orden[orden.length >> 1] : pasoFallback;
  if (!paso) return undefined;
  // cards take ~12.6% width with 50-100% UI scale, so below 5% cannot be a card row
  const PASO_MIN = W * 0.05, PASO_MAX = W * 0.35;
  if (paso < PASO_MIN || paso > PASO_MAX) return undefined;
  if (saltos.some((g) => Math.abs(g - paso) > paso * 0.3)) return undefined;
  return cs.map((cx) => ({ x0: (cx - paso / 2) / W, x1: (cx + paso / 2) / W }));
}

export function columnasEnRecorte(columnas, width, cropRect) {
    if (!columnas) return undefined;
    const margen = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
    const ancho = (cropRect ? cropRect.w : width) - margen * 2;
    const x0 = (cropRect ? Math.floor(cropRect.x) : 0) + margen;
    const f = (v) => (v * width - x0) / ancho;
    return columnas.map((c) => ({ x0: f(c.x0), x1: f(c.x1) }));
}

export function radioDeDedup(itemMatches, imgW, columnas) {
    const MAX = imgW * 0.1;
    const anchos = (columnas || []).map(c => (c.x1 - c.x0) * imgW).filter(v => v > 0).sort((a, b) => a - b);
    const paso = anchos.length ? anchos[anchos.length >> 1] : pasoEntreTarjetas(itemMatches, imgW);
    return paso ? Math.min(MAX, paso * 0.65) : MAX;
}

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

export function zonasDeRotulo(columnas, palabras, imgW, paso) {
    if (columnas?.length) return columnas.map((c) => ({ x0: c.x0 * imgW, x1: c.x1 * imgW }));
    const ancho = (paso || imgW * 0.15) / 2;
    return palabras.filter((w) => w.text === "PRIME").map((w) => ({ x0: w.x - ancho, x1: w.x + ancho }));
}
