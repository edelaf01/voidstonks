// extracts squad relic names and refinements from the pause screen panel

export const SQUAD_STRIP_CROP = Object.freeze({ x: 0, y: 0, w: 0.72, h: 0.34 });
export const PAUSE_MENU_CROP = Object.freeze({ x: 0.10, y: 0.25, w: 0.35, h: 0.55 });

// anchors on RESUME and ABORT because Orbiter shares PROFILE/OPTIONS and would fire in dojo
const PAUSE_ANCHORS = /RESUM[EF]|REANUDAR|AB[O0]RT/;

const REFINEMENTS = {
  INTACT: "intact", INTACTA: "intact", INTACTO: "intact",
  EXCEPTIONAL: "exceptional", EXCEPCIONAL: "exceptional",
  FLAWLESS: "flawless", IMPECABLE: "flawless",
  RADIANT: "radiant", RADIANTE: "radiant",
};

export function isPauseScreen(menuText) {
  return PAUSE_ANCHORS.test(String(menuText || "").toUpperCase());
}

const clean = (w) => String(w?.text ?? w ?? "").toUpperCase().replaceAll(/[^A-ZÁÉÍÓÚ]/g, "");

export function refinementOf(word) {
  return REFINEMENTS[clean(word)] || null;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function groupWordCells(words, { gapFactor = 2 } = {}) {
  const list = (words || [])
    .filter((w) => clean(w).length > 0 || /\d/.test(String(w?.text ?? "")))
    .map((w) => ({
      text: String(w.text ?? ""),
      x0: Number(w.x0) || 0, x1: Number(w.x1) || 0,
      y0: Number(w.y0) || 0, y1: Number(w.y1) || 0,
    }));
  if (!list.length) return [];

  const h = median(list.map((w) => w.y1 - w.y0)) || 1;
  const maxGap = h * gapFactor;

  const rows = [];
  for (const w of [...list].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const cy = (w.y0 + w.y1) / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= h * 0.5);
    if (row) { row.words.push(w); row.cy += (cy - row.cy) / row.words.length; }
    else rows.push({ cy, words: [w] });
  }

  const cells = [];
  for (const row of rows) {
    const sorted = row.words.sort((a, b) => a.x0 - b.x0);
    let cur = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x0 - sorted[i - 1].x1 > maxGap) { cells.push(cur); cur = []; }
      cur.push(sorted[i]);
    }
    cells.push(cur);
  }
  return cells.map((ws) => ({
    words: ws.map((w) => w.text),
    x0: ws[0].x0,
    x1: Math.max(...ws.map((w) => w.x1)),
    y0: Math.min(...ws.map((w) => w.y0)),
    y1: Math.max(...ws.map((w) => w.y1)),
  }));
}

export function parseSquadRelics(words, { matchRelic } = {}) {
  if (typeof matchRelic !== "function") return [];
  const out = [];
  for (const cell of groupWordCells(words)) {
    const name = matchRelic(cell.words);
    if (!name) continue;
    if (!cell.words.some((w) => /^(RELIC|RELIQUIA)S?$/.test(clean(w)))) continue;
    const refinement = cell.words.map(refinementOf).find(Boolean) || null;
    out.push({ name, refinement, x0: cell.x0 });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}
