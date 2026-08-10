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
 * @param {string} cacheKey
 * @param {number} cacheTtl
 * @returns {Promise<object>}
 */
export async function loadRelicsData(cacheKey, cacheTtl) {
    try {
        const cachedRecord = await dbHelper.get(cacheKey);
        if (cachedRecord && Date.now() - cachedRecord.timestamp < cacheTtl) {
            return cachedRecord.data;
        }
    } catch (e) {
        console.warn("Cache local ignorada:", e);
    }

    const [relicsRes, missionsRes, bountiesRes] = await Promise.all([
        fetchWithTimeout(`${WORKER_URL}?type=relics_opt`),
        fetchWithTimeout(`${WORKER_URL}?type=missions_opt`),
        fetchWithTimeout(`${WORKER_URL}?type=bounties_opt`),
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

    await dbHelper.set(cacheKey, { timestamp: Date.now(), data: rawData });
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
        
        const { updateDucatsDB } = await import("../services/relics.service.js");
        updateDucatsDB(data);

        if (resWeapons && resWeapons.ok) {
            const weaponsData = await resWeapons.json();
            const primeWeapons = weaponsData.filter(item => item.isPrime);
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
    return fetchWithTimeout(`${WORKER_URL}?type=sync_set&id=${code}&val=${encodeURIComponent(val)}`);
}

/**
 * @param {string} code
 * @returns {Promise<Response>}
 */
export async function getSyncMessage(code) {
    return fetchWithTimeout(`${WORKER_URL}?type=sync_get&id=${code}`);
}

/**
 * @param {string} username
 * @param {string} platform
 * @returns {Promise<Response>}
 */
export async function getProfileData(username, platform) {
    return fetchWithTimeout(`${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`);
}

/**
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getPricesBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
}

/**
 * Fetches price + liquidity stats for a chunk of arcane slugs (Vosfor calculator).
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getArcaneBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=arcane_batch&q=${chunk.join(",")}`, { timeout: 25000 });
}

/** @returns {Promise<Response>} */
export async function getActiveBounties() {
    return fetchWithTimeout(`${WORKER_URL}?type=active_bounties&v=2`);
}

/** @returns {Promise<Response>} */
export async function getActiveFissures(force = false) {
    const opts = { timeout: 15000 };
    let url = `${WORKER_URL}?type=fissures&v=2`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, opts);
}

/**
 * Fetches the current + upcoming Arbitration rotations. 
 * @returns {Promise<Response>}
 */
export async function getArbitration(force = false) {
    const opts = { timeout: 15000 };
    let url = `${WORKER_URL}?type=arbitration`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, opts);
}

/**
 * Rotación de armas de adversario y glast
 * @returns {Promise<Response>}
 */
export async function getLichWeapons(force = false) {
    let url = `${WORKER_URL}?type=lich_weapons&v=2`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, { timeout: 15000 });
}

/** @returns {Promise<Response>} */
export async function getServerTime() {
    return fetchWithTimeout(`${WORKER_URL}?type=time`, { cache: "no-store", timeout: 10000 });
}
