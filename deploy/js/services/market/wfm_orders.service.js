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

const CLAVE_MERCADO = "vs_mercado_v1";
const MERCADO_TTL_MS = 60 * 60 * 1000;

function mercadoLocal() {
    try { return JSON.parse(localStorage.getItem(CLAVE_MERCADO)) || {}; } catch { return {}; }
}

function guardaMercado(data, ahora) {
    try {
        const local = mercadoLocal();
        for (const s in local) if (ahora - local[s].t >= MERCADO_TTL_MS) delete local[s];
        for (const [s, d] of Object.entries(data)) local[s] = { t: ahora, d };
        localStorage.setItem(CLAVE_MERCADO, JSON.stringify(local));
    } catch { /* sin almacenamiento, se pide a la red */ }
}

/**
 * Contexto de mercado de varios ítems a la vez, para la lista de órdenes.
 * @param {string[]} slugs
 * @returns {Promise<Record<string, object>>} vacío si falla (la lista sigue siendo útil)
 */
export async function fetchMarketBatch(slugs, { fresco = false } = {}) {
    const list = [...new Set(slugs.filter(Boolean))].slice(0, 30);
    if (!list.length) return {};
    const ahora = Date.now(), local = fresco ? {} : mercadoLocal();
    const out = {};
    for (const s of list) if (local[s] && ahora - local[s].t < MERCADO_TTL_MS) out[s] = local[s].d;
    const faltan = list.filter((s) => !out[s]);
    if (!faltan.length) return out;
    // La zona de Cloudflare sirve lo cacheado con max-age de 5 h: para revisar precios se salta.
    const url = `${WORKER_URL}?type=wfm_market_batch&slugs=${faltan.join(",")}${fresco ? `&_cb=${ahora}` : ""}`;
    try {
        const res = await fetch(url, fresco ? { cache: "no-cache" } : undefined);
        if (!res.ok) return out;
        const data = (await res.json()) || {};
        guardaMercado(data, ahora);
        return { ...out, ...data };
    } catch {
        return out;
    }
}

// En una petición caben 30 ítems y el worker resuelve 9 sin caché: se repite con lo que falte.
export async function mercadoDeTodos(slugs, { fresco = false, onProgreso = null, rondas = 5, esperaMs = 1200 } = {}) {
    const todos = [...new Set(slugs.filter(Boolean))];
    const out = {};
    let faltan = todos;
    for (let r = 0; r < rondas && faltan.length; r++) {
        if (r) await new Promise((ok) => setTimeout(ok, esperaMs));
        const antes = Object.keys(out).length;
        for (let i = 0; i < faltan.length; i += 30) {
            Object.assign(out, await fetchMarketBatch(faltan.slice(i, i + 30), { fresco }));
            onProgreso?.({ mercados: out, hechos: Object.keys(out).length, total: todos.length });
        }
        if (Object.keys(out).length === antes) break;
        faltan = faltan.filter((s) => !out[s]);
    }
    return out;
}

const CLAVE_CATALOGO = "vs_catalogo_wfm_v1";
const CATALOGO_TTL_MS = 7 * 86400000;

/** id, slug, nombre y rango máximo de un ítem no cambian: se guardan una semana y al worker solo va lo que falte. */
export async function conCatalogoLocal(tipo, claves, pide, ahora = Date.now()) {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CLAVE_CATALOGO)) || {}; } catch { /* sin almacenamiento */ }
    const out = {};
    for (const k of claves) {
        const e = local[`${tipo}:${k}`];
        if (e && ahora - e.t < CATALOGO_TTL_MS) out[k] = e.d;
    }
    const faltan = claves.filter((k) => !out[k]);
    if (!faltan.length) return out;
    const nuevos = (await pide(faltan)) || {};
    try {
        for (const c in local) if (ahora - local[c].t >= CATALOGO_TTL_MS) delete local[c];
        for (const [k, d] of Object.entries(nuevos)) local[`${tipo}:${k}`] = { t: ahora, d };
        localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(local));
    } catch { /* sin almacenamiento, se vuelve a pedir */ }
    return { ...out, ...nuevos };
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

    const info = await conCatalogoLocal("id", ids, async (faltan) => {
        const chunks = [];
        for (let i = 0; i < faltan.length; i += RESOLVE_CHUNK) chunks.push(faltan.slice(i, i + RESOLVE_CHUNK));
        const nuevos = {};
        // En paralelo: son pocas tandas y el worker las sirve de caché casi siempre.
        // Una tanda que falle solo deja sin nombre a sus ítems, no a toda la lista.
        await Promise.all(chunks.map(async (chunk) => {
            try {
                const res = await fetch(`${WORKER_URL}?type=wfm_resolve&ids=${chunk.join(",")}`);
                if (!res.ok) return;
                Object.assign(nuevos, (await res.json()) || {});
            } catch { /* esos ítems se quedan sin nombre */ }
        }));
        return nuevos;
    });

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
 * Aquí y no en el componente: un ui.component no toca localStorage.
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
