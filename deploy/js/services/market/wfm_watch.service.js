import { subscribeNewOrders } from "./wfm_socket.service.js";

/**
 * live market watch on the WFM new orders WebSocket stream
 */

/** itemId -> { median, myPrice, myType, name, myRank } */
const watched = new Map();

/** best live price per item: itemId -> { sell, buy, at } */
const livePrices = new Map();

const dealListeners = new Set();
const undercutListeners = new Set();
const priceListeners = new Set();

let unsubscribe = null;

/** a deal is a sell at this share of the median or less */
const DEAL_RATIO = 0.7;

/** @param {Array<{itemId: string, median?: number, myPrice?: number, type?: string, name?: string}>} items */
export function setWatchlist(items) {
    watched.clear();
    for (const it of items) {
        if (!it?.itemId) continue;
        watched.set(it.itemId, {
            median: it.median ?? null,
            myPrice: it.myPrice ?? null,
            myType: it.type || "sell",
            name: it.name || "",
            myRank: Number.isInteger(it.rank) ? it.rank : null
        });
    }
}

/** @param {(deal: object) => void} fn */
export function onDeal(fn) {
    dealListeners.add(fn);
    return () => dealListeners.delete(fn);
}

/** @param {(info: object) => void} fn */
export function onUndercut(fn) {
    undercutListeners.add(fn);
    return () => undercutListeners.delete(fn);
}

/** @param {(info: object) => void} fn */
export function onPrice(fn) {
    priceListeners.add(fn);
    return () => priceListeners.delete(fn);
}

/**
 * Reparte un evento entre sus suscriptores.
 * @param {Set<Function>} listeners
 */
function emitir(listeners, evento) {
    for (const fn of listeners) {
        try {
            fn(evento);
        } catch {}
    }
}

function handleOrder(order) {
    const { itemId, type, platinum, user } = order;
    if (!itemId || !platinum) return;

    if (user?.status === "offline") return;

    const info = watched.get(itemId);
    if (!info) return;

    if (info.myRank !== null && (order.rank ?? 0) !== info.myRank) return;

    // live prices: best per side
    const prev = livePrices.get(itemId) || { sell: null, buy: null };
    const better = type === "sell"
        ? prev.sell === null || platinum < prev.sell
        : prev.buy === null || platinum > prev.buy;

    if (better) {
        const next = { ...prev, [type]: platinum, at: Date.now() };
        livePrices.set(itemId, next);
        emitir(priceListeners, { itemId, name: info.name, ...next });
    }

    // deals: sells well under the median
    if (type === "sell" && info.median && platinum <= info.median * DEAL_RATIO) {
        const deal = {
            itemId,
            name: info.name,
            platinum,
            median: info.median,
            discount: Math.round((1 - platinum / info.median) * 100),
            user: user?.ingameName || "?",
            quantity: order.quantity ?? 1
        };
        emitir(dealListeners, deal);
    }

    // undercuts: someone beat your price on your side of the book
    if (info.myPrice && type === info.myType) {
        const undercut = info.myType === "sell"
            ? platinum < info.myPrice
            : platinum > info.myPrice;

        if (undercut) {
            emitir(undercutListeners, {
                itemId,
                name: info.name,
                theirs: platinum,
                mine: info.myPrice,
                type: info.myType,
                user: user?.ingameName || "?"
            });
        }
    }
}

/**
 * Arranca la vigilancia. 
 * @param {{platform?: string, crossplay?: boolean}} [opts] crossplay=false por defecto:
 */
export async function startWatching(opts = {}) {
    if (unsubscribe) return true;
    unsubscribe = await subscribeNewOrders(handleOrder, opts);
    return true;
}

export function stopWatching() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    livePrices.clear();
}
