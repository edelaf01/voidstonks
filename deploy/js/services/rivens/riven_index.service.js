import { fetchWeaponHistory, fetchCurrentRivens } from "../../repositories/riven.repository.js";
import { normalizeIndexFilters, INDEX_FILTER_DEFAULTS } from "../../utils/rivens/riven_index_filter.js";

/**
 * Historial y catálogo de rivens: lo que el componente necesita del worker de rivens.
 *
 * Existe para que `ui_rivens.js` no hable con el repositorio. Además de la capa, absorbe dos
 * cosas que el componente repetía en cada uno de sus cuatro puntos de llamada:
 *
 *   - el `try/catch`: el repositorio LANZA cuando la respuesta no es ok, así que cada llamada
 *     tenía que envolverse (y una de ellas no lo hacía, solo un `.then`);
 *   - la forma de la respuesta: el worker devuelve el catálogo a veces como `{data: {...}}` y a
 *     veces plano, y quien lo consume tenía que saberlo.
 */

/**
 * Historial de precios de un arma. Un fallo aquí no rompe nada: la tasación tiene su respaldo
 * local, así que se devuelve lista vacía y el llamador decide si avisa.
 * @returns {Promise<Array>}
 */
export async function getWeaponHistory(weaponName) {
    try {
        const data = await fetchWeaponHistory(weaponName);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/**
 * Claves que el worker mete junto a las armas y que NO son un arma.
 *
 * Colarlas en el mapa las pinta como una entrada más del índice: aparecía "TTL" entre los
 * resultados del buscador. La lista vive aquí y no en el componente porque es conocimiento de
 * la respuesta, no de cómo se enseña.
 */
const CLAVES_META = new Set(["NOTE", "STATUS", "VERSION", "TTL", "DATA", "ERROR", "__BASELINE"]);

/**
 * Catálogo de rivens del worker, ya desenvuelto, limpio de metadatos y validado.
 *
 * @returns {Promise<{ok: true, weapons: object, baseline: object|null} | {ok: false}>}
 *   `baseline` son los pesos globales que el worker adjunta como `__baseline`: van aparte
 *   porque no son un arma.
 */
export async function getRivenIndex() {
    let data;
    try {
        data = await fetchCurrentRivens();
    } catch {
        return { ok: false };
    }

    // El worker envuelve en {data} unas veces y otras no.
    if (data && data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
        data = data.data;
    }
    if (!data || data.error || !Object.keys(data).length) return { ok: false };

    const baseline = data.__baseline?.stat_weights ? data.__baseline : null;
    const weapons = {};
    for (const [clave, valor] of Object.entries(data)) {
        if (!CLAVES_META.has(clave.toUpperCase())) weapons[clave] = valor;
    }

    return { ok: true, weapons, baseline };
}

// ---- Filtros del índice ----

const FILTERS_KEY = "vs_riven_index_filters_v1";

/**
 * Filtros del índice, saneados. Aquí y no en el componente porque un ui.component no toca
 * localStorage (ARCHITECTURE.md §A); los predicados viven aparte, en utils/rivens.
 * @param {string[]} validTypes tipos presentes hoy: uno guardado que ya no exista cae a "".
 */
export function getIndexFilterPrefs(validTypes = []) {
    try {
        return normalizeIndexFilters(JSON.parse(localStorage.getItem(FILTERS_KEY)), validTypes);
    } catch {
        return { ...INDEX_FILTER_DEFAULTS };
    }
}

export function saveIndexFilterPrefs(prefs) {
    try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(prefs));
    } catch (e) {
        console.warn("[riven-index] no se pudieron guardar los filtros:", e);
    }
}
