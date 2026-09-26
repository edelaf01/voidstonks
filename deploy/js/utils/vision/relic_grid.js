import { groupWordCells } from "./squad_panel.js";

/**
 * VOID RELICS/REFINEMENT grid reading: which relics you have and how many. Unlike the squad panel:
 *
 *  - The count ("x108") sits top left of the cell and the name under the icon, so they come in different
 *    OCR LINES and have to be paired.
 *  - It takes TWO OCR passes over the same crop with different segmentation: psm 6 gets the names and
 *    psm 11 (sparse text) the counts. Each mode misses what the other gets.
 *
 * Pure: OCR words in, [{ name, count }] out.
 */

// the crop leaves out the scroll bar (~0.60 of the width), the right rewards panel and the OWNED/SEARCH row
// on top
export const RELIC_GRID_CROP = Object.freeze({ x: 0.03, y: 0.17, w: 0.57, h: 0.76 });

// the count is drawn "x108": the OCR may split the x from the number or confuse the glyph, but the x must
// be there. Bare digits on screen are art, not counts
const COUNT = /^[xX×*]\s*(\d{1,3})$/;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Groups values into bands (grid rows or columns) split by gap. */
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

/** Index of the band closest to `v`, or -1 when none falls within `tol`. */
function bandOf(centers, v, tol) {
  let best = -1, bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - v);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= tol ? best : -1;
}

export function parseRelicGrid({ nameWords, countWords } = {}, { matchRelic, trace } = {}) {
  if (typeof matchRelic !== "function") return [];

  const nameCells = groupWordCells(nameWords);
  const height = median(nameCells.map((c) => c.y1 - c.y0)) || 1;

  // "No Relic" is the "carry none" cell: the matcher drops it since NO matches no tier. "Relic" cannot be
  // required like in the squad panel, that cell has it too
  const leerNombres = (cells) => cells
    .map((cell) => ({ name: matchRelic(cell.words), cx: (cell.x0 + cell.x1) / 2, y: cell.y0 }))
    .filter((n) => n.name);

  const names = leerNombres(nameCells);
  if (!names.length) return [];

  // the grid is rebuilt from the names ONLY: they are the reliable signal and sit centered in their column,
  // while counts hug the cell's left edge and chained bands together
  const cols = bands(names.map((n) => n.cx), height * 3);
  const rows = bands(names.map((n) => n.y), height * 1.5);

  /** Cell "row:column" of a name, or null when it falls in no band. */
  const celdaDe = (n) => {
    const col = bandOf(cols.centers, n.cx, cols.pitch * 0.5);
    const row = bandOf(rows.centers, n.y, rows.pitch * 0.5);
    return col < 0 || row < 0 ? null : `${row}:${col}`;
  };

  // the counts pass also reads names; when both disagree on the SAME cell it is dropped: a misread name logs a
  // relic that is not on screen, and that goes unnoticed
  const nombrePorCelda = new Map();
  const nombreDudoso = new Set();
  for (const n of names) {
    const key = celdaDe(n);
    if (!key) continue;
    const prev = nombrePorCelda.get(key);
    if (prev !== undefined && prev !== n.name) nombreDudoso.add(key);
    else nombrePorCelda.set(key, n.name);
  }
  // VETO only: a name only the counts pass sees is not accepted, there is nothing to check it against and that
  // pass eats glyphs ("Meso Vi" for Meso V13)
  for (const n of leerNombres(groupWordCells(countWords || []))) {
    const key = celdaDe(n);
    if (key && nombrePorCelda.has(key) && nombrePorCelda.get(key) !== n.name) nombreDudoso.add(key);
  }

  // both segmentation modes find different counts, so they are merged. Two reads on the SAME cell with
  // different values drop the cell: an invented quantity goes into the inventory unnoticed
  const candidatos = [];
  for (const words of [countWords, nameWords]) {
    for (const cell of groupWordCells(words || [])) {
      const m = COUNT.exec(cell.words.join(" ").trim());
      if (m) candidatos.push({ n: Number(m[1]), cx: (cell.x0 + cell.x1) / 2, y0: cell.y0, h: cell.y1 - cell.y0 });
    }
  }
  // all counts share one font size, so a box much taller than the median is text MERGED with the cell art,
  // where the OCR invents digits
  const alturaTipica = median(candidatos.map((c) => c.h)) || 1;

  const byCell = new Map();
  const descartadas = new Set();
  for (const c of candidatos) {
    if (c.h > alturaTipica * 1.5) continue;
    const col = bandOf(cols.centers, c.cx, cols.pitch * 0.5);
    if (col < 0) continue;
    // the count is ABOVE its name: it goes to the first row below it, within one row step. Without that cap the
    // count of a cell whose name was not read would hang on the next row
    let row = -1;
    rows.centers.forEach((centro, i) => {
      const dy = centro - c.y0;
      if (dy > 0 && dy < rows.pitch && (row < 0 || centro < rows.centers[row])) row = i;
    });
    if (row < 0) continue;

    const key = `${row}:${col}`;
    const prev = byCell.get(key);
    if (prev !== undefined && prev !== c.n) descartadas.add(key);
    byCell.set(key, c.n);
  }

  // "Axi A6 Relic [Radiant]" and "x2 Axi A6 Relic" are different cells of the same inventory entry: they add
  // up, and if one was not read, none
  const porNombre = new Map();
  const incompletas = new Set();
  const perdidas = { sinCasilla: 0, descartada: 0, dudosa: 0, sinContador: 0 };
  for (const n of names) {
    const key = celdaDe(n);
    const falta = !key ? "sinCasilla" : descartadas.has(key) ? "descartada"
      : nombreDudoso.has(key) ? "dudosa" : byCell.has(key) ? null : "sinContador";
    if (falta) { perdidas[falta]++; incompletas.add(n.name); continue; }
    porNombre.set(n.name, (porNombre.get(n.name) || new Map()).set(key, byCell.get(key)));
  }
  const out = [...porNombre].filter(([name]) => !incompletas.has(name))
    .map(([name, casillas]) => ({ name, count: [...casillas.values()].reduce((a, b) => a + b, 0) }));
  if (trace) {
    Object.assign(trace, {
      nombres: names.length, candidatosContador: candidatos.length,
      contadoresConCasilla: byCell.size, alturaTipica, perdidas,
      cols: cols.centers.length, filas: rows.centers.length,
    });
  }
  return out;
}
