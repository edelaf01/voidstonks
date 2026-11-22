import { dbHelper } from "../../repositories/storage.repository.js";
import { getLichWeapons } from "../../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../server_clock.service.js";

const CACHE_KEY = "lich_weapons_cache";

function normalizeVendors(payload) {
    const vendors = Array.isArray(payload?.vendors) ? payload.vendors : [];
    return vendors.filter((v) => v?.key && Array.isArray(v.weapons) && v.weapons.length > 0);
}

export const lichWeaponsMeta = { fromCache: false, ts: null, failed: false };

function withMeta(vendors, fromCache, ts, failed) {
    lichWeaponsMeta.fromCache = fromCache;
    lichWeaponsMeta.ts = ts;
    lichWeaponsMeta.failed = failed;
    Object.defineProperties(vendors, {
        fromCache: { value: fromCache, configurable: true },
        ts: { value: ts, configurable: true },
        failed: { value: failed, configurable: true },
    });
    return vendors;
}

async function lastKnownGood(networkFailed = true) {
    const cached = await dbHelper.get(CACHE_KEY);
    const vendors = Array.isArray(cached?.data) ? cached.data : [];
    if (vendors.length === 0) return withMeta([], false, null, networkFailed);
    const soonestEnd = Math.min(...vendors.map((v) => Number(v.end) || 0));
    return soonestEnd > serverNow()
        ? withMeta(vendors, true, cached?.ts || null, false)
        : withMeta([], false, null, networkFailed);
}

export async function fetchLichWeapons(force = false) {
    try {
        // unsynced, a skewed clock sees the window as expired and refetches in a loop
        await syncServerClock();

        const res = await getLichWeapons(force);
        if (res.ok) {
            const vendors = normalizeVendors(await res.json());
            if (vendors.length > 0) {
                const ts = Date.now();
                await dbHelper.set(CACHE_KEY, { data: vendors, ts });
                return withMeta(vendors, false, ts, false);
            }
            return await lastKnownGood(false);
        }
        return await lastKnownGood(true);
    } catch (e) {
        console.error("Lich weapons error:", e);
        return lastKnownGood(true).catch(() => withMeta([], false, null, true));
    }
}
