import { state } from "../../state.js";
import { dbHelper, MEMORY_CACHE, ensurePriceSnapshot, leeHistorialSets, guardaHistorialSets } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPricesBatch } from "../../repositories/api.repository.js";
import { apuntaPrecios, diaDe, tendencias } from "../../utils/inventory/set_trend.js";

function collectInventorySlugs() {
    const itemsToCheck = new Set();
    const getSetName = (fullName) => {
        const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
        return match ? match[0].trim() : null;
    };

    Object.keys(state.primeInventory).forEach((name) => {
        if (state.primeInventory[name] <= 0 && !state.settings?.showEmptyPrime) return;
        itemsToCheck.add(getSlug(name));
        const setName = getSetName(name);
        if (setName) itemsToCheck.add(getSlug(`${setName} Set`));
    });

    state.inventory.forEach((item) => {
        state.relicsDatabase[item.name]?.forEach((d) => itemsToCheck.add(getSlug(d.name)));
    });

    if (state.setsDatabase) {
        Object.keys(state.setsDatabase).forEach((setName) => {
            const parts = state.setsDatabase[setName];
            // showEmptyPrime stays out on purpose: it decides what is drawn, not what is downloaded,
            // and here it would fetch every part of every set.
            if (parts.some((p) => (state.primeInventory[p] || 0) > 0)) {
                itemsToCheck.add(getSlug(`${setName} Set`));
                parts.forEach((p) => itemsToCheck.add(getSlug(p)));
            }
        });
    }

    return itemsToCheck;
}

export async function warmupPrices() {
    if (!state.primeInventory && state.inventory.length === 0) return;

    apuntaPreciosDeSets(await ensurePriceSnapshot());

    const slugsToFetch = Array.from(collectInventorySlugs()).filter((s) => !MEMORY_CACHE.has(s));
    if (slugsToFetch.length === 0) return;
    // 25: the worker cuts each batch with slice(0, 25)
    for (let i = 0; i < slugsToFetch.length; i += 25) {
        const chunk = slugsToFetch.slice(i, i + 25);
        try {
            const res = await getPricesBatch(chunk);
            if (!res.ok) continue;
            const data = await res.json();
            Object.entries(data).forEach(([slug, price]) => {
                if (price > 0) {
                    MEMORY_CACHE.set(slug, price);
                    dbHelper.set(`price_${slug}`, { val: price, time: Date.now() });
                }
            });
        } catch (e) {
            console.warn("Prefetch error", e);
        }
    }
}

export function apuntaPreciosDeSets(snapshot, ahora = Date.now()) {
    if (!snapshot || !state.setsDatabase) return;
    const precios = {};
    for (const [setName, parts] of Object.entries(state.setsDatabase)) {
        // from the snapshot, not MEMORY_CACHE, which mixes in live prices
        if (parts.some((p) => (state.primeInventory?.[p] || 0) > 0)) precios[setName] = snapshot[getSlug(`${setName} Set`)] || 0;
    }
    // inventory not loaded yet: saving empty would wipe the history
    if (Object.keys(precios).length) guardaHistorialSets(apuntaPrecios(leeHistorialSets(), precios, diaDe(ahora)));
}

export function tendenciaDeSets(dias, ahora = Date.now()) {
    return tendencias(leeHistorialSets(), diaDe(ahora), dias);
}
