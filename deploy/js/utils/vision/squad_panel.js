/**
 * Lectura del panel de escuadra de la pantalla de PAUSA (ESC en misión): qué reliquia
 * lleva cada jugador, antes de que aparezca la pantalla de recompensas.
 *
 * Puro: entra lo que ha leído el OCR (texto o cajas de palabra) y sale la lista de
 * reliquias, para poder probarlo sin navegador contra capturas reales.
 */

// Recortes del frame, en fracción de ancho/alto. La franja es GENEROSA por arriba
// (0.34) porque el número de líneas del panel depende del equipamiento de cada
// jugador —arma de arch-wing, compañero y su arma— y no de la resolución.
export const SQUAD_STRIP_CROP = Object.freeze({ x: 0, y: 0, w: 0.72, h: 0.34 });
// La columna del menú (RESUME…ABORT MISSION). Se lee aparte y a escala pequeña: es
// texto grande y solo hace falta para decidir SI estamos en pausa.
export const PAUSE_MENU_CROP = Object.freeze({ x: 0.10, y: 0.25, w: 0.35, h: 0.55 });

// RESUME y ABORT MISSION solo existen DENTRO de una misión: el menú del Orbiter comparte
// PROFILE/OPTIONS con este, así que anclar en los comunes daría positivo en el dojo.
const PAUSE_ANCHORS = /RESUM[EF]|REANUDAR|AB[O0]RT/;

const REFINEMENTS = {
  INTACT: "intact", INTACTA: "intact", INTACTO: "intact",
  EXCEPTIONAL: "exceptional", EXCEPCIONAL: "exceptional",
  FLAWLESS: "flawless", IMPECABLE: "flawless",
  RADIANT: "radiant", RADIANTE: "radiant",
};

/** ¿El OCR de la columna del menú dice que estamos en la pantalla de pausa? */
export function isPauseScreen(menuText) {
  return PAUSE_ANCHORS.test(String(menuText || "").toUpperCase());
}

const clean = (w) => String(w?.text ?? w ?? "").toUpperCase().replaceAll(/[^A-ZÁÉÍÓÚ]/g, "");

const PREFIJOS = { IN: "intact", EX: "exceptional", FL: "flawless", IM: "flawless", RA: "radiant" };

/** El refinamiento que nombra una palabra ("(Radiant)"), o null. */
export function refinementOf(word) {
  const c = clean(word);
  // El OCR se come letras ("(Ratiant"): con el paréntesis delante, las dos primeras ya lo distinguen.
  const conParentesis = String(word?.text ?? word ?? "").trimStart().startsWith("(") && c.length >= 4;
  return REFINEMENTS[c] || (conParentesis && PREFIJOS[c.slice(0, 2)]) || null;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Agrupa las palabras del OCR en CELDAS: un trozo de una línea que pertenece a la misma
 * columna del panel.
 *
 * Tesseract lee la franja entera de izquierda a derecha, así que la fila de las reliquias
 * llega como UNA línea con las cuatro pegadas ("Neo N12 Relic (Radiant) Neo V11 Relic…").
 * Partirla por el hueco horizontal es lo que impide que el matcher mezcle el código de un
 * jugador con el tier del siguiente. Medido sobre la captura de 2538×1401: los huecos
 * dentro de una celda llegan a 35 px y los que separan columnas empiezan en 81, con la
 * altura mediana de palabra en 27 — de ahí el corte en 2 alturas.
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

  // Misma línea = los centros verticales caen dentro de media altura. El alto de palabra
  // varía (los paréntesis suben y bajan más que las mayúsculas), así que comparar y0 a
  // secas separaba "(Radiant)" de su propia reliquia.
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
 * Las reliquias que lleva la escuadra, de izquierda a derecha.
 *
 * @param words     cajas de palabra del OCR de la franja: { text, x0, x1, y0, y1 }
 * @param matchRelic (palabras) => nombre canónico o null. Se inyecta porque vive en
 *                  services/ (OCRService.getRelicMatch) y aquí no se puede importar.
 * @returns [{ name, refinement, x0, propia }] — `refinement` es null si no se leyó el paréntesis.
 */
export function parseSquadRelics(words, { matchRelic } = {}) {
  if (typeof matchRelic !== "function") return [];
  const out = [];
  const cells = groupWordCells(words);
  for (const cell of cells) {
    const name = matchRelic(cell.words);
    if (!name) continue;
    // Sin la palabra "Relic"/"Reliquia" no se acepta: el panel también lista armas y
    // warframes, y un nombre suelto puede parecerse a un código de reliquia por
    // similitud. Aquí no hay prisa por rescatar lecturas dudosas — la pantalla se
    // queda abierta y el siguiente frame vuelve a intentarlo.
    if (!cell.words.some((w) => /^(RELIC|RELIQUIA)S?$/.test(clean(w)))) continue;
    // Un "(Ratiant" fundido con la línea de abajo (caja de 81 px) caía en la celda de debajo.
    const pegada = (w) => w.x0 >= cell.x1 - 2 && w.x0 - cell.x1 < 2 * (cell.y1 - cell.y0) && w.y0 < cell.y1 && w.y1 > cell.y0;
    const refinement = cell.words.map(refinementOf).find(Boolean) || refinementOf(words.find((w) => pegada(w) && refinementOf(w))) || null;
    // Tu columna es la primera: tu reliquia abre su línea.
    const propia = !cells.some((o) => o !== cell && o.x1 <= cell.x0 && o.y0 < cell.y1 && o.y1 > cell.y0);
    out.push({ name, refinement, x0: cell.x0, propia });
  }
  return out.sort((a, b) => a.x0 - b.x0);
}
