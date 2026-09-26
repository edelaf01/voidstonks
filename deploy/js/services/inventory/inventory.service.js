import { state } from "../../state.js";
import { dbHelper, MEMORY_CACHE, ensurePriceSnapshot, leeHistorialSets, guardaHistorialSets } from "../../repositories/storage.repository.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPricesBatch } from "../../repositories/api.repository.js";
import { apuntaPrecios, diaDe, tendencias } from "../../utils/inventory/set_trend.js";

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
            // Aquí NO entra showEmptyPrime a propósito. Este bucle recorre el catálogo entero, y
            // con la casilla puesta pedía el precio de todas las piezas de todos los sets — miles
            // de consultas a warframe.market por marcar un filtro de la lista. La casilla decide
            // qué se PINTA (ui_prime_inventory.js), no cuánto se descarga; las piezas a 0 que sí
            // tienes ya entran por collectInventorySlugs() unas líneas más arriba.
            if (parts.some((p) => (state.primeInventory[p] || 0) > 0)) {
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
    apuntaPreciosDeSets(await ensurePriceSnapshot());

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

export function apuntaPreciosDeSets(snapshot, ahora = Date.now()) {
    if (!snapshot || !state.setsDatabase) return;
    const precios = {};
    for (const [setName, parts] of Object.entries(state.setsDatabase)) {
        // Del snapshot y no de MEMORY_CACHE: ahí se mezclan precios en vivo y cambiar de fuente parecería una subida.
        if (parts.some((p) => (state.primeInventory?.[p] || 0) > 0)) precios[setName] = snapshot[getSlug(`${setName} Set`)] || 0;
    }
    // Con el inventario aún sin cargar, guardar vacío borraría el histórico.
    if (Object.keys(precios).length) guardaHistorialSets(apuntaPrecios(leeHistorialSets(), precios, diaDe(ahora)));
}

export function tendenciaDeSets(dias, ahora = Date.now()) {
    return tendencias(leeHistorialSets(), diaDe(ahora), dias);
}
