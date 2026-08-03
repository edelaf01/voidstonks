import { state } from "../state.js";
import { getSlug } from "../utils/slugs.utils.js";

/**
 * live inventory prices from the public WFM order stream
 */

//arbitrage not in use
/** slug -> { plat, at } of the last listing seen */
const live = new Map();

/** itemId -> slug */
let idToSlug = new Map();

const listeners = new Set();
let unsubscribe = null;
let starting = null;

/** @param {(info: {slug: string, plat: number}) => void} fn */
export function onLivePrice(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** @returns {{plat: number, at: number}|null} */
export function getLivePrice(slug) {
    return live.get(slug) || null;
}

/**
 * deviation threshold at which stored price is considered stale
 */
const STALE_RATIO = 0.2;

/**
 * minimum platinum difference to warn, in addition to ratio
 */
const STALE_MIN_PLAT = 5;

/** slug -> { cached, live, diff } of items whose stored price is off */
const stale = new Map();

const staleListeners = new Set();

/** @param {(info: {slug: string, cached: number, live: number, diff: number}) => void} fn */
export function onStalePrice(fn) {
    staleListeners.add(fn);
    return () => staleListeners.delete(fn);
}

/** @returns {boolean} */
export function isStale(slug) {
    return stale.has(slug);
}

/** @returns {{cached: number, live: number, diff: number}|null} */
export function getStaleInfo(slug) {
    return stale.get(slug) || null;
}

/** @returns {string[]} */
export function staleSlugs() {
    return [...stale.keys()];
}

/**
 * compares recently seen listing with stored price
 */
function checkStale(slug, livePlat) {
    const cached = Number.parseInt(globalThis.MEMORY_CACHE?.get(slug), 10);
    if (!Number.isFinite(cached) || cached <= 0) return;

    const diff = (livePlat - cached) / cached;
    if (Math.abs(diff) < STALE_RATIO || Math.abs(livePlat - cached) < STALE_MIN_PLAT) {
        stale.delete(slug);
        return;
    }

    const info = { cached, live: livePlat, diff };
    stale.set(slug, info);
    for (const fn of staleListeners) {
        try {
            fn({ slug, ...info });
        } catch {}
    }
}

function inventorySlugs() {
    const out = new Map();
    for (const [name, qty] of Object.entries(state.primeInventory || {})) {
        if (qty > 0) out.set(getSlug(name), name);
    }
    return out;
}

function handleOrder(order) {
    if (order?.type !== "sell" || !order.itemId || !order.platinum) return;
    if (order.user?.status === "offline") return;

    const slug = idToSlug.get(order.itemId);
    if (!slug) return;

    const prev = live.get(slug);
    if (prev && prev.plat <= order.platinum) return;

    const info = { plat: order.platinum, at: Date.now() };
    live.set(slug, info);
    checkStale(slug, order.platinum);
    for (const fn of listeners) {
        try {
            fn({ slug, ...info });
        } catch {}
    }
}

/**
 * starts listening for inventory items, idempotent
 * @returns {Promise<boolean>} false if no inventory or failed to connect
 */
export async function startLivePrices() {
    if (unsubscribe) return true;
    if (starting) return starting;

    starting = (async () => {
        const slugs = inventorySlugs();
        if (!slugs.size) return false;

        try {
            const { resolveIds } = await import("./wfm_link.service.js");
            const meta = await resolveIds([...slugs.keys()]);

            idToSlug = new Map();
            for (const [slug, info] of Object.entries(meta)) {
                if (info?.id) idToSlug.set(info.id, slug);
            }
            if (!idToSlug.size) return false;

            const { subscribeNewOrders } = await import("./wfm_socket.service.js");
            unsubscribe = await subscribeNewOrders(handleOrder, { crossplay: false });
            return true;
        } catch {
            return false;
        } finally {
            starting = null;
        }
    })();

    return starting;
}

export function stopLivePrices() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    live.clear();
    stale.clear();
    idToSlug = new Map();
}
