import { getPricesBatch } from "./api.repository.js";
import { getSlug } from "../utils/slugs.utils.js";


const DB_NAME = "VoidStonksDB_V1";
const STORE_NAME = "bigData";

export const dbHelper = {
    dbInstance: null,
    async open() {
        if (this.dbInstance) return this.dbInstance;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) =>
                !e.target.result.objectStoreNames.contains(STORE_NAME) &&
                e.target.result.createObjectStore(STORE_NAME);
            req.onsuccess = (e) => {
                this.dbInstance = e.target.result;
                this.dbInstance.onversionchange = () => {
                    this.dbInstance.close();
                    this.dbInstance = null;
                };
                resolve(this.dbInstance);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async get(key) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, "readonly");
                const req = tx.objectStore(STORE_NAME).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    },
    async set(key, value) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).put(value, key);
                tx.oncomplete = () => resolve();
            });
        } catch { }
    },
    async delete(key) {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).delete(key);
                tx.oncomplete = () => resolve();
            });
        } catch { }
    },
    /** Loads all price_* keys from IDB into MEMORY_CACHE on startup. */
    async preloadPrices() {
        try {
            const db = await this.open();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, "readonly");
                const req = tx.objectStore(STORE_NAME).openCursor();
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (typeof cursor.key === "string" && cursor.key.startsWith("price_")) {
                            const cached = cursor.value;
                            if (cached && (Date.now() - cached.time < CACHE_TTL)) {
                                const slug = cursor.key.replace("price_", "");
                                MEMORY_CACHE.set(slug, cached.val);
                            }
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => resolve();
            });
        } catch { return; }
    },
};


const CACHE_TTL = 6 * 60 * 60 * 1000;

/** In-memory price cache. */
export const MEMORY_CACHE = new Map();
globalThis.MEMORY_CACHE = MEMORY_CACHE;

async function savePriceToCache(slug, price) {
    MEMORY_CACHE.set(slug, price);
    try {
        await dbHelper.set(`price_${slug}`, { val: price, time: Date.now() });
    } catch (e) {
        console.warn("Error saving to IndexedDB cache:", e);
    }
}


const PENDING_REQUESTS = new Map();
const RETRY_COUNTS = new Map();
const IN_FLIGHT_PROMISES = new Map();
const MAX_RETRIES = 3;
let batchTimer = null;
let currentBackoff = 50;
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    batchTimer = null;

    // Orden alfabético: la URL del batch queda canónica y clientes distintos que piden
    // los mismos slugs generan la misma cache key en el edge del worker.
    const slugsToFetch = Array.from(PENDING_REQUESTS.keys()).sort();
    if (slugsToFetch.length === 0) { isProcessingQueue = false; return; }

    const currentBatch = new Map(PENDING_REQUESTS);
    PENDING_REQUESTS.clear();

    for (let i = 0; i < slugsToFetch.length; i += 25) {
        const chunk = slugsToFetch.slice(i, i + 25);
        if (chunk.length === 0) continue;
        try {
            const res = await getPricesBatch(chunk);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const data = await res.json();

            chunk.forEach((slug) => {
                const price = data[slug];
                if (price === undefined) {
                    const retries = (RETRY_COUNTS.get(slug) || 0) + 1;
                    if (retries >= MAX_RETRIES) {
                        currentBatch.get(slug)?.forEach((r) => r(0));
                        currentBatch.delete(slug);
                        RETRY_COUNTS.delete(slug);
                    } else {
                        RETRY_COUNTS.set(slug, retries);
                        if (!PENDING_REQUESTS.has(slug)) {
                            PENDING_REQUESTS.set(slug, currentBatch.get(slug) || []);
                            currentBatch.delete(slug);
                        }
                    }
                } else {
                    if (price > 0) savePriceToCache(slug, price);
                    RETRY_COUNTS.delete(slug);
                    currentBatch.get(slug)?.forEach((r) => r(price));
                    currentBatch.delete(slug);
                }
            });

            currentBackoff = 50;
            if (i + 25 < slugsToFetch.length) await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
            console.error("Batch chunk fetch failed:", err);
            currentBackoff = Math.min(currentBackoff * 2, 5000);
            chunk.forEach((slug) => {
                const retries = (RETRY_COUNTS.get(slug) || 0) + 1;
                if (retries >= MAX_RETRIES) {
                    currentBatch.get(slug)?.forEach((r) => r(0));
                    currentBatch.delete(slug);
                    RETRY_COUNTS.delete(slug);
                } else {
                    RETRY_COUNTS.set(slug, retries);
                    if (!PENDING_REQUESTS.has(slug)) {
                        PENDING_REQUESTS.set(slug, currentBatch.get(slug) || []);
                        currentBatch.delete(slug);
                    }
                }
            });
            break;
        }
    }

    isProcessingQueue = false;
    if (PENDING_REQUESTS.size > 0 && !batchTimer) {
        batchTimer = setTimeout(processQueue, currentBackoff + Math.random() * 1000);
    }
}

/**
 * Returns a Promise that resolves to the platinum price of an item.
 * Uses MEMORY_CACHE -> IDB ->batch fetch, with deduplication.
 * @param {string} itemName
 * @param {string} itemSlug
 * @returns {Promise<number>}
 */
export function getPriceValue(itemName, itemSlug) {
    if (
        !itemName || !itemSlug ||
        itemName.includes("Forma") || itemName.includes("Kuva") ||
        itemName === "Riven Sliver" || itemName === "Exilus Weapon Adapter Blueprint"
    ) return Promise.resolve(0);

    if (MEMORY_CACHE.has(itemSlug)) return Promise.resolve(MEMORY_CACHE.get(itemSlug));
    if (IN_FLIGHT_PROMISES.has(itemSlug)) return IN_FLIGHT_PROMISES.get(itemSlug);

    const fetchPromise = new Promise(async (resolve) => {
        try {
            const cached = await dbHelper.get(`price_${itemSlug}`);
            if (cached && (Date.now() - cached.time < CACHE_TTL)) {
                MEMORY_CACHE.set(itemSlug, cached.val);
                resolve(cached.val);
                return;
            }
        } catch (e) {
            console.warn(`Error reading price cache for ${itemSlug}:`, e);
        }
        if (!PENDING_REQUESTS.has(itemSlug)) PENDING_REQUESTS.set(itemSlug, []);
        PENDING_REQUESTS.get(itemSlug).push(resolve);
        if (!batchTimer) batchTimer = setTimeout(processQueue, currentBackoff);
    }).finally(() => IN_FLIGHT_PROMISES.delete(itemSlug));

    IN_FLIGHT_PROMISES.set(itemSlug, fetchPromise);
    return fetchPromise;
}

/**
 * Queues an item for price fetch and calls updatePriceUI when resolved.
 * @param {string} itemName
 * @param {HTMLElement} element
 */
export function addToQueue(itemName, element) {
    const slug = getSlug(itemName);
    getPriceValue(itemName, slug).then((price) => {
        if (globalThis.updatePriceUI) globalThis.updatePriceUI(element, price);
    });
}

/** Warms up-preloads MEMORY_CACHE from IndexedDB on startup. */
export async function preloadPricesToMemory() {
    await dbHelper.preloadPrices();
}
