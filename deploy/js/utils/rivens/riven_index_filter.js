/**
 * Riven index filters: which weapons show, not in what order. Pure module, testable without a browser.
 *
 * `weaponMap` is the one in state ({ [weapon]: { d: disposition, t: type } }), passed in so tests can
 * build their own.
 */

/** Zaw components without a riven of their own. */
export const EXCLUDED_COMPONENTS = new Set([
    // grips
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    // links
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG",
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II",
]);

/** Service keys that travel in the index JSON and are not weapons. */
export const META_KEYS = new Set(["NOTE", "STATUS", "VERSION", "TTL", "DATA", "ERROR", "__BASELINE"]);

const PREFIXES = ["kuva", "tenet", "coda", "carmine", "rakta", "synoid", "sancti", "vaykor",
    "telos", "secura", "mk1", "prisma", "mara", "dex"];
const SUFFIXES = ["prime", "vandal", "wraith", "prisma", "coda"];

/**
 * The index shows ONE card per family, the base, with the siblings inside.
 */
export function isBaseWeapon(name) {
    const lower = String(name || "").toLowerCase().trim();
    if (PREFIXES.some((p) => lower.startsWith(p + " ") || lower.startsWith(p + "-"))) return false;
    return !SUFFIXES.some((x) => lower.endsWith(" " + x));
}

export const INDEX_FILTER_DEFAULTS = Object.freeze({
    type: "",        // "" = any, otherwise a weaponMap[x].t key
    dispo: "",       // "" | "high" (>= 1.15) | "low" (<= 0.85)
    maxPrice: 0,     // 0 = no cap, platinum over the real price
    withData: false, // only weapons with observed market
});

/**
 * Weapon types actually present in the data, sorted: a fixed list would offer stale types and hide new
 * ones.
 */
export function observedTypes(names, weaponMap) {
    const tipos = new Set();
    for (const n of names) {
        const t = weaponMap?.[n]?.t;
        if (t) tipos.add(t);
    }
    return [...tipos].sort();
}

/**
 * Sanitizes what comes from localStorage: a NaN maxPrice emptied the whole list.
 */
export function normalizeIndexFilters(raw, validTypes = []) {
    const p = raw && typeof raw === "object" ? raw : {};
    const precio = Number.parseInt(p.maxPrice, 10);
    return {
        type: validTypes.includes(p.type) ? p.type : "",
        dispo: p.dispo === "high" || p.dispo === "low" ? p.dispo : "",
        maxPrice: Number.isFinite(precio) && precio > 0 ? precio : 0,
        withData: p.withData === true,
    };
}

/**
 * Real price for the cap filter: median of closed sales, official average as fallback. Not the WFM
 * ask: that is what someone ASKS.
 */
export function realPrice(data) {
    const m = data?.de_unrolled?.median;
    if (m > 0) return m;
    if (data?.official_median > 0) return data.official_median;
    return data?.official_avg_price || 0;
}

/**
 * Weapons without market enter the index filled with zeros so they can be searched.
 */
export function hasMarketData(data) {
    if (!data) return false;
    return realPrice(data) > 0
        || (data.wfm_avg_price || data.wfm_avg || 0) > 0
        || (data.liquidity_score || data.popularity_pct || 0) > 0;
}

const DISPO_ALTA = 1.15;
const DISPO_BAJA = 0.85;

/**
 * One predicate per filter: the same map filters and finds which filter emptied the list, so the two
 * cannot disagree.
 */
export const INDEX_FILTER_TESTS = {
    type: (prefs, weaponMap) => ([name]) => weaponMap?.[name]?.t === prefs.type,
    dispo: (prefs, weaponMap) => ([name]) => {
        const d = weaponMap?.[name]?.d;
        if (!Number.isFinite(d)) return false;
        return prefs.dispo === "high" ? d >= DISPO_ALTA : d <= DISPO_BAJA;
    },
    maxPrice: (prefs) => ([, data]) => {
        const p = realPrice(data);
        // an unknown price does NOT pass a cap set on purpose
        return p > 0 && p <= prefs.maxPrice;
    },
    withData: () => ([, data]) => hasMarketData(data),
};

function activeKeys(prefs) {
    return ["type", "dispo", "maxPrice", "withData"].filter((k) => {
        const v = prefs[k];
        return k === "withData" ? v === true : Boolean(v);
    });
}

/**
 * @param {Array<[string, object]>} entries
 * @returns {Array<[string, object]>}
 */
export function applyIndexFilters(entries, prefs = INDEX_FILTER_DEFAULTS, weaponMap = {}) {
    let out = entries;
    for (const key of activeKeys(prefs)) {
        out = out.filter(INDEX_FILTER_TESTS[key](prefs, weaponMap));
    }
    return out;
}

/**
 * Which filter emptied the list: drops one at a time and the first that returns results is the culprit.
 * @returns {{ key: string, count: number } | null}
 */
export function whyIndexEmpty(entries, prefs, weaponMap = {}) {
    for (const key of activeKeys(prefs)) {
        const sin = applyIndexFilters(entries, { ...prefs, [key]: INDEX_FILTER_DEFAULTS[key] }, weaponMap);
        if (sin.length > 0) return { key, count: sin.length };
    }
    return null;
}
