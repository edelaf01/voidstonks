// domain-agnostic fuzzy search engine using token similarity and synonyms

const DIACRITICS = /[\u0300-\u036f]/g;

export const DEFAULT_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o",
  "para", "por", "con", "que", "quiero", "queria", "busco", "buscar", "necesito",
  "dame", "ver", "mostrar", "muestrame", "farmear", "farmeo", "conseguir", "sacar",
  "pieza", "piezas", "porfa", "porfavor",
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

function allowedTypos(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

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
  // capped at 0.65 under the contained band floor so exact typing beats engine guesses
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

export function prepareQuery(query, { synonyms = null, stopwords = DEFAULT_STOPWORDS } = {}) {
  let tokens = expandTokens(tokenize(query), synonyms);
  if (tokens.length === 0) return null;

  if (stopwords && stopwords.size) {
    const kept = tokens.filter((tk) => !stopwords.has(tk));
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

export function scoreEntry(q, entry) {
  if (!q || !entry.norm) return 0;

  if (entry.norm === q.norm) return 1;
  if (entry.norm.startsWith(q.norm)) return 0.97;

  let score = 0;

  if (entry.norm.includes(q.norm)) score = 0.9;

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
    sum += best * qt.length;
    weight += qt.length;
  }

  let tokenScore = weight > 0 ? sum / weight : 0;

  if (inOrder && q.tokens.length > 1) tokenScore = Math.min(1, tokenScore * 1.05);
  if (!allMatched) tokenScore *= 0.55;

  score = Math.max(score, tokenScore);

  const brevity = q.norm.length / Math.max(q.norm.length, entry.norm.length);
  return score * (0.94 + 0.06 * brevity);
}

export function searchIndex(query, index, opts = {}) {
  const { limit = 0, threshold = 0.45, synonyms = null, stopwords = DEFAULT_STOPWORDS } = opts;
  const q = prepareQuery(query, { synonyms, stopwords });
  if (!q) return [];

  const hits = [];
  for (const entry of index) {
    const score = scoreEntry(q, entry);
    if (score >= threshold) hits.push({ item: entry.item, text: entry.text, score });
  }

  hits.sort((a, b) => (b.score - a.score) || a.text.localeCompare(b.text));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

export function searchItems(query, items, opts = {}) {
  return searchIndex(query, buildSearchIndex(items, opts), opts);
}
