// ===========================================================================
// Pool sintética de objetos prime + generador de frames de recompensas para
// tests offline. Determinista (PRNG con semilla). Pensado para la pantalla de
// FISURAS (parseRewards); la pool y makeRewardFrame son reutilizables para
// generar celdas de INVENTARIO en el futuro.
// ===========================================================================

// PRNG mulberry32: misma semilla -> misma secuencia (tests reproducibles).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAMES = [
  "Ash", "Atlas", "Banshee", "Baruuk", "Chroma", "Ember", "Equinox", "Frost", "Gara", "Garuda",
  "Gauss", "Grendel", "Harrow", "Hildryn", "Inaros", "Ivara", "Khora", "Lavos", "Limbo", "Loki",
  "Mag", "Mesa", "Mirage", "Nekros", "Nezha", "Nidus", "Nova", "Nyx", "Oberon", "Octavia",
  "Protea", "Revenant", "Rhino", "Saryn", "Sevagoth", "Titania", "Trinity", "Valkyr", "Vauban",
  "Volt", "Wisp", "Wukong", "Xaku", "Yareli", "Zephyr",
];
const WF_PARTS = ["Chassis Blueprint", "Systems Blueprint", "Neuroptics Blueprint", "Blueprint"];

const WEAPONS = [
  ["Akbolto", ["Barrel", "Receiver", "Link", "Blueprint"]],
  ["Paris", ["Upper Limb", "Lower Limb", "Grip", "String", "Blueprint"]],
  ["Braton", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Bronco", ["Barrel", "Receiver", "Blueprint"]],
  ["Gunsen", ["Blade", "Handle", "Blueprint"]],
  ["Quassus", ["Blade", "Handle", "Blueprint"]],
  ["Ballistica", ["Upper Limb", "Lower Limb", "Receiver", "String", "Blueprint"]],
  ["Lex", ["Barrel", "Receiver", "Blueprint"]],
  ["Fang", ["Blade", "Handle", "Blueprint"]],
  ["Tipedo", ["Handle", "Ornament", "Blueprint"]],
  ["Nikana", ["Blade", "Hilt", "Blueprint"]],
  ["Guandao", ["Blade", "Handle", "Blueprint"]],
  ["Astilla", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Acceltra", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Gorgon", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Burston", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Sybaris", ["Barrel", "Receiver", "Stock", "Blueprint"]],
  ["Zhuge", ["Barrel", "Receiver", "String", "Blueprint"]],
  ["Afuris", ["Barrel", "Receiver", "Link", "Blueprint"]],
  ["Knell", ["Barrel", "Receiver", "Blueprint"]],
];

export const REQUIEMS = ["Ris", "Lohk", "Xata", "Vome", "Jahu", "Fass", "Netra", "Khra"];

// ~300 objetos: warframes×partes + armas×partes + requiems + Forma.
export function buildItemPool() {
  const pool = ["Forma Blueprint", ...REQUIEMS];
  for (const f of FRAMES) for (const p of WF_PARTS) pool.push(`${f} Prime ${p}`);
  for (const [wpn, parts] of WEAPONS) for (const p of parts) pool.push(`${wpn} Prime ${p}`);
  return pool;
}

// ---------------------------------------------------------------------------
// Generador de frame de recompensas: k columnas centradas, nombre partido en
// 1-3 líneas (ancho de glifo ~11px/carácter medido en capturas 2560x1440,
// imgW del recorte OCR = 1614), badges Owned/Crafted encima.
// ---------------------------------------------------------------------------
export const REWARD_IMG_W = 1614;
const CHAR_W = 11, WORD_GAP = 10, LINE_H = 22, NAMES_Y = 248, PITCH = 242, CENTER_X = 807;

const bboxWord = (text, cx, cy) => {
  const half = Math.max(20, (text.length * CHAR_W) / 2);
  return { text, bbox: { x0: cx - half, x1: cx + half, y0: cy - 8, y1: cy + 8 } };
};

// Parte el nombre en líneas con un ancho máximo (px) respetando palabras.
function wrapName(words, maxLineW) {
  const lines = [[]];
  let w = 0;
  for (const word of words) {
    const ww = word.length * CHAR_W + (lines.at(-1).length ? WORD_GAP : 0);
    if (w + ww > maxLineW && lines.at(-1).length > 0 && lines.length < 3) {
      lines.push([word]); w = word.length * CHAR_W;
    } else {
      lines.at(-1).push(word); w += ww;
    }
  }
  return lines;
}

/**
 * items: nombres de la pool a colocar (izquierda->derecha).
 * opts.rand: PRNG; opts.narrow: fuerza envolturas a 2-3 líneas; opts.badges:
 * array por columna: null | {owned:N} | {crafted:true}.
 * Devuelve { words, imageW } listo para parseRewards.
 */
export function makeRewardFrame(items, { rand = Math.random, narrow = false, badges = null } = {}) {
  const k = items.length;
  const words = [];
  items.forEach((name, i) => {
    const cx = CENTER_X + (i - (k - 1) / 2) * PITCH;
    const maxW = narrow && rand() < 0.7 ? 180 : 260;
    const lines = wrapName(name.split(" "), maxW);
    const y0 = NAMES_Y - ((lines.length - 1) * LINE_H) / 2;
    lines.forEach((line, li) => {
      const totalW = line.reduce((s, w) => s + w.length * CHAR_W, 0) + (line.length - 1) * WORD_GAP;
      let x = cx - totalW / 2;
      for (const word of line) {
        const ww = word.length * CHAR_W;
        words.push(bboxWord(word, x + ww / 2, y0 + li * LINE_H));
        x += ww + WORD_GAP;
      }
    });
    const badge = badges?.[i];
    if (badge?.crafted) {
      words.push(bboxWord("Crafted", cx + 20, 40));
    } else if (badge?.owned) {
      words.push(bboxWord(String(badge.owned), cx - 40, 40));
      words.push(bboxWord("Owned", cx + 25, 40));
    }
  });
  return { words, imageW: REWARD_IMG_W };
}

// Basura tipo tinte/marca de agua: tokens cortos aleatorios fuera de las filas
// de nombres (el OCR real los produce a decenas; la normalización tira la
// mayoría, pero alguno puede colar como ancla espuria — el parser debe aguantar).
const JUNK = ["ne", "nn", "so", "ve", "cr", "zi", "yo", "kr", "ogd", "po", "al", "rs", "and", "me", "sn", "hs", "ka", "lo", "oo", "ris", "ere", "ho"];
export function addTintJunk(frame, rand, n = 3) {
  for (let i = 0; i < n; i++) {
    const t = JUNK[Math.floor(rand() * JUNK.length)];
    const cx = 120 + rand() * (REWARD_IMG_W - 240);
    const cy = rand() < 0.5 ? 120 + rand() * 80 : 300 + rand() * 60; // entre badges y nombres, o bajo nombres
    frame.words.push(bboxWord(t, cx, cy));
  }
  return frame;
}

// Palabras REALES de la UI de fin de misión que rodean a las recompensas. No son
// ruido ilegible: son inglés legible que el OCR lee bien, y varias se parecen a
// nombres de warframe ("Post"/"Front" ≈ FROST). Si el normalizador las adopta,
// fabrican un ANCLA fantasma que roba los tokens de la recompensa vecina.
export const UI_BACKGROUND_WORDS = [
  "Steel", "Path", "Bonus", "Essence", "Endless", "Credit", "Booster",
  "Relics", "Opened", "Post", "Front", "Host", "Rest", "Reward", "Mission",
  "Complete", "Squad", "Extraction", "Affinity", "Total", "Select", "Items",
];

/**
 * Añade palabras de la UI de fondo alrededor del área de recompensas, como en las
 * capturas reales (banda de jugadores bajo las cartas, bonus más abajo).
 */
export function addUIBackground(frame, rand, n = 4) {
  for (let i = 0; i < n; i++) {
    const t = UI_BACKGROUND_WORDS[Math.floor(rand() * UI_BACKGROUND_WORDS.length)];
    const cx = 120 + rand() * (REWARD_IMG_W - 240);
    const cy = rand() < 0.5 ? 300 + rand() * 60 : 100 + rand() * 60;
    frame.words.push(bboxWord(t, cx, cy));
  }
  return frame;
}
