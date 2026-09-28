import { WORKER_URL } from "../config.js";
import { esPrime } from "../utils/inventory/catalog_parts.js";
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

// worker ttl does not reach the browser, so the client declares data lifetimes

async function fetchRotating(query, { force = false, timeout = 15000 } = {}) {
    let url = `${WORKER_URL}?${query}`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, { cache: "no-cache", timeout });
}

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

export async function loadRelicsData(cacheKey, cacheTtl) {
    const [version, cachedRecord] = await Promise.all([
        dropsVersion(),
        Promise.resolve().then(() => dbHelper.get(cacheKey)).catch((e) => { console.warn("Cache local ignorada:", e); return null; }),
    ]);
    if (cachedRecord && (version ? cachedRecord.version === version : Date.now() - cachedRecord.timestamp < cacheTtl)) {
        return cachedRecord.data;
    }

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
            const primeWeapons = weaponsData.filter(esPrime);
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

export async function sendSyncMessage(code, val) {
    return fetchLive(`type=sync_set&id=${code}&val=${encodeURIComponent(val)}`, { timeout: 8000 });
}

export async function getSyncMessage(code) {
    return fetchLive(`type=sync_get&id=${code}`, { timeout: 8000 });
}

export async function getProfileData(username, platform) {
    //TODO disabled at the moment must delete profile stuff
    return fetchWithTimeout(
        `${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`,
        { cache: "no-cache" },
    );
}

export async function getPricesBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
}

export async function getPricesSnapshot() {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_snapshot`, { timeout: 15000, cache: "no-cache" });
}

export async function getArcaneBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=arcane_batch&q=${chunk.join(",")}`, { timeout: 25000 });
}

export async function getActiveBounties(force = false) {
    return fetchRotating("type=active_bounties&v=2", { force });
}

export async function getActiveFissures(force = false) {
    return fetchRotating("type=fissures&v=2", { force });
}

export async function getArbitration(force = false) {
    return fetchRotating("type=arbitration", { force });
}

export async function getLichWeapons(force = false) {
    return fetchRotating("type=lich_weapons&v=2", { force });
}

export async function getServerTime() {
    return fetchLive("type=time");
}
