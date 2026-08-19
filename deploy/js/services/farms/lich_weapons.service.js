import { dbHelper } from "../../repositories/storage.repository.js";
import { getLichWeapons } from "../../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../server_clock.service.js";

const CACHE_KEY = "lich_weapons_cache";

function normalizeVendors(payload) {
    const vendors = Array.isArray(payload?.vendors) ? payload.vendors : [];
    return vendors.filter((v) => v?.key && Array.isArray(v.weapons) && v.weapons.length > 0);
}

async function lastKnownGood() {
    const cached = await dbHelper.get(CACHE_KEY);
    const vendors = Array.isArray(cached?.data) ? cached.data : [];
    if (vendors.length === 0) return [];
    const soonestEnd = Math.min(...vendors.map((v) => Number(v.end) || 0));
    return soonestEnd > serverNow() ? vendors : [];
}

export async function fetchLichWeapons(force = false) {
    try {
        // unsynced, a skewed clock sees the window as expired and refetches in a loop
        await syncServerClock();

        const res = await getLichWeapons(force);
        if (res.ok) {
            const vendors = normalizeVendors(await res.json());
            if (vendors.length > 0) {
                await dbHelper.set(CACHE_KEY, { data: vendors });
                return vendors;
            }
        }
        return lastKnownGood();
    } catch (e) {
        console.error("Lich weapons error:", e);
        return lastKnownGood().catch(() => []);
    }
}
