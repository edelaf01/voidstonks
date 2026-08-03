import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { getSlug } from "../utils/slugs.utils.js";
import { calculateTotalFullSets } from "../utils/ui_utils.js";
import { getToken, getPlatform } from "./wfm_auth.service.js";
import { fetchMyOrders } from "./wfm_orders.service.js";

const SOURCES = {
    primeSets: {
        label: { es: "Sets prime", en: "Prime sets" },
        owns: (slug) => slug.endsWith("_set"),
        enumerate() {
            const out = [];
            for (const setName of knownSetNames()) {
                const qty = calculateTotalFullSets(setName);
                if (qty > 0) out.push({ name: `${setName} Set`, slug: getSlug(`${setName} Set`), qty });
            }
            return out;
        }
    }
};

function knownSetNames() {
    if (state.setsDatabase && Object.keys(state.setsDatabase).length) {
        return Object.keys(state.setsDatabase);
    }
    const names = new Set();
    for (const name of Object.keys(state.itemsDatabase || {})) {
        if (name.endsWith(" Set")) names.add(name.slice(0, -4));
    }
    return [...names];
}

export function collectSellable() {
    const out = [];
    for (const [key, src] of Object.entries(SOURCES)) {
        try {
            for (const item of src.enumerate()) out.push({ ...item, source: key });
        } catch {}
    }
    return out;
}

export function sourceLabel(key) {
    return SOURCES[key]?.label || null;
}

let listedSlugs = new Set();

export function isListed(slug) {
    return listedSlugs.has(slug);
}

export function hasSyncData() {
    return listedSlugs.size > 0;
}

function isTracked(slug) {
    return Object.values(SOURCES).some(src => {
        try {
            return src.owns?.(slug);
        } catch {
            return false;
        }
    });
}

// slugs to itemId: POST /v2/order takes an id, not a slug
export async function resolveIds(slugs) {
    const list = [...new Set(slugs.filter(Boolean))].slice(0, 100);
    if (!list.length) return {};

    const chunks = [];
    for (let i = 0; i < list.length; i += 25) chunks.push(list.slice(i, i + 25));

    const out = {};
    await Promise.all(chunks.map(async (chunk) => {
        try {
            const res = await fetch(`${WORKER_URL}?type=wfm_ids&slugs=${chunk.join(",")}`);
            if (!res.ok) return;
            Object.assign(out, (await res.json()) || {});
        } catch {}
    }));
    return out;
}

export async function syncInventory(orders = null) {
    let list = orders;
    if (!list) {
        const res = await fetchMyOrders();
        if (!res.ok) return { ok: false, error: res.error };
        list = res.orders || [];
    }

    const sellable = collectSellable();

    const sellOrders = list.filter(
        o => (o.type || "").toLowerCase() === "sell"
    );
    const bySlug = new Map();
    for (const o of sellOrders) {
        const slug = o.itemSlug || o.item?.slug;
        if (slug) bySlug.set(slug, o);
    }

    const unlisted = [];
    const listed = [];
    const seen = new Set();

    for (const item of sellable) {
        const order = bySlug.get(item.slug);
        if (order) {
            seen.add(item.slug);
            listed.push({ ...item, order });
        } else {
            unlisted.push(item);
        }
    }

    listedSlugs = new Set(listed.map(i => i.slug));

    const owned = new Set(sellable.map(i => i.slug));
    const stale = sellOrders
        .filter(o => {
            const slug = o.itemSlug || o.item?.slug;
            return slug && !owned.has(slug) && isTracked(slug);
        })
        .map(o => ({ slug: o.itemSlug || o.item?.slug, name: o.itemName, order: o }));

    return { ok: true, unlisted, listed, stale, seen: [...seen] };
}


export async function createSellOrder(spec) {
    const token = getToken();
    if (!token) return { ok: false, error: "no_token" };
    if (!spec?.itemId) return { ok: false, error: "no_item" };

    const platinum = Number(spec.platinum);
    if (!Number.isInteger(platinum) || platinum < 1) return { ok: false, error: "bad_price" };

    const body = {
        itemId: spec.itemId,
        type: "sell",
        platinum,
        quantity: Number(spec.quantity) || 1,
        platform: getPlatform()
    };
    if (Number.isInteger(spec.rank)) body.rank = spec.rank;

    let res;
    try {
        res = await fetch(`${WORKER_URL}?type=wfm_order_create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-WFM-Token": token
            },
            body: JSON.stringify(body)
        });
    } catch {
        return { ok: false, error: "network" };
    }

    if (res.status === 401 || res.status === 403) return { ok: false, error: "unauthorized" };
    if (!res.ok) return { ok: false, error: "server" };

    if (spec.slug) listedSlugs.add(spec.slug);
    return { ok: true };
}
