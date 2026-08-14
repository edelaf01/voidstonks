/**
 * Buscador difuso reutilizable. No sabe nada de Warframe: el vocabulario de dominio entra
 * por `synonyms`, así que el mismo motor sirve para cualquier campo de búsqueda.
 *
 *     const index = buildSearchIndex(nombres, { synonyms: MI_GLOSARIO });
 *     searchIndex("chasis de saryn", index, { limit: 30 });
 *     // => [{ item, text, score }, ...] de más a menos parecido
 */

const DIACRITICS = /[\u0300-\u036f]/g;

// Ojo al ampliar: "set", "prime" o "blueprint" SÍ discriminan y por eso no están aquí.
export const DEFAULT_STOPWORDS = new Set([
  // es
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o",
  "para", "por", "con", "que", "quiero", "queria", "busco", "buscar", "necesito",
  "dame", "ver", "mostrar", "muestrame", "farmear", "farmeo", "conseguir", "sacar",
  "pieza", "piezas", "porfa", "porfavor",
  // en
  "a", "an", "the", "of", "for", "with", "and", "or", "to", "i", "im", "want",
  "wanna", "need", "looking", "look", "search", "find", "show", "me", "my", "get",
  "farm", "farming", "part", "parts", "please", "pls",
]);

/** "Cañón & Culata" -> "canon culata". */
export function normalizeSearchText(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(str) {
  const norm = normalizeSearchText(str);
  return norm ? norm.split(" ") : [];
}

// `max` aborta en cuanto toda la fila lo supera: para descartar un candidato, que es el
// 99% de las llamadas, da igual si la distancia real era 7 u 8.
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length];
}

// En 3 letras, ninguna: con una errata tolerada "lex" casaría con "dex" y "hex".
function allowedTypos(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

/** Parecido palabra a palabra en [0,1]. Bandas: exacta > prefijo > contenida > errata. */
export function tokenSimilarity(q, c) {
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.startsWith(q)) return 0.84 + 0.14 * (q.length / c.length);
  if (q.startsWith(c)) return 0.78 * (c.length / q.length);
  if (c.includes(q) && q.length >= 3) return 0.66 + 0.1 * (q.length / c.length);

  const max = allowedTypos(Math.max(q.length, c.length));
  if (max === 0) return 0;
  const d = editDistance(q, c, max);
  if (d > max) return 0;
  // Techo 0.65, por debajo del suelo de la banda "contenida" (0.66): lo que el usuario
  // escribió bien tiene que ganar siempre a lo que el motor supone que quiso escribir.
  return 0.45 + 0.2 * (1 - d / Math.max(q.length, c.length));
}

function expandTokens(tokens, synonyms) {
  if (!synonyms) return tokens;
  const out = [];
  for (const tk of tokens) {
    const rep = synonyms[tk];
    if (rep === undefined) {
      out.push(tk);
    } else if (Array.isArray(rep)) {
      out.push(...rep);
    } else {
      out.push(...tokenize(rep));
    }
  }
  return out;
}

/** Normaliza, aplica sinónimos y quita muletillas. `null` si no queda nada que buscar. */
export function prepareQuery(query, { synonyms = null, stopwords = DEFAULT_STOPWORDS } = {}) {
  let tokens = expandTokens(tokenize(query), synonyms);
  if (tokens.length === 0) return null;

  if (stopwords && stopwords.size) {
    const kept = tokens.filter((tk) => !stopwords.has(tk));
    // Solo si queda algo: quien busca literalmente "the" merece buscar "the".
    if (kept.length > 0) tokens = kept;
  }

  return { tokens, norm: tokens.join(" ") };
}

function prepareEntry(item, text) {
  const tokens = tokenize(text);
  return {
    item,
    text,
    tokens,
    norm: tokens.join(" "),
    initials: tokens.map((tk) => tk[0]).join(""),
  };
}

/**
 * Precalcula la forma normalizada de cada elemento; reconstruye solo al cambiar la lista.
 * `key` es el campo o función del que sale el texto; sin él, el elemento es el texto.
 */
export function buildSearchIndex(items, { key = null } = {}) {
  const read = typeof key === "function"
    ? key
    : key
      ? (it) => it?.[key]
      : (it) => it;

  const out = [];
  for (const item of items || []) {
    const text = read(item);
    if (typeof text !== "string" || text === "") continue;
    out.push(prepareEntry(item, text));
  }
  return out;
}

/** Puntúa una entrada del índice contra una consulta preparada, en [0,1]. */
export function scoreEntry(q, entry) {
  if (!q || !entry.norm) return 0;

  if (entry.norm === q.norm) return 1;
  if (entry.norm.startsWith(q.norm)) return 0.97;

  let score = 0;

  if (entry.norm.includes(q.norm)) score = 0.9;

  // Iniciales ("sp" -> "Saryn Prime") solo con UNA palabra escrita: con varias, cualquier
  // par de letras sueltas convertiría media base en aciertos.
  if (q.tokens.length === 1) {
    const qt = q.tokens[0];
    if (qt.length >= 2 && entry.initials.startsWith(qt) && entry.tokens.length >= qt.length) {
      score = Math.max(score, 0.8);
    }
  }

  let sum = 0;
  let weight = 0;
  let lastIdx = -1;
  let inOrder = true;
  let allMatched = true;

  for (const qt of q.tokens) {
    let best = 0;
    let bestIdx = -1;
    for (let i = 0; i < entry.tokens.length; i++) {
      const s = tokenSimilarity(qt, entry.tokens[i]);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    }
    if (best === 0) allMatched = false;
    if (bestIdx !== -1) {
      if (bestIdx < lastIdx) inOrder = false;
      lastIdx = bestIdx;
    }
    // Ponderar por longitud: en "chasis saryn" ninguna de las dos debe mandar sola.
    sum += best * qt.length;
    weight += qt.length;
  }

  let tokenScore = weight > 0 ? sum / weight : 0;

  if (inOrder && q.tokens.length > 1) tokenScore = Math.min(1, tokenScore * 1.05);
  if (!allMatched) tokenScore *= 0.55;

  score = Math.max(score, tokenScore);

  // Desempate por concisión: buscando "saryn", "Saryn Prime" antes que "Saryn Prime
  // Systems Blueprint". El factor es pequeño (6%) para no reordenar aciertos reales.
  const brevity = q.norm.length / Math.max(q.norm.length, entry.norm.length);
  return score * (0.94 + 0.06 * brevity);
}

/**
 * @param {{limit?: number, threshold?: number, synonyms?: object, stopwords?: Set}} [opts]
 *        limit 0 = sin límite; threshold es la puntuación mínima para contar como acierto
 * @returns {Array<{item, text, score}>} de mejor a peor
 */
export function searchIndex(query, index, opts = {}) {
  const { limit = 0, threshold = 0.45, synonyms = null, stopwords = DEFAULT_STOPWORDS } = opts;
  const q = prepareQuery(query, { synonyms, stopwords });
  if (!q) return [];

  const hits = [];
  for (const entry of index) {
    const score = scoreEntry(q, entry);
    if (score >= threshold) hits.push({ item: entry.item, text: entry.text, score });
  }

  // Empate a puntuación -> alfabético, para que la lista no baile entre búsquedas.
  hits.sort((a, b) => (b.score - a.score) || a.text.localeCompare(b.text));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

/** Indexa y busca de una vez. Con listas grandes en vivo, usa buildSearchIndex aparte. */
export function searchItems(query, items, opts = {}) {
  return searchIndex(query, buildSearchIndex(items, opts), opts);
}
