/**
 * Squad panel of the PAUSE screen (ESC in mission): which relic each player carries, before the rewards
 * screen shows up. Pure: OCR text or word boxes in, relic list out.
 */

// frame crops as width/height fractions. The strip is GENEROUS on top (0.34) because the panel line count
// depends on each player's gear (archgun, companion and its weapon), not on the resolution
export const SQUAD_STRIP_CROP = Object.freeze({ x: 0, y: 0, w: 0.72, h: 0.34 });
// the menu column (RESUME…ABORT MISSION), read apart at small scale: big text only needed to decide IF this
// is the pause screen
export const PAUSE_MENU_CROP = Object.freeze({ x: 0.10, y: 0.25, w: 0.35, h: 0.55 });

// RESUME and ABORT MISSION only exist INSIDE a mission: the Orbiter menu shares PROFILE/OPTIONS with this
// one, so anchoring on those would fire in the dojo
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

const PREFIJOS = { IN: "intact", EX: "exceptional", FL: "flawless", IM: "flawless", RA: "radiant" };

/** The refinement a word names ("(Radiant)"), or null. */
export function refinementOf(word) {
  const c = clean(word);
  // the OCR eats letters ("(Ratiant"): with the parenthesis in front, the first two are enough
  const conParentesis = String(word?.text ?? word ?? "").trimStart().startsWith("(") && c.length >= 4;
  return REFINEMENTS[c] || (conParentesis && PREFIJOS[c.slice(0, 2)]) || null;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Groups the OCR words into CELLS: a piece of a line that belongs to one panel column. Tesseract reads the
 * strip left to right, so the relics row comes as ONE line with all four glued; splitting it at the
 * horizontal gap keeps the matcher from mixing one player's code with the next one's tier. Gaps inside a
 * cell stay under ~1.3 word heights and those between columns start at ~3, hence the cut at 2.
 */
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

  // same line = vertical centers within half a height. Word height varies (parentheses reach further than
  // capitals), and comparing y0 split "(Radiant)" from its own relic
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

/**
 * The relics the squad carries, left to right.
 *
 * @param words     OCR word boxes of the strip: { text, x0, x1, y0, y1 }
 * @param matchRelic (words) => canonical name or null. Injected because it lives in services/
 *                  (OCRService.getRelicMatch) and cannot be imported here.
 * @returns [{ name, refinement, x0, propia }], `refinement` is null when the parenthesis was not read.
 */
export function parseSquadRelics(words, { matchRelic } = {}) {
  if (typeof matchRelic !== "function") return [];
  const out = [];
  const cells = groupWordCells(words);
  for (const cell of cells) {
    const name = matchRelic(cell.words);
    if (!name) continue;
    // the word "Relic"/"Reliquia" is required: the panel also lists weapons and warframes, and a bare name can
    // look like a relic code. No hurry to rescue doubtful reads, the screen stays open and the next frame retries
    if (!cell.words.some((w) => /^(RELIC|RELIQUIA)S?$/.test(clean(w)))) continue;
    // a "(Ratiant" merged with the line below fell into the cell underneath
    const pegada = (w) => w.x0 >= cell.x1 - 2 && w.x0 - cell.x1 < 2 * (cell.y1 - cell.y0) && w.y0 < cell.y1 && w.y1 > cell.y0;
    const refinement = cell.words.map(refinementOf).find(Boolean) || refinementOf(words.find((w) => pegada(w) && refinementOf(w))) || null;
    // your column is the first: your relic opens its line
    const propia = !cells.some((o) => o !== cell && o.x1 <= cell.x0 && o.y0 < cell.y1 && o.y1 > cell.y0);
    out.push({ name, refinement, x0: cell.x0, propia });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}
