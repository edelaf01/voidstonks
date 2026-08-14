import { state } from "../../state.js";
import { dbHelper, MEMORY_CACHE, ensurePriceSnapshot } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPricesBatch } from "../../repositories/api.repository.js";

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

    // El snapshot cubre el catálogo prime entero de una vez; el bucle de abajo solo se
    // ocupa de lo que quede fuera.
    await ensurePriceSnapshot();

    const slugsToFetch = Array.from(collectInventorySlugs()).filter((s) => !MEMORY_CACHE.has(s));
    if (slugsToFetch.length === 0) return;
    // 25 y no 50: el worker recorta el lote con slice(0, 25), así que la segunda mitad de
    // cada chunk se descartaba en silencio y acababa pidiéndose de una en una.
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
