import { WORKER_URL } from "../config.js";
import { getToken, getUserSlug, cacheScope } from "./wfm_auth.service.js";

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

    const data = body?.data;
    const orders = Array.isArray(data)
        ? data
        : [...(data?.sell || []), ...(data?.buy || [])];

    cacheScope(res.headers.get("X-WFM-Scope"));

    await attachItemInfo(orders);
    return { ok: true, orders };
}

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

// TODO urgent: load the thumbnails and bundle them myself
const THUMB_BASE = "https://warframe.market/static/assets/";

// bigger batches went over the Cloudflare subrequest limit and failed with 500
const RESOLVE_CHUNK = 25;

async function attachItemInfo(orders) {
    const ids = [...new Set(orders.map(o => o.itemId).filter(Boolean))];
    if (!ids.length) return;

    const chunks = [];
    for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
        chunks.push(ids.slice(i, i + RESOLVE_CHUNK));
    }

    const info = {};
    await Promise.all(chunks.map(async (chunk) => {
        try {
            const res = await fetch(`${WORKER_URL}?type=wfm_resolve&ids=${chunk.join(",")}`);
            if (!res.ok) return;
            Object.assign(info, (await res.json()) || {});
        } catch {}
    }));

    for (const o of orders) {
        const meta = info[o.itemId];
        if (!meta) continue;
        o.itemName = meta.name || meta.slug;
        o.itemSlug = meta.slug;
        o.itemThumb = meta.thumb ? THUMB_BASE + meta.thumb : null;
        o.itemThumbPath = meta.thumb || null;
        if (meta.maxRank) o.itemMaxRank = meta.maxRank;
    }
}
