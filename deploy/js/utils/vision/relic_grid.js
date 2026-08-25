import { groupWordCells } from "./squad_panel.js";

export const RELIC_GRID_CROP = Object.freeze({ x: 0.03, y: 0.17, w: 0.57, h: 0.76 });

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

export function parseRelicGrid({ nameWords, countWords } = {}, { matchRelic } = {}) {
  if (typeof matchRelic !== "function") return [];

  const nameCells = groupWordCells(nameWords);
  const height = median(nameCells.map((c) => c.y1 - c.y0)) || 1;

  const names = [];
  for (const cell of nameCells) {
    const name = matchRelic(cell.words);
    if (name) names.push({ name, cx: (cell.x0 + cell.x1) / 2, y: cell.y0 });
  }
  if (!names.length) return [];

  // grid columns use names only because counts hug left edges and chain bands together
  const cols = bands(names.map((n) => n.cx), height * 3);
  const rows = bands(names.map((n) => n.y), height * 1.5);

  const byCell = new Map();
  const descartadas = new Set();
  for (const words of [countWords, nameWords]) {
    for (const cell of groupWordCells(words || [])) {
      const m = COUNT.exec(cell.words.join(" ").trim());
      if (!m) continue;
      const cx = (cell.x0 + cell.x1) / 2;
      const col = bandOf(cols.centers, cx, cols.pitch * 0.5);
      if (col < 0) continue;
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
