import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "./storage.repository.js";

async function fetchWithTimeout(url, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

/**
 * http cache policy: worker ttl does not reach the browser (`max-age=18000`, 5 h), so the
 * client declares data lifetimes: rotating (fissures, bounties, arbitration, lich weapons),
 * live (current value only), catalog (changes with game patches)
 */

/**
 * data expiring at a specific time: `no-cache` forces the browser to always revalidate
 * @param {string} query worker querystring without leading "?"
 * @param {{force?: boolean, timeout?: number}} [opts] force uses a fresh cache key to bypass
 *   edge stale-while-revalidate right after rotation
 * @returns {Promise<Response>}
 */
async function fetchRotating(query, { force = false, timeout = 15000 } = {}) {
    let url = `${WORKER_URL}?${query}`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, { cache: "no-cache", timeout });
}

/**
 * data where only the current value is valid: `no-store` instead of `no-cache`
 * @param {string} query worker querystring without leading "?"
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<Response>}
 */
async function fetchLive(query, { timeout = 10000 } = {}) {
    return fetchWithTimeout(`${WORKER_URL}?${query}`, { cache: "no-store", timeout });
}

const DROPS_INFO_URL = "https://raw.githubusercontent.com/WFCD/warframe-drop-data/gh-pages/data/info.json";

async function dropsVersion() {
    try {
        const res = await fetchWithTimeout(DROPS_INFO_URL, { timeout: 4000 });
        const info = res.ok ? await res.json() : null;
        return info?.hash ? String(info.hash) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} cacheKey
 * @param {number} cacheTtl
 * @returns {Promise<object>}
 */
export async function loadRelicsData(cacheKey, cacheTtl) {
    const [version, cachedRecord] = await Promise.all([
        dropsVersion(),
        Promise.resolve().then(() => dbHelper.get(cacheKey)).catch((e) => { console.warn("Cache local ignorada:", e); return null; }),
    ]);
    if (cachedRecord && (version ? cachedRecord.version === version : Date.now() - cachedRecord.timestamp < cacheTtl)) {
        return cachedRecord.data;
    }

    // version creates a fresh cache key in both browser and worker caches
    const v = version ? `&v=${version}` : "";
    const [relicsRes, missionsRes, bountiesRes] = await Promise.all([
        fetchWithTimeout(`${WORKER_URL}?type=relics_opt${v}`),
        fetchWithTimeout(`${WORKER_URL}?type=missions_opt${v}`),
        fetchWithTimeout(`${WORKER_URL}?type=bounties_opt${v}`),
    ]);

    if (!relicsRes.ok || !missionsRes.ok || !bountiesRes.ok) {
        throw new Error("Worker Error (Partial)");
    }

    const [rData, mData, bData] = await Promise.all([
        relicsRes.json(),
        missionsRes.json(),
        bountiesRes.json(),
    ]);

    const rawData = {
        relics: rData.relics || [],
        missionRewards: mData.missionRewards || {},
        cetusBountyRewards: bData.cetus || [],
        solarisBountyRewards: bData.solaris || [],
        zarimanRewards: bData.zariman || [],
        deimosRewards: bData.deimos || [],
    };

    await dbHelper.set(cacheKey, { timestamp: Date.now(), version, data: rawData });
    return rawData;
}

export async function fetchPrimeManifest() {
    try {
        const [resEntities, resWeapons] = await Promise.all([
            fetch("assets/json/cleaned_entities.json"),
            fetch("assets/json/cleaned_weapons.json").catch(() => null)
        ]);

        if (!resEntities.ok) throw new Error("Entities Load Failed");
        const data = await resEntities.json();
        state.primeManifest = data;
        state.entitiesDB = data;
        console.log("Entities Manifest Loaded:", data.length, "items");
        
        const { updateDucatsDB } = await import("../services/inventory/relics.service.js");
        updateDucatsDB(data);

        if (resWeapons && resWeapons.ok) {
            const weaponsData = await resWeapons.json();
            const primeWeapons = weaponsData.filter(item => item.isPrime);
            state.primeWeaponsManifest = primeWeapons;
            console.log("Prime Weapons Loaded for Ducats:", primeWeapons.length, "items");
            updateDucatsDB(primeWeapons);
        }
    } catch (e) {
        console.warn("Error loading entities/weapons manifest:", e);
    }
}

export async function initializeOCRDatabase() {
    try {
        const res = await fetchWithTimeout(`${WORKER_URL}?type=prime_items_list`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        state.ocrReferenceList = data.items;
    } catch (e) {
        console.error("Error detallado al cargar referencia OCR:", e);
        throw e;
    }
}

export async function fetchActiveResurgence() {
    const CACHE_KEY = "voidstonks_active_resurgence_list_v2";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY)) {
            state.activeResurgenceList = new Set(cached.data);
            return;
        }

        const res = await fetchWithTimeout(`${WORKER_URL}?type=aya`);
        if (!res.ok) return;
        const data = await res.json();
        const traders = data.PrimeVaultTraders || [];
        
        const resurgenceSet = new Set();
        traders.forEach(trader => {
            if (trader.Closed) return;
            const manifest = trader.Manifest || [];
            manifest.forEach(item => {
                const itemName = item.ItemType;
                if (itemName && itemName.includes("Relic")) {
                    const cleaned = itemName.replace(" Relic", "").trim().toUpperCase();
                    resurgenceSet.add(cleaned);
                }
            });
        });

        state.activeResurgenceList = resurgenceSet;
        await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: Array.from(resurgenceSet) });
    } catch (e) {
        console.warn("Error fetching resurgence list:", e);
    }
}

/**
 * @param {string} code
 * @param {string} val
 * @returns {Promise<Response>}
 */
//TODO disabled at the moment
export async function sendSyncMessage(code, val) {
    return fetchLive(`type=sync_set&id=${code}&val=${encodeURIComponent(val)}`, { timeout: 8000 });
}

/**
 * @param {string} code
 * @returns {Promise<Response>}
 */
export async function getSyncMessage(code) {
    //TODO disabled at the moment
    return fetchLive(`type=sync_get&id=${code}`, { timeout: 8000 });
}

/**
 * @param {string} username
 * @param {string} platform
 * @returns {Promise<Response>}
 */
export async function getProfileData(username, platform) {
    //TODO disabled at the moment must delete profile stuff
    return fetchWithTimeout(
        `${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`,
        { cache: "no-cache" },
    );
}

/**
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getPricesBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
}

/**
 * Mapa slug->precio de todo el catálogo prime 
 *
 * @returns {Promise<Response>}
 */
export async function getPricesSnapshot() {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_snapshot`, { timeout: 15000 });
}

/**
 * Fetches price + liquidity stats for a chunk of arcane slugs (Vosfor calculator).
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getArcaneBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=arcane_batch&q=${chunk.join(",")}`, { timeout: 25000 });
}

/**
 * Fetches active bounty data from the worker.
 * @param {boolean} [force] retry after rotate
 * @returns {Promise<Response>}
 */
export async function getActiveBounties(force = false) {
    return fetchRotating("type=active_bounties&v=2", { force });
}

/** @returns {Promise<Response>} */
export async function getActiveFissures(force = false) {
    return fetchRotating("type=fissures&v=2", { force });
}

/**
 * Fetches the current + upcoming Arbitration rotations. 
 * @returns {Promise<Response>}
 */
export async function getArbitration(force = false) {
    return fetchRotating("type=arbitration", { force });
}

/**
 * Rotación de armas de adversario y glast
 * @returns {Promise<Response>}
 */
export async function getLichWeapons(force = false) {
    return fetchRotating("type=lich_weapons&v=2", { force });
}

/**
 * fetches server time to sync client timers
 * @returns {Promise<Response>}
 */
export async function getServerTime() {
    return fetchLive("type=time");
}
