import { fetchWeaponHistory, fetchCurrentRivens } from "../../repositories/riven.repository.js";
import { normalizeIndexFilters, INDEX_FILTER_DEFAULTS } from "../../utils/rivens/riven_index_filter.js";

export async function getWeaponHistory(weaponName) {
    try {
        const data = await fetchWeaponHistory(weaponName);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

// keys the worker sends next to the weapons that are not weapons
const CLAVES_META = new Set(["NOTE", "STATUS", "VERSION", "TTL", "DATA", "ERROR", "__BASELINE"]);

export async function getRivenIndex() {
    let data;
    try {
        data = await fetchCurrentRivens();
    } catch {
        return { ok: false };
    }

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

const FILTERS_KEY = "vs_riven_index_filters_v1";

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
