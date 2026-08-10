import { dbHelper } from "../repositories/storage.repository.js";
import { getLichWeapons } from "../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../utils/server_clock.js";

const CACHE_KEY = "lich_weapons_cache";

const BONUS_RETRY_MS = 30 * 60 * 1000;
const MIN_CACHE_MS = 60 * 1000;

function normalizeVendors(payload) {
    const vendors = Array.isArray(payload?.vendors) ? payload.vendors : [];
    return vendors.filter((v) => v?.key && Array.isArray(v.weapons) && v.weapons.length > 0);
}

export async function fetchLichWeapons(force = false) {
    try {
        // unsynced, a skewed clock sees the window as expired and refetches in a loop
        await syncServerClock();

        const cached = await dbHelper.get(CACHE_KEY);
        if (!force && cached?.expiryTime > serverNow()) return cached.data;

        const res = await getLichWeapons(force);
        if (!res.ok) return cached?.data || [];

        const payload = await res.json();
        const vendors = normalizeVendors(payload);
        if (vendors.length === 0) return cached?.data || [];

        const now = serverNow();
        const soonestEnd = Math.min(...vendors.map((v) => Number(v.end) || 0));
        const pending = vendors.some((v) => v.weapons.some((w) => !w.bonus));
        const ceiling = pending ? Math.min(now + BONUS_RETRY_MS, soonestEnd) : soonestEnd;
        const expiryTime = Math.max(now + MIN_CACHE_MS, ceiling);
        await dbHelper.set(CACHE_KEY, { expiryTime, data: vendors });
        return vendors;
    } catch (e) {
        console.error("Lich weapons error:", e);
        return [];
    }
}
