import { groupWordCells } from "./squad_panel.js";

/**
 * Lectura de la rejilla de VOID RELICS/REFINEMENT: qué reliquias tienes y cuántas.
 *
 * Dos cosas la separan del panel de escuadra:
 *
 *  - El contador ("x108") va arriba a la izquierda de la casilla y el nombre debajo del
 *    icono, así que llegan en LÍNEAS distintas del OCR y hay que emparejarlos.
 *  - Hacen falta DOS pasadas de OCR sobre el mismo recorte, con segmentación distinta.
 *    Medido sobre las capturas del usuario (19 reliquias): con psm 6 salen 17 nombres pero
 *    solo 9 contadores, y con psm 11 (texto disperso) 15 contadores y 10 nombres. Cada
 *    modo pierde justo lo que el otro acierta.
 *
 * Puro: entra lo que ha leído el OCR y sale [{ name, count }].
 */

// El recorte deja fuera la barra de scroll (~0.60 del ancho) y el panel de recompensas de
// la derecha. Por arriba empieza pasada la fila de OWNED/SEARCH, cuyo texto no aporta y sí
// mete tokens que el matcher tiene que descartar.
export const RELIC_GRID_CROP = Object.freeze({ x: 0.03, y: 0.17, w: 0.57, h: 0.76 });

// El contador se dibuja "x108". Se tolera que el OCR parta la x del número y las
// confusiones del glifo, pero la x tiene que estar: sin ella, un "[30]" o cualquier cifra
// suelta del arte entraría como cantidad, y una cantidad mal leída pisa el inventario.
const COUNT = /^[xX×*]\s*(\d{1,3})$/;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Agrupa valores en bandas (filas o columnas de la rejilla) partiendo por hueco.
 * @returns [{ center, index }] ordenado, y el paso mediano entre bandas.
 */
function bands(values, minGap) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1] <= minGap) last.push(v);
    else groups.push([v]);
  }
  const centers = groups.map(median);
  const gaps = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  return { centers, pitch: gaps.length ? median(gaps) : Infinity };
}

/** Índice de la banda más cercana a `v`, o -1 si ninguna cae dentro de `tol`. */
function bandOf(centers, v, tol) {
  let best = -1, bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - v);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= tol ? best : -1;
}

/**
 * @param passes.nameWords   cajas de palabra de la pasada de NOMBRES (psm 6)
 * @param passes.countWords  cajas de palabra de la pasada de CONTADORES (psm 11)
 * @param matchRelic         (palabras) => nombre canónico o null (OCRService.getRelicMatch)
 * @returns [{ name, count }] — solo las casillas donde se leyeron AMBAS cosas
 */
export function parseRelicGrid({ nameWords, countWords } = {}, { matchRelic } = {}) {
  if (typeof matchRelic !== "function") return [];

  const nameCells = groupWordCells(nameWords);
  const height = median(nameCells.map((c) => c.y1 - c.y0)) || 1;

  const names = [];
  for (const cell of nameCells) {
    // "No Relic" es la casilla de "no llevar ninguna": el matcher la descarta solo, porque
    // NO no casa con ningún tier. Aquí no se puede exigir la palabra "Relic" como en el
    // panel de escuadra — esa casilla también la lleva.
    const name = matchRelic(cell.words);
    if (name) names.push({ name, cx: (cell.x0 + cell.x1) / 2, y: cell.y0 });
  }
  if (!names.length) return [];

  // La rejilla se reconstruye SOLO con los nombres. Son la señal fiable (19 de 19 en la
  // captura del tema por defecto) y están centrados en su columna; los contadores van
  // pegados al borde izquierdo de la casilla, así que mezclarlos aquí encadenaba bandas
  // por un margen de 3 px y bastaba una lectura de más para fundir dos columnas.
  const cols = bands(names.map((n) => n.cx), height * 3);
  const rows = bands(names.map((n) => n.y), height * 1.5);

  // Los dos modos de segmentación encuentran contadores distintos, así que se juntan. Si
  // dos lecturas caen en la MISMA casilla con valores distintos, se tira la casilla: una
  // cantidad inventada se escribe en el inventario y no hay forma de notarlo después.
  const byCell = new Map();
  const descartadas = new Set();
  for (const words of [countWords, nameWords]) {
    for (const cell of groupWordCells(words || [])) {
      const m = COUNT.exec(cell.words.join(" ").trim());
      if (!m) continue;
      const cx = (cell.x0 + cell.x1) / 2;
      const col = bandOf(cols.centers, cx, cols.pitch * 0.5);
      if (col < 0) continue;
      // El contador está ARRIBA de su nombre: le toca la primera fila que quede por debajo,
      // y dentro del paso de fila. Sin ese tope, el contador de una casilla cuyo nombre no
      // se leyó se colgaría de la fila siguiente — un número equivocado en el inventario,
      // que es peor que no leer nada.
      let row = -1;
      rows.centers.forEach((c, i) => {
        const dy = c - cell.y0;
        if (dy > 0 && dy < rows.pitch && (row < 0 || c < rows.centers[row])) row = i;
      });
      if (row < 0) continue;

      const key = `${row}:${col}`;
      const prev = byCell.get(key);
      if (prev !== undefined && prev !== Number(m[1])) descartadas.add(key);
      byCell.set(key, Number(m[1]));
    }
  }

  const out = [];
  for (const n of names) {
    const col = bandOf(cols.centers, n.cx, cols.pitch * 0.5);
    const row = bandOf(rows.centers, n.y, rows.pitch * 0.5);
    if (col < 0 || row < 0) continue;
    const key = `${row}:${col}`;
    if (descartadas.has(key)) continue;
    const count = byCell.get(key);
    if (count !== undefined) out.push({ name: n.name, count });
  }
  return out;
}
