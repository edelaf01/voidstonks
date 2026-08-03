import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { getSlug } from "../utils/slugs.utils.js";
import { calculateTotalFullSets } from "../utils/ui_utils.js";
import { getToken, getPlatform } from "./wfm_auth.service.js";
import { fetchMyOrders } from "./wfm_orders.service.js";

/**
 * Puente entre el inventario local y warframe.market.
 *
 * Bidireccional: dice qué tienes sin publicar (para venderlo) y qué tienes publicado
 * que ya no tienes (para retirarlo). Las dos preguntas se resuelven cruzando las mismas
 * dos listas, así que viven juntas.
 *
 * SOURCES es el punto de extensión: hoy solo mira sets prime completos, pero añadir
 * mods o arcanos es añadir una entrada más, sin tocar el cruce ni la UI. Cada fuente
 * solo tiene que saber enumerar lo vendible del inventario y darle un slug de WFM.
 */

/**
 * Fuentes de ítems vendibles del inventario local.
 * @type {Record<string, {label: {es: string, en: string}, enumerate: () => Array<{name: string, slug: string, qty: number}>}>}
 */
const SOURCES = {
    primeSets: {
        label: { es: "Sets prime", en: "Prime sets" },
        // Distingue "ya no lo tienes" de "esto no lo sigo". Sin esto, una orden de un
        // tipo aún no soportado (un mod hoy) saldría como obsoleta y el usuario acabaría
        // retirando órdenes buenas. Cada fuente declara qué reconoce como suyo.
        owns: (slug) => slug.endsWith("_set"),
        enumerate() {
            const out = [];
            // Los sets no están en primeInventory como tal: se derivan de las piezas.
            // calculateTotalFullSets ya cuenta piezas sueltas Y sets guardados enteros.
            for (const setName of knownSetNames()) {
                const qty = calculateTotalFullSets(setName);
                if (qty > 0) out.push({ name: `${setName} Set`, slug: getSlug(`${setName} Set`), qty });
            }
            return out;
        }
    }
};

/** Nombres de set conocidos, según la base de datos que haya cargada. */
function knownSetNames() {
    if (state.setsDatabase && Object.keys(state.setsDatabase).length) {
        return Object.keys(state.setsDatabase);
    }
    // Sin setsDatabase se deducen de los ítems que acaban en " Set".
    const names = new Set();
    for (const name of Object.keys(state.itemsDatabase || {})) {
        if (name.endsWith(" Set")) names.add(name.slice(0, -4));
    }
    return [...names];
}

/** Todo lo vendible del inventario, de todas las fuentes. */
export function collectSellable() {
    const out = [];
    for (const [key, src] of Object.entries(SOURCES)) {
        try {
            for (const item of src.enumerate()) out.push({ ...item, source: key });
        } catch { /* una fuente rota no debe dejar sin datos a las demás */ }
    }
    return out;
}

/** @returns {{es: string, en: string}|null} etiqueta de una fuente. */
export function sourceLabel(key) {
    return SOURCES[key]?.label || null;
}

/**
 * Slugs que el usuario tiene publicados en venta, según el último cruce.
 * Vacío mientras no se haya abierto la pestaña de órdenes: se prefiere no pintar
 * nada a pedir las órdenes desde el inventario, que es una vista de datos locales.
 */
let listedSlugs = new Set();

/** @returns {boolean} true si ese ítem ya está en venta en warframe.market. */
export function isListed(slug) {
    return listedSlugs.has(slug);
}

/** @returns {boolean} true si ya hay un cruce hecho (si no, no hay nada que pintar). */
export function hasSyncData() {
    return listedSlugs.size > 0;
}

/** ¿Reconoce alguna fuente este slug como algo que el inventario sigue? */
function isTracked(slug) {
    return Object.values(SOURCES).some(src => {
        try {
            return src.owns?.(slug);
        } catch {
            return false;
        }
    });
}

/**
 * Resuelve slugs a itemId. Necesario porque POST /v2/order pide id, no slug.
 * @param {string[]} slugs
 * @returns {Promise<Record<string, {id: string, name?: string, maxRank?: number}>>}
 */
export async function resolveIds(slugs) {
    const list = [...new Set(slugs.filter(Boolean))].slice(0, 100);
    if (!list.length) return {};

    // En tandas por el mismo motivo que attachItemInfo: cada ítem sin cachear cuesta
    // una escritura en el worker, y de golpe pasan del tope de subrequests (500).
    const chunks = [];
    for (let i = 0; i < list.length; i += 25) chunks.push(list.slice(i, i + 25));

    const out = {};
    await Promise.all(chunks.map(async (chunk) => {
        try {
            const res = await fetch(`${WORKER_URL}?type=wfm_ids&slugs=${chunk.join(",")}`);
            if (!res.ok) return;
            Object.assign(out, (await res.json()) || {});
        } catch { /* esos slugs se quedan sin id: su botón sale deshabilitado */ }
    }));
    return out;
}

/**
 * Cruza inventario y órdenes publicadas.
 *
 * @param {Array} [orders] órdenes ya cargadas. Pásalas siempre que las tengas: quien
 *   pinta la pestaña acaba de pedirlas, y volver a pedirlas aquí duplicaba la llamada
 *   a wfm_my_orders Y la de wfm_resolve (que con ~76 ítems no es barata).
 * @returns {Promise<{ok: boolean, unlisted?: Array, listed?: Array, stale?: Array, error?: string}>}
 *   unlisted: lo tienes y no está en venta
 *   listed:   lo tienes y ya está en venta (con la orden asociada)
 *   stale:    está en venta pero ya no lo tienes -> candidato a retirar
 */
export async function syncInventory(orders = null) {
    let list = orders;
    if (!list) {
        const res = await fetchMyOrders();
        if (!res.ok) return { ok: false, error: res.error };
        list = res.orders || [];
    }

    const sellable = collectSellable();

    // Solo las órdenes de venta compiten con el inventario: una orden de compra no
    // significa que tengas el ítem.
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

    // Lo publicado queda accesible para quien pinte inventario o sets: así el badge
    // "ya en venta" no cuesta ninguna petición y no obliga a esos módulos a saber de
    // sesiones ni de la API.
    listedSlugs = new Set(listed.map(i => i.slug));

    // Publicado pero ya no en el inventario: se vendió fuera de la app, o se usó.
    const owned = new Set(sellable.map(i => i.slug));
    const stale = sellOrders
        .filter(o => {
            const slug = o.itemSlug || o.item?.slug;
            // Solo se juzga lo que alguna fuente reconoce como suyo: un mod publicado no
            // es "obsoleto" solo porque el inventario todavía no siga mods.
            return slug && !owned.has(slug) && isTracked(slug);
        })
        .map(o => ({ slug: o.itemSlug || o.item?.slug, name: o.itemName, order: o }));

    return { ok: true, unlisted, listed, stale, seen: [...seen] };
}


/**
 * Publica una orden de venta.
 * @param {{itemId: string, platinum: number, quantity?: number, rank?: number, slug?: string}} spec
 *   slug es opcional pero conviene pasarlo: mantiene al día el badge del inventario.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
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

    // Se refleja al momento: sin esto el badge del inventario seguiría diciendo "sin
    // publicar" hasta el siguiente cruce completo.
    if (spec.slug) listedSlugs.add(spec.slug);
    return { ok: true };
}
