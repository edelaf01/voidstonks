import { groupWordCells } from "./squad_panel.js";

export const RELIC_GRID_CROP = Object.freeze({ x: 0.03, y: 0.17, w: 0.57, h: 0.76 });
export const RELIC_TITLE_CROP = Object.freeze({ x: 0.46, y: 0.225, w: 0.31, h: 0.055 });

export function reliquiaDelTitulo(texto, matchRelic) {
  const t = String(texto || "");
  const fin = t.search(/POSS?IBLE|REWARDS|RECOMPENSAS|POSIBLES/i);
  if (fin < 0 || typeof matchRelic !== "function") return null;
  return matchRelic(t.slice(0, fin).split(/\s+/).filter(Boolean)) || null;
}

const COUNT = /^[xX×*]\s*(\d{1,3})$/;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

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

  const leerNombres = (cells) => cells
    .map((cell) => ({ name: matchRelic(cell.words), cx: (cell.x0 + cell.x1) / 2, y: cell.y0 }))
    .filter((n) => n.name);

  const names = leerNombres(nameCells);
  if (!names.length) return [];

  // grid columns use names only because counts hug left edges and chain bands together
  const cols = bands(names.map((n) => n.cx), height * 3);
  const rows = bands(names.map((n) => n.y), height * 1.5);

  const celdaDe = (n) => {
    const col = bandOf(cols.centers, n.cx, cols.pitch * 0.5);
    const row = bandOf(rows.centers, n.y, rows.pitch * 0.5);
    return col < 0 || row < 0 ? null : `${row}:${col}`;
  };

  const nombrePorCelda = new Map();
  const nombreDudoso = new Set();
  for (const n of names) {
    const key = celdaDe(n);
    if (!key) continue;
    const prev = nombrePorCelda.get(key);
    if (prev !== undefined && prev !== n.name) nombreDudoso.add(key);
    else nombrePorCelda.set(key, n.name);
  }
  for (const n of leerNombres(groupWordCells(countWords || []))) {
    const key = celdaDe(n);
    if (key && nombrePorCelda.has(key) && nombrePorCelda.get(key) !== n.name) nombreDudoso.add(key);
  }

  const candidatos = [];
  for (const words of [countWords, nameWords]) {
    for (const cell of groupWordCells(words || [])) {
      const m = COUNT.exec(cell.words.join(" ").trim());
      if (m) candidatos.push({ n: Number(m[1]), cx: (cell.x0 + cell.x1) / 2, y0: cell.y0, h: cell.y1 - cell.y0 });
    }
  }
  const alturaTipica = median(candidatos.map((c) => c.h)) || 1;

  const byCell = new Map();
  const descartadas = new Set();
  for (const c of candidatos) {
    if (c.h > alturaTipica * 1.5) continue;
    const col = bandOf(cols.centers, c.cx, cols.pitch * 0.5);
    if (col < 0) continue;
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
