import { WORKER_URL } from "../../config.js";
import { getToken, getUserSlug, cacheScope } from "./wfm_auth.service.js";

/**
 * Órdenes y precios de Warframe Market.
 *
 * Separado de wfm_auth.service.js a propósito: ese módulo solo gestiona la sesión
 * (token, caducidad, scope) y no debe conocer el formato de las órdenes. Aquí vive
 * todo lo que habla con el mercado, y lo único que pide prestado es el token.
 *
 * Todo pasa por el worker: api.warframe.market no envía cabeceras CORS.
 */

/**
 * Lee las órdenes del usuario autenticado a través del worker.
 * @param {string} [token] token explícito; por defecto, el de la sesión guardada.
 * @returns {Promise<{ok: boolean, orders?: Array, error?: string}>}
 */
export async function fetchMyOrders(token = getToken()) {
    const slug = getUserSlug();
    if (!token && !slug) return { ok: false, error: "no_token" };

    // El slug viaja siempre: si el JWT no autoriza v2, el worker cae a las órdenes
    // públicas del perfil sin que el usuario note nada.
    const url = `${WORKER_URL}?type=wfm_my_orders${slug ? `&user=${encodeURIComponent(slug)}` : ""}`;

    let res;
    try {
        res = await fetch(url, {
            headers: token ? { "X-WFM-Token": token } : {}
        });
    } catch {
        return { ok: false, error: "network" };
    }

    if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "unauthorized" };
    }
    if (!res.ok) return { ok: false, error: "server" };

    let body;
    try {
        body = await res.json();
    } catch {
        return { ok: false, error: "server" };
    }
    if (body?.error) return { ok: false, error: "unauthorized" };

    // WFM v2 responde { apiVersion, data, error }; data puede ser array o {sell,buy}.
    const data = body?.data;
    const orders = Array.isArray(data)
        ? data
        : [...(data?.sell || []), ...(data?.buy || [])];

    // El worker indica en X-WFM-Scope si sirvió la vía autenticada o la pública.
    // Reevaluamos en cada carga: una sesión marcada "public" al entrar puede pasar a
    // "full" (p. ej. tras desplegar un worker corregido) sin obligar a reloguear.
    cacheScope(res.headers.get("X-WFM-Scope"));

    await attachItemInfo(orders);
    return { ok: true, orders };
}

/**
 * Modifica una orden del usuario. Requiere sesión autorizada (scope "full").
 * @param {string} orderId
 * @param {"update"|"close"|"delete"} action
 * @param {object} [payload] update: {platinum?, quantity?, visible?} | close: {quantity}
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function editOrder(orderId, action, payload = {}) {
    const token = getToken();
    if (!token) return { ok: false, error: "no_token" };

    let res;
    try {
        res = await fetch(
            `${WORKER_URL}?type=wfm_order_edit&id=${encodeURIComponent(orderId)}&action=${action}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-WFM-Token": token
                },
                body: JSON.stringify(payload)
            }
        );
    } catch {
        return { ok: false, error: "network" };
    }

    if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
    if (!res.ok) return { ok: false, error: "server" };
    return { ok: true };
}

/**
 * Contexto de mercado de un ítem: mediana del último día cerrado y listings online.
 * Sirve para decidir el precio al editar una orden.
 * @param {string} slug
 * @param {number|null} [rank] acota a esa variante en mods y arcanos, donde el precio
 *   de un r0 y el de un rango máximo no son comparables
 * @returns {Promise<{ok: boolean, market?: object, error?: string}>}
 */
export async function fetchItemMarket(slug, rank = null) {
    if (!slug) return { ok: false, error: "no_slug" };
    const rankQ = Number.isInteger(rank) ? `&rank=${rank}` : "";
    try {
        const res = await fetch(`${WORKER_URL}?type=wfm_item_market&slug=${encodeURIComponent(slug)}${rankQ}`);
        if (!res.ok) return { ok: false, error: "server" };
        return { ok: true, market: await res.json() };
    } catch {
        return { ok: false, error: "network" };
    }
}

/**
 * Contexto de mercado de varios ítems a la vez, para la lista de órdenes.
 * @param {string[]} slugs
 * @returns {Promise<Record<string, object>>} vacío si falla (la lista sigue siendo útil)
 */
export async function fetchMarketBatch(slugs) {
    const list = [...new Set(slugs.filter(Boolean))].slice(0, 30);
    if (!list.length) return {};
    try {
        const res = await fetch(`${WORKER_URL}?type=wfm_market_batch&slugs=${list.join(",")}`);
        if (!res.ok) return {};
        return (await res.json()) || {};
    } catch {
        return {};
    }
}

/** Base de las miniaturas de warframe.market. */
const THUMB_BASE = "https://warframe.market/static/assets/";

/**
 * Cuántos ids caben en una petición de resolución.
 *
 * 76 ids daban una URL de ~1950 caracteres y, sobre todo, obligaban al worker a hacer
 * una escritura de caché por ítem: pasaba del tope de subrequests de Cloudflare y la
 * petición entera moría con 500. En tandas, cada una entra de sobra en el presupuesto
 * y las siguientes cargas encuentran casi todo ya cacheado.
 */
const RESOLVE_CHUNK = 25;

/**
 * Las órdenes del endpoint público solo traen itemId: sin esto la lista sale sin
 * nombre ni icono. Resuelve los ids y adjunta la info.
 * Si falla, las órdenes se muestran igual (solo que sin nombre).
 * @param {Array} orders
 */
async function attachItemInfo(orders) {
    const ids = [...new Set(orders.map(o => o.itemId).filter(Boolean))];
    if (!ids.length) return;

    const chunks = [];
    for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
        chunks.push(ids.slice(i, i + RESOLVE_CHUNK));
    }

    const info = {};
    // En paralelo: son pocas tandas y el worker las sirve de caché casi siempre.
    // Una tanda que falle solo deja sin nombre a sus ítems, no a toda la lista.
    await Promise.all(chunks.map(async (chunk) => {
        try {
            const res = await fetch(`${WORKER_URL}?type=wfm_resolve&ids=${chunk.join(",")}`);
            if (!res.ok) return;
            Object.assign(info, (await res.json()) || {});
        } catch { /* esos ítems se quedan sin nombre */ }
    }));

    for (const o of orders) {
        const meta = info[o.itemId];
        if (!meta) continue;
        o.itemName = meta.name || meta.slug;
        o.itemSlug = meta.slug;
        o.itemThumb = meta.thumb ? THUMB_BASE + meta.thumb : null;
        o.itemThumbPath = meta.thumb || null;
        // Solo los rangueables (mods, arcanos) lo traen; el resto queda sin selector.
        if (meta.maxRank) o.itemMaxRank = meta.maxRank;
    }
}

// ---- Preferencia de filtro del listado ----

const FILTERS_KEY = "vs_orders_filters_v1";

/**
 * Chip de filtro elegido en "Mis órdenes". Persiste porque es una decisión, igual que los
 * chips del inventario; la BÚSQUEDA no se guarda, que recuperar un texto a medias deja la
 * lista casi vacía sin que se vea el motivo.
 *
 * Aquí y no en el componente: un ui.component no toca localStorage (ARCHITECTURE.md §A).
 * @param {string[]} valid claves de filtro que existen hoy; cualquier otra cae a "all".
 */
export function getOrdersFilterType(valid) {
    try {
        const saved = localStorage.getItem(FILTERS_KEY);
        return valid.includes(saved) ? saved : "all";
    } catch {
        return "all";
    }
}

export function saveOrdersFilterType(type) {
    try {
        localStorage.setItem(FILTERS_KEY, type);
    } catch (e) {
        console.warn("[orders] no se pudo guardar el filtro:", e);
    }
}
