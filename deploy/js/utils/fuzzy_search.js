/**
 * Reusable fuzzy search. Knows nothing about Warframe: domain vocabulary comes in through `synonyms`, so the
 * same engine serves any search field.
 *
 *     const index = buildSearchIndex(nombres, { synonyms: MI_GLOSARIO });
 *     searchIndex("chasis de saryn", index, { limit: 30 });
 *     // => [{ item, text, score }, ...] from most to least similar
 */

const DIACRITICS = /[\u0300-\u036f]/g;

// careful when extending: "set", "prime" or "blueprint" DO discriminate, that is why they are not here
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

// `max` bails as soon as the whole row passes it: to discard a candidate, 99% of calls, the real distance
// does not matter
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

// none at 3 letters: with one typo allowed "lex" would match "dex" and "hex"
function allowedTypos(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

/** Word to word similarity in [0,1]. Bands: exact > prefix > contained > typo. */
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
  // capped at 0.65, under the floor of the "contained" band (0.66): what the user typed right must always beat
  // what the engine guesses they meant
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

/** Normalizes, applies synonyms and drops filler words. `null` when nothing is left to search. */
export function prepareQuery(query, { synonyms = null, stopwords = DEFAULT_STOPWORDS } = {}) {
  let tokens = expandTokens(tokenize(query), synonyms);
  if (tokens.length === 0) return null;

  if (stopwords && stopwords.size) {
    const kept = tokens.filter((tk) => !stopwords.has(tk));
    // only when something is left: whoever literally searches "the" deserves to search "the"
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
 * Precomputes the normalized form of each item; rebuilt only when the list changes. `key` is the field or
 * function the text comes from; without it, the item is the text.
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

/** Scores an index entry against a prepared query, in [0,1]. */
export function scoreEntry(q, entry) {
  if (!q || !entry.norm) return 0;

  if (entry.norm === q.norm) return 1;
  if (entry.norm.startsWith(q.norm)) return 0.97;

  let score = 0;

  if (entry.norm.includes(q.norm)) score = 0.9;

  // initials ("sp" -> "Saryn Prime") only with ONE typed word: with several, any pair of loose letters would
  // turn half the base into hits
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
    // weighted by length: in "chasis saryn" neither should rule alone
    sum += best * qt.length;
    weight += qt.length;
  }

  let tokenScore = weight > 0 ? sum / weight : 0;

  if (inOrder && q.tokens.length > 1) tokenScore = Math.min(1, tokenScore * 1.05);
  if (!allMatched) tokenScore *= 0.55;

  score = Math.max(score, tokenScore);

  // tie break by brevity: searching "saryn" puts "Saryn Prime" before "Saryn Prime Systems Blueprint". The
  // factor is small (6%) so real hits are not reordered
  const brevity = q.norm.length / Math.max(q.norm.length, entry.norm.length);
  return score * (0.94 + 0.06 * brevity);
}

/**
 * @param {{limit?: number, threshold?: number, synonyms?: object, stopwords?: Set}} [opts]
 *        limit 0 = no limit; threshold is the minimum score to count as a hit
 * @returns {Array<{item, text, score}>} best to worst
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

  // tie on score -> alphabetical, so the list does not jump between searches
  hits.sort((a, b) => (b.score - a.score) || a.text.localeCompare(b.text));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

/** Indexes and searches in one go. For big live lists, use buildSearchIndex apart. */
export function searchItems(query, items, opts = {}) {
  return searchIndex(query, buildSearchIndex(items, opts), opts);
}
