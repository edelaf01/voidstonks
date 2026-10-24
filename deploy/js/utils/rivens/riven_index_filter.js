// filters which weapons show in the riven index

export const EXCLUDED_COMPONENTS = new Set([
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG",
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II",
]);

export const META_KEYS = new Set(["NOTE", "STATUS", "VERSION", "TTL", "DATA", "ERROR", "__BASELINE"]);

const PREFIXES = ["kuva", "tenet", "coda", "carmine", "rakta", "synoid", "sancti", "vaykor",
    "telos", "secura", "mk1", "prisma", "mara", "dex"];
const SUFFIXES = ["prime", "vandal", "wraith", "prisma", "coda"];

export function isBaseWeapon(name) {
    const lower = String(name || "").toLowerCase().trim();
    if (PREFIXES.some((p) => lower.startsWith(p + " ") || lower.startsWith(p + "-"))) return false;
    return !SUFFIXES.some((x) => lower.endsWith(" " + x));
}

export const INDEX_FILTER_DEFAULTS = Object.freeze({
    type: "",
    maxPrice: 0,
    withData: false,
});

export function observedTypes(names, weaponMap) {
    const tipos = new Set();
    for (const n of names) {
        const t = weaponMap?.[n]?.t;
        if (t) tipos.add(t);
    }
    return [...tipos].sort();
}

// sanitizes what comes from localStorage: a NaN maxPrice emptied the whole list
export function normalizeIndexFilters(raw, validTypes = []) {
    const p = raw && typeof raw === "object" ? raw : {};
    const precio = Number.parseInt(p.maxPrice, 10);
    return {
        type: validTypes.includes(p.type) ? p.type : "",
        maxPrice: Number.isFinite(precio) && precio > 0 ? precio : 0,
        withData: p.withData === true,
    };
}

export function realPrice(data) {
    const m = data?.de_unrolled?.median;
    if (m > 0) return m;
    if (data?.official_median > 0) return data.official_median;
    return data?.official_avg_price || 0;
}

export function hasMarketData(data) {
    if (!data) return false;
    return realPrice(data) > 0
        || (data.wfm_avg_price || data.wfm_avg || 0) > 0
        || (data.liquidity_score || data.popularity_pct || 0) > 0;
}

export const INDEX_FILTER_TESTS = {
    type: (prefs, weaponMap) => ([name]) => weaponMap?.[name]?.t === prefs.type,
    maxPrice: (prefs) => ([, data]) => {
        const p = realPrice(data);
        return p > 0 && p <= prefs.maxPrice;
    },
    withData: () => ([, data]) => hasMarketData(data),
};

function activeKeys(prefs) {
    return ["type", "maxPrice", "withData"].filter((k) => {
        const v = prefs[k];
        return k === "withData" ? v === true : Boolean(v);
    });
}

export function applyIndexFilters(entries, prefs = INDEX_FILTER_DEFAULTS, weaponMap = {}) {
    let out = entries;
    for (const key of activeKeys(prefs)) {
        out = out.filter(INDEX_FILTER_TESTS[key](prefs, weaponMap));
    }
    return out;
}

export function whyIndexEmpty(entries, prefs, weaponMap = {}) {
    for (const key of activeKeys(prefs)) {
        const sin = applyIndexFilters(entries, { ...prefs, [key]: INDEX_FILTER_DEFAULTS[key] }, weaponMap);
        if (sin.length > 0) return { key, count: sin.length };
    }
    return null;
}
