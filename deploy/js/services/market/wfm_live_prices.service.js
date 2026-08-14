import { state } from "../../state.js";
import { getSlug } from "../../utils/slugs.utils.js";

/**
 * Precios en vivo del inventario, sobre el flujo público de órdenes de WFM.
 *
 * NO sustituye a prices_batch: lo REFINA. Medido contra el socket real, el flujo trae
 * ~49 órdenes de venta/min y en 3 minutos solo pasan 132 ítems distintos (3,4% del
 * catálogo), el 91% una única vez. Como fuente principal dejaría casi todo el inventario
 * sin precio; como refinado, actualiza al momento lo que sí pasa y no cuesta ni una
 * petición: la conexión ya está abierta.
 *
 * Un precio de aquí es UN listing concreto, no una mediana. Por eso se marca aparte en
 * la UI en vez de pisar el precio base, que sí es una mediana de las 5 más baratas.
 *
 * No toca el worker: todo es local y se pierde al recargar, que es lo correcto para un
 * dato cuya única virtud es ser de hace segundos.
 */

/** slug -> { plat, at } del último listing visto. */
const live = new Map();

/** itemId -> slug, para traducir lo que llega del socket al vocabulario de la app. */
let idToSlug = new Map();

const listeners = new Set();
let unsubscribe = null;
let starting = null;

/** @param {(info: {slug: string, plat: number}) => void} fn */
export function onLivePrice(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * Desvío a partir del cual el precio guardado se considera desactualizado.
 *
 * 20% no es arbitrario: por debajo de eso el ruido normal del mercado (un vendedor con
 * prisa, una pieza recién desvaultada) dispararía avisos constantes. Por encima, el
 * precio guardado ya no sirve para decidir a cuánto vender.
 */
const STALE_RATIO = 0.2;

/**
 * Diferencia mínima en platino para avisar, además del porcentaje.
 *
 * Sin esto, medido contra datos reales, un ítem de 8p que aparece a 10p salía marcado
 * como "+25%" cuando la diferencia real son 2 platino: irrelevante para decidir nada, y
 * a precios bajos ocurre constantemente. Ambas condiciones deben cumplirse.
 */
const STALE_MIN_PLAT = 5;

/** slug -> { cached, live, diff } de los ítems cuyo precio guardado no cuadra. */
const stale = new Map();

const staleListeners = new Set();

/** @param {(info: {slug: string, cached: number, live: number, diff: number}) => void} fn */
export function onStalePrice(fn) {
    staleListeners.add(fn);
    return () => staleListeners.delete(fn);
}

/** @returns {boolean} true si el mercado en vivo contradice el precio guardado. */
export function isStale(slug) {
    return stale.has(slug);
}

/** @returns {{cached: number, live: number, diff: number}|null} */
export function getStaleInfo(slug) {
    return stale.get(slug) || null;
}

/** @returns {string[]} slugs con precio desactualizado, para el chip de filtro. */
export function staleSlugs() {
    return [...stale.keys()];
}

/**
 * Compara el listing recién visto con el precio que la app tiene guardado.
 *
 * El precio guardado es la mediana de las 5 más baratas; el de aquí es UN listing. Un
 * listing suelto no invalida una mediana por sí solo, pero si se aleja tanto es que la
 * mediana se calculó con un mercado que ya no existe.
 */
function checkStale(slug, livePlat) {
    // MEMORY_CACHE es el precio que sirvió el worker: prices_batch -> savePriceToCache.
    // O sea, esto contrasta el WebSocket contra el dato del worker, no contra otro cálculo
    // del cliente.
    const cached = Number.parseInt(globalThis.MEMORY_CACHE?.get(slug), 10);
    // Sin precio del worker no hay nada que contradecir. El 0 es "sin datos", no un precio.
    if (!Number.isFinite(cached) || cached <= 0) return;

    const diff = (livePlat - cached) / cached;
    if (Math.abs(diff) < STALE_RATIO || Math.abs(livePlat - cached) < STALE_MIN_PLAT) {
        // Volvió a cuadrar, o la diferencia es calderilla: se deja de avisar en vez de
        // mantener una marca vieja.
        stale.delete(slug);
        return;
    }

    const info = { cached, live: livePlat, diff };
    stale.set(slug, info);
    for (const fn of staleListeners) {
        try {
            fn({ slug, ...info });
        } catch { /* un listener roto no debe cortar el flujo */ }
    }
}

/** Slugs del inventario del usuario, para saber qué merece la pena escuchar. */
function inventorySlugs() {
    const out = new Map();
    for (const [name, qty] of Object.entries(state.primeInventory || {})) {
        if (qty > 0) out.set(getSlug(name), name);
    }
    return out;
}

function handleOrder(order) {
    // Solo ventas: una orden de compra dice lo que alguien ofrece pagar, no a cuánto
    // se vende. Mezclarlas daría un "precio" que no corresponde a ningún mercado.
    if (order?.type !== "sell" || !order.itemId || !order.platinum) return;
    // Un vendedor desconectado no es un precio al que puedas comprar ahora.
    if (order.user?.status === "offline") return;

    const slug = idToSlug.get(order.itemId);
    if (!slug) return;

    const prev = live.get(slug);
    // El más barato manda: es el precio al que realmente se compraría ahora mismo.
    if (prev && prev.plat <= order.platinum) return;

    const info = { plat: order.platinum, at: Date.now() };
    live.set(slug, info);
    checkStale(slug, order.platinum);
    for (const fn of listeners) {
        try {
            fn({ slug, ...info });
        } catch { /* un listener roto no debe cortar el flujo */ }
    }
}

/**
 * Arranca la escucha para los ítems del inventario. Idempotente.
 *
 * Resuelve una vez el mapa itemId->slug (una petición, cacheada 7 días en el worker) y
 * a partir de ahí no vuelve a pedir nada: el resto llega solo por el socket.
 *
 * @returns {Promise<boolean>} false si no hay inventario o no se pudo conectar
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

            // El mapa va al revés que resolveIds (slug->id), porque el socket manda id.
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

/** Detiene la escucha y olvida lo acumulado. */
export function stopLivePrices() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    live.clear();
    stale.clear();
    idToSlug = new Map();
}
