import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper, MEMORY_CACHE } from "../repositories/storage.repository.js";
import { getSlug } from "./slugs.service.js";

/**
 * Pre-fetches prices for all items currently in the player's inventory.
 */
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
            if (state.settings?.showEmptyPrime || parts.some((p) => (state.primeInventory[p] || 0) > 0)) {
                itemsToCheck.add(getSlug(`${setName} Set`));
                parts.forEach((p) => itemsToCheck.add(getSlug(p)));
            }
        });
    }

    return itemsToCheck;
}

/** Pre-fetches prices for all items currently in the player's inventory. */
export async function warmupPrices() {
    if (!state.primeInventory && state.inventory.length === 0) return;
    const slugsToFetch = Array.from(collectInventorySlugs()).filter((s) => !MEMORY_CACHE.has(s));
    if (slugsToFetch.length === 0) return;
    for (let i = 0; i < slugsToFetch.length; i += 50) {
        const chunk = slugsToFetch.slice(i, i + 50);
        try {
            const res = await fetch(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
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
