import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "./storage.repository.js";

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
        fetch(`${WORKER_URL}?type=relics_opt`),
        fetch(`${WORKER_URL}?type=missions_opt`),
        fetch(`${WORKER_URL}?type=bounties_opt`),
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
        const res = await fetch("assets/json/cleaned_entities.json");
        if (!res.ok) throw new Error("Entities Load Failed");
        const data = await res.json();
        state.primeManifest = data;
        state.entitiesDB = data;
        console.log("Entities Manifest Loaded:", data.length, "items");
        
        // This import is needed because updateDucatsDB logic is in relics.service
        const { updateDucatsDB } = await import("../services/relics.service.js");
        updateDucatsDB(data);
    } catch (e) {
        console.warn("Error loading entities manifest:", e);
    }
}

/**
 * Loads the prime items list for OCR matching into state.ocrReferenceList.
 */
export async function initializeOCRDatabase() {
    try {
        const res = await fetch(`${WORKER_URL}?type=prime_items_list`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        state.ocrReferenceList = data.items;
    } catch (e) {
        console.error("Error detallado al cargar referencia OCR:", e);
        throw e;
    }
}
