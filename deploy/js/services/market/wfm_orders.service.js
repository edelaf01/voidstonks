import { WORKER_URL } from "../../config.js";
import { getToken, getUserSlug, cacheScope } from "./wfm_auth.service.js";

/**
 * Órdenes y precios de Warframe Market.
 */

/**
 * @param {string} [token]
 * @returns {Promise<{ok: boolean, orders?: Array, error?: string}>}
 */
export async function fetchMyOrders(token = getToken()) {
    const slug = getUserSlug();
    if (!token && !slug) return { ok: false, error: "no_token" };

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

    // WFM v2: { apiVersion, data, error }; data is an array or { sell, buy }
    const data = body?.data;
    const orders = Array.isArray(data)
        ? data
        : [...(data?.sell || []), ...(data?.buy || [])];

    cacheScope(res.headers.get("X-WFM-Scope"));

    await attachItemInfo(orders);
    return { ok: true, orders };
}

/**
 * Needs a full scope session.
 * @param {string} orderId
 * @param {"update"|"close"|"delete"} action
 * @param {object} [payload]
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
 * Item market context: median of the last closed day and online listings.
 * @param {string} slug
 * @param {number|null} [rank]
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
    } catch {}
}

/**
 * @param {string[]} slugs
 * @returns {Promise<Record<string, object>>}
 */
export async function fetchMarketBatch(slugs, { fresco = false } = {}) {
    const list = [...new Set(slugs.filter(Boolean))].slice(0, 30);
    if (!list.length) return {};
    const ahora = Date.now(), local = fresco ? {} : mercadoLocal();
    const out = {};
    for (const s of list) if (local[s] && ahora - local[s].t < MERCADO_TTL_MS) out[s] = local[s].d;
    const faltan = list.filter((s) => !out[s]);
    if (!faltan.length) return out;
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

export async function mercadoDeTodos(slugs, { fresco = false, onProgreso = null, rondas = 5, esperaMs = 1200 } = {}) {
    const todos = [...new Set(slugs.filter(Boolean))];
    const out = {};
    let faltan = todos;
    for (let r = 0; r < rondas && faltan.length; r++) {
        if (r) await new Promise((ok) => setTimeout(ok, esperaMs));
        for (let i = 0; i < faltan.length; i += 30) {
            Object.assign(out, await fetchMarketBatch(faltan.slice(i, i + 30), { fresco }));
            onProgreso?.({ mercados: out, hechos: Object.keys(out).length, total: todos.length });
        }
        faltan = faltan.filter((s) => !out[s]);
    }
    return out;
}

const CLAVE_CATALOGO = "vs_catalogo_wfm_v1";
const CATALOGO_TTL_MS = 7 * 86400000;

/**
 * Item id, slug, name and max rank never change: cached a week, only the missing ones
 * go to the worker.
 */
export async function conCatalogoLocal(tipo, claves, pide, ahora = Date.now()) {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CLAVE_CATALOGO)) || {}; } catch {}
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
    } catch {}
    return { ...out, ...nuevos };
}

// TODO urgent: load the thumbnails and bundle them myself
const THUMB_BASE = "https://warframe.market/static/assets/";

/**
 * Ids per resolve request: bigger batches went over the Cloudflare subrequest limit and
 * failed with 500.
 */
const RESOLVE_CHUNK = 25;

/**
 * Public orders only carry itemId: resolves the ids and attaches name and icon.
 * @param {Array} orders
 */
async function attachItemInfo(orders) {
    const ids = [...new Set(orders.map(o => o.itemId).filter(Boolean))];
    if (!ids.length) return;

    const info = await conCatalogoLocal("id", ids, async (faltan) => {
        const chunks = [];
        for (let i = 0; i < faltan.length; i += RESOLVE_CHUNK) chunks.push(faltan.slice(i, i + RESOLVE_CHUNK));
        const nuevos = {};
        await Promise.all(chunks.map(async (chunk) => {
            try {
                const res = await fetch(`${WORKER_URL}?type=wfm_resolve&ids=${chunk.join(",")}`);
                if (!res.ok) return;
                Object.assign(nuevos, (await res.json()) || {});
            } catch {}
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
        // only rankable items (mods, arcanes) have it
        if (meta.maxRank) o.itemMaxRank = meta.maxRank;
    }
}

const FILTERS_KEY = "vs_orders_filters_v1";

/**
 * selected filter chip in "my orders"
 * @param {string[]} valid filter keys that exist today; any other falls back to "all"
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
