import { sharedFrame } from "./frame_freeze.js";

export const SPLICE_ELEGIDA = Object.freeze({ x: 0.53, y: 0.26, w: 0.14, h: 0.26, unaCarta: true });
const FIRMA_ELEGIDA = Object.freeze({ x: 0.54, y: 0.39, w: 0.12, h: 0.11 });
export const SPLICE_REJILLA = Object.freeze({ x: 0.04, y: 0.12, w: 0.41, h: 0.85 });

const COLUMNAS = [0.107, 0.24, 0.372];
const MEDIA_COLUMNA = 0.065, ALTO_MUESTRA = 360, RADIO = 8, CONTRASTE = 18, MINIMO_FILA = 2;
const ALTO_BLOQUE = [0.25, 0.42], ALTO_CARTA = 0.34;
const TEXTO = { arriba: 0.55, abajo: 0.95, mitad: 0.075 };

let rejillaCvs = null;

export function muestreaRejilla(video) {
  const W = video.videoWidth, H = video.videoHeight, z = SPLICE_REJILLA, k = ALTO_MUESTRA / H;
  const w = Math.max(1, Math.round(W * z.w * k)), h = Math.max(1, Math.round(H * z.h * k));
  if (!rejillaCvs) rejillaCvs = document.createElement("canvas");
  if (rejillaCvs.width !== w || rejillaCvs.height !== h) { rejillaCvs.width = w; rejillaCvs.height = h; }
  const ctx = rejillaCvs.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sharedFrame(video), Math.floor(W * z.x), Math.floor(H * z.y), Math.floor(W * z.w), Math.floor(H * z.h), 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function mascaraTexto({ data, width, height }) {
  const L = new Float32Array(width * height);
  for (let i = 0; i < L.length; i++) L[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const out = new Uint8Array(L.length);
  for (let y = 0; y < height; y++) {
    const fila = y * width;
    let suma = 0, n = 0;
    for (let x = 0; x <= RADIO && x < width; x++) { suma += L[fila + x]; n++; }
    for (let x = 0; x < width; x++) {
      if (x > 0 && x + RADIO < width) { suma += L[fila + x + RADIO]; n++; }
      if (x - RADIO - 1 >= 0) { suma -= L[fila + x - RADIO - 1]; n--; }
      const i = (fila + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), s = mx ? (mx - Math.min(r, g, b)) / mx : 0;
      const lavanda = b > r && r > g && s > 0.12 && s < 0.45;
      out[fila + x] = L[fila + x] > suma / n + CONTRASTE && (lavanda || (s < 0.18 && L[fila + x] > 120)) ? 1 : 0;
    }
  }
  return out;
}

function bloques(mascara, width, height, x0, x1) {
  const out = [];
  let ini = -1;
  for (let y = 0; y <= height; y++) {
    let n = 0;
    if (y < height) for (let x = x0; x < x1; x++) n += mascara[y * width + x];
    if (n >= MINIMO_FILA && ini < 0) ini = y;
    else if (n < MINIMO_FILA && ini >= 0) { out.push({ ini, fin: y - 1 }); ini = -1; }
  }
  return out;
}

export function cartaFlotante(img) {
  const z = SPLICE_REJILLA, mascara = mascaraTexto(img);
  for (const cx of COLUMNAS) {
    const x0 = Math.max(0, Math.round(((cx - MEDIA_COLUMNA - z.x) / z.w) * img.width));
    const x1 = Math.min(img.width, Math.round(((cx + MEDIA_COLUMNA - z.x) / z.w) * img.width));
    for (const { ini, fin } of bloques(mascara, img.width, img.height, x0, x1)) {
      const alto = ((fin - ini + 1) / img.height) * z.h;
      if (alto < ALTO_BLOQUE[0] || alto > ALTO_BLOQUE[1]) continue;
      const arriba = ini > 0 ? z.y + (ini / img.height) * z.h : z.y + ((fin + 1) / img.height) * z.h - ALTO_CARTA;
      return { x: cx - TEXTO.mitad, y: arriba + ALTO_CARTA * TEXTO.arriba, w: TEXTO.mitad * 2, h: ALTO_CARTA * (TEXTO.abajo - TEXTO.arriba), unaCarta: true };
    }
  }
  return null;
}

export const recorteSplice = (video) => cartaFlotante(muestreaRejilla(video)) || SPLICE_ELEGIDA;

export const zonasDeFirma = (zonas, recorte, contexto) => {
  if (contexto !== "RIVEN_SPLICING") return zonas?.length ? zonas : [recorte];
  return [recorte === SPLICE_ELEGIDA ? FIRMA_ELEGIDA : recorte];
};
