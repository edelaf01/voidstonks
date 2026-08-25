/**
 * Filtros del índice de rivens: qué armas se ven, no en qué orden.
 *
 * El índice tenía siete criterios de ORDEN y ni un filtro, así que "armas con mercado vivo por
 * debajo de 200 p" solo se podía contestar reordenando la lista entera y bajando a mano. Aquí
 * viven los predicados y el diagnóstico de "por qué se ha quedado vacío", en un módulo puro
 * para poder probarlos sin navegador — el mismo trato que `set_recommendations`.
 *
 * `weaponMap` es el de state: { [arma]: { d: disposición, t: tipo } }. Se pasa por parámetro
 * y no se lee del estado para que las pruebas puedan montar el suyo.
 */

/** Componentes de Zaw que no llevan riven propio y ensucian el índice. */
export const EXCLUDED_COMPONENTS = new Set([
    // Empuñaduras
    "JAYAP", "KORB", "KROOSTRA", "KWATH", "LAKA", "PEYE", "SEEKALLA", "SHTUNG", "PLAGUE AKWIN", "PLAGUE BOKWIN",
    // Uniones
    "JAI", "RUHANG", "JAI II", "RUHANG II", "VARGEET JAI", "VARGEET RUHANG", "EKWANA JAI", "EKWANA RUHANG",
    "VARGEET II JAI", "VARGEET II RUHANG", "EKWANA II JAI", "EKWANA II RUHANG", "VARGEET JAI II", "VARGEET RUHANG II",
    "EKWANA JAI II", "EKWANA RUHANG II",
]);

/** Claves de servicio que viajan en el JSON del índice y no son armas. */
export const META_KEYS = new Set(["NOTE", "STATUS", "VERSION", "TTL", "DATA", "ERROR", "__BASELINE"]);

const PREFIXES = ["kuva", "tenet", "coda", "carmine", "rakta", "synoid", "sancti", "vaykor",
    "telos", "secura", "mk1", "prisma", "mara", "dex"];
const SUFFIXES = ["prime", "vandal", "wraith", "prisma", "coda"];

/**
 * ¿Es el arma "de base" de su familia, o una variante? El índice enseña UNA tarjeta por
 * familia —la base—, con las hermanas dentro; sin esto salían Boltor, Boltor Prime y Telos
 * Boltor como tres entradas sueltas.
 */
export function isBaseWeapon(name) {
    const lower = String(name || "").toLowerCase().trim();
    if (PREFIXES.some((p) => lower.startsWith(p + " ") || lower.startsWith(p + "-"))) return false;
    return !SUFFIXES.some((x) => lower.endsWith(" " + x));
}

export const INDEX_FILTER_DEFAULTS = Object.freeze({
    type: "",        // "" = cualquiera; si no, la clave de weaponMap[x].t
    dispo: "",       // "" | "high" (>= 1.15) | "low" (<= 0.85)
    maxPrice: 0,     // 0 = sin tope, en platino sobre el precio real
    withData: false, // solo armas con mercado observado
});

/** Tipos de arma que aparecen de verdad en los datos, ordenados. Alimenta el desplegable:
 *  una lista fija acabaría ofreciendo tipos que ya no existen y escondiendo los nuevos. */
export function observedTypes(names, weaponMap) {
    const tipos = new Set();
    for (const n of names) {
        const t = weaponMap?.[n]?.t;
        if (t) tipos.add(t);
    }
    return [...tipos].sort();
}

/** Sanea lo que venga de localStorage: un maxPrice NaN filtraba con NaN y vaciaba la lista
 *  entera sin que nada lo explicara. Mismo tropiezo que ya tuvieron las rutas. */
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
 * Precio "real" de un arma para el filtro de tope: la mediana de ventas cerradas, con la
 * media oficial de reserva. NO se usa el precio pedido en WFM: es lo que alguien PIDE, y
 * poner "hasta 200 p" contra una petición deja fuera armas que se cierran por mucho menos.
 */
export function realPrice(data) {
    const m = data?.de_unrolled?.median;
    if (m > 0) return m;
    if (data?.official_median > 0) return data.official_median;
    return data?.official_avg_price || 0;
}

/** ¿Se ha visto mercado de esta arma? Las que no lo tienen entran en el índice rellenas de
 *  ceros para poder buscarlas, y son justo las que estorban al mirar precios. */
export function hasMarketData(data) {
    if (!data) return false;
    return realPrice(data) > 0
        || (data.wfm_avg_price || data.wfm_avg || 0) > 0
        || (data.liquidity_score || data.popularity_pct || 0) > 0;
}

const DISPO_ALTA = 1.15;
const DISPO_BAJA = 0.85;

/** Un predicado por filtro, en un mapa: el mismo objeto sirve para filtrar y para averiguar
 *  cuál de ellos vació la lista, así que los dos no pueden discrepar. */
export const INDEX_FILTER_TESTS = {
    type: (prefs, weaponMap) => ([name]) => weaponMap?.[name]?.t === prefs.type,
    dispo: (prefs, weaponMap) => ([name]) => {
        const d = weaponMap?.[name]?.d;
        if (!Number.isFinite(d)) return false;
        return prefs.dispo === "high" ? d >= DISPO_ALTA : d <= DISPO_BAJA;
    },
    maxPrice: (prefs) => ([, data]) => {
        const p = realPrice(data);
        // Sin precio conocido NO cumple "hasta 200 p": has puesto un tope a propósito, y
        // colar lo que no se sabe cuánto vale es justo lo contrario de lo que has pedido.
        return p > 0 && p <= prefs.maxPrice;
    },
    withData: () => ([, data]) => hasMarketData(data),
};

/** Qué filtros están puestos ahora mismo, en el orden en que se diagnostican. */
function activeKeys(prefs) {
    return ["type", "dispo", "maxPrice", "withData"].filter((k) => {
        const v = prefs[k];
        return k === "withData" ? v === true : Boolean(v);
    });
}

/**
 * @param {Array<[string, object]>} entries pares [arma, datos] del índice.
 * @returns {Array<[string, object]>} los que pasan todos los filtros activos.
 */
export function applyIndexFilters(entries, prefs = INDEX_FILTER_DEFAULTS, weaponMap = {}) {
    let out = entries;
    for (const key of activeKeys(prefs)) {
        out = out.filter(INDEX_FILTER_TESTS[key](prefs, weaponMap));
    }
    return out;
}

/**
 * Cuál de los filtros dejó la lista vacía. Se suelta uno cada vez y el primero que devuelve
 * resultados es el culpable: "no hay armas porque pediste ≤ 50 p" se puede deshacer; "no hay
 * resultados" manda a probar a ciegas. Es el mismo diagnóstico que hace el panel de rutas.
 *
 * @returns {{ key: string, count: number } | null} null si el vacío no lo causa un filtro.
 */
export function whyIndexEmpty(entries, prefs, weaponMap = {}) {
    for (const key of activeKeys(prefs)) {
        const sin = applyIndexFilters(entries, { ...prefs, [key]: INDEX_FILTER_DEFAULTS[key] }, weaponMap);
        if (sin.length > 0) return { key, count: sin.length };
    }
    return null;
}
