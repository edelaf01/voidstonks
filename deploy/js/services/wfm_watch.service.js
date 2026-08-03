import { subscribeNewOrders } from "./wfm_socket.service.js";

/**
 * Vigilancia del mercado en vivo sobre el flujo de órdenes nuevas de WFM
 * (~250/min en PC). Todo el filtrado ocurre aquí, en el cliente: no cuesta
 * ni una petición a la API, que es justo lo que piden sus reglas.
 *
 * Cubre tres casos sobre una única suscripción:
 *   - chollos: ventas muy por debajo de la mediana de un ítem que te interesa
 *   - precios vivos: el mejor precio visto por ítem, sin volver a consultar
 *   - competencia: alguien lista tu mismo ítem por debajo de tu precio
 */

/** Ítems vigilados: itemId -> { median, myPrice, myType, name, myRank } */
const watched = new Map();

/** Mejor precio visto en vivo por ítem: itemId -> { sell, buy, at } */
const livePrices = new Map();

const dealListeners = new Set();
const undercutListeners = new Set();
const priceListeners = new Set();

let unsubscribe = null;

/** Un chollo es una venta a este porcentaje o menos de la mediana. */
const DEAL_RATIO = 0.7;

/**
 * Define qué ítems vigilar. Se llama al cargar la lista de órdenes.
 * @param {Array<{itemId: string, median?: number, myPrice?: number, type?: string, name?: string}>} items
 */
export function setWatchlist(items) {
    watched.clear();
    for (const it of items) {
        if (!it?.itemId) continue;
        watched.set(it.itemId, {
            median: it.median ?? null,
            myPrice: it.myPrice ?? null,
            myType: it.type || "sell",
            name: it.name || "",
            // Solo en mods y arcanos: null en todo lo demás, que no tiene rango.
            myRank: Number.isInteger(it.rank) ? it.rank : null
        });
    }
}

/** @param {(deal: object) => void} fn ventas muy por debajo de la mediana */
export function onDeal(fn) {
    dealListeners.add(fn);
    return () => dealListeners.delete(fn);
}

/** @param {(info: object) => void} fn alguien te ha rebajado el precio */
export function onUndercut(fn) {
    undercutListeners.add(fn);
    return () => undercutListeners.delete(fn);
}

/** @param {(info: object) => void} fn mejor precio en vivo de un ítem vigilado */
export function onPrice(fn) {
    priceListeners.add(fn);
    return () => priceListeners.delete(fn);
}

/** @returns {{sell: number|null, buy: number|null}|null} */
export function getLivePrice(itemId) {
    return livePrices.get(itemId) || null;
}

function handleOrder(order) {
    const { itemId, type, platinum, user } = order;
    if (!itemId || !platinum) return;

    // Un vendedor desconectado no es una oportunidad real ni una amenaza.
    if (user?.status === "offline") return;

    const info = watched.get(itemId);
    if (!info) return;

    // En mods y arcanos cada rango es un mercado aparte: un r0 barato no rebaja tu r10
    // ni es un chollo comparado con su mediana. Si no vigilamos rango, no se filtra.
    if (info.myRank !== null && (order.rank ?? 0) !== info.myRank) return;

    // --- Precios vivos: se actualiza el mejor de cada lado ---
    const prev = livePrices.get(itemId) || { sell: null, buy: null };
    const better = type === "sell"
        ? prev.sell === null || platinum < prev.sell
        : prev.buy === null || platinum > prev.buy;

    if (better) {
        const next = { ...prev, [type]: platinum, at: Date.now() };
        livePrices.set(itemId, next);
        for (const fn of priceListeners) fn({ itemId, name: info.name, ...next });
    }

    // --- Chollos: venta muy por debajo de la mediana ---
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
        for (const fn of dealListeners) fn(deal);
    }

    // --- Competencia: te han rebajado en tu mismo lado del libro ---
    if (info.myPrice && type === info.myType) {
        const undercut = info.myType === "sell"
            ? platinum < info.myPrice
            : platinum > info.myPrice;

        if (undercut) {
            for (const fn of undercutListeners) fn({
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
 * Arranca la vigilancia. Idempotente.
 * @param {{platform?: string, crossplay?: boolean}} [opts] crossplay=false por defecto:
 *   solo interesa la gente con la que se puede comerciar de verdad.
 */
export async function startWatching(opts = {}) {
    if (unsubscribe) return true;
    unsubscribe = await subscribeNewOrders(handleOrder, opts);
    return true;
}

/** Detiene la vigilancia y limpia lo acumulado. */
export function stopWatching() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    livePrices.clear();
}
