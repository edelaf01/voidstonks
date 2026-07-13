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
 * Loads raw relic/mission/bounty data from IDB cache or worker.
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

/**
 * Fetches the prime manifest (entities) and populates state.primeManifest.
 */
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

/**
 * Loads the prime items list for OCR matching into state.ocrReferenceList.
 */
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

/**
 * Fetches the active resurgence list (Aya items) from the worker 'aya' endpoint with a 1-day cache.
 */
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
 * Sends a synchronization message to the Cloudflare Worker.
 * @param {string} code - The 4-digit code.
 * @param {string} val - The message content.
 * @returns {Promise<Response>}
 */
export async function sendSyncMessage(code, val) {
    return fetchWithTimeout(`${WORKER_URL}?type=sync_set&id=${code}&val=${encodeURIComponent(val)}`);
}

/**
 * Retrieves a synchronization message from the Cloudflare Worker.
 * @param {string} code - The 4-digit code.
 * @returns {Promise<Response>}
 */
export async function getSyncMessage(code) {
    return fetchWithTimeout(`${WORKER_URL}?type=sync_get&id=${code}`);
}

/**
 * Fetches user profile data from the worker.
 * @param {string} username
 * @param {string} platform
 * @returns {Promise<Response>}
 */
export async function getProfileData(username, platform) {
    return fetchWithTimeout(`${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`);
}

/**
 * Fetches batch prices for items chunk from the worker.
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getPricesBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
}

/**
 * Fetches price + liquidity stats for a chunk of arcane slugs (Vosfor calculator).
 * Timeout alto: el worker puede tener que pedir órdenes + histórico a WFM por cada slug.
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getArcaneBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=arcane_batch&q=${chunk.join(",")}`, { timeout: 25000 });
}

/**
 * Fetches active bounty data from the worker.
 * @returns {Promise<Response>}
 */
export async function getActiveBounties() {
    return fetchWithTimeout(`${WORKER_URL}?type=active_bounties`);
}

/**
 * Fetches active fissure data from the worker with cache-busting.
 * @returns {Promise<Response>}
 */
export async function getActiveFissures() {
    // Sin cache-buster ni no-store: el worldstate es global y de cambio lento, así navegador/edge
    // pueden cachearlo (clave para el límite de 100k llamadas/día con muchos usuarios). Timeout 15s
    // porque el worker puede tardar en frío; la frecuencia real la limita la cache en memoria del servicio.
    return fetchWithTimeout(`${WORKER_URL}?type=fissures`, { timeout: 15000 });
}

/**
 * Fetches the current + upcoming Arbitration rotations. Mismo flujo que las fisuras:
 * worker principal -> wf-parser (que lee el calendario determinista de browse.wf).
 * @returns {Promise<Response>}
 */
export async function getArbitration() {
    return fetchWithTimeout(`${WORKER_URL}?type=arbitration`, { timeout: 15000 });
}
