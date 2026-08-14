import { fetchWeaponHistory, fetchCurrentRivens } from "../../repositories/riven.repository.js";

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
