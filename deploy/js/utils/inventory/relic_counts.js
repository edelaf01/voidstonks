import { state } from "../../state.js";

/**
 * Copies of each relic, keyed by the name WITHOUT the " Relic" suffix.
 *
 * The inventory mixes the old string array and `{name, count}`, and names are stored with or without
 * " Relic" depending on where they came from; both are solved here once.
 *
 * @returns {Record<string, number>} e.g. { "Lith K5": 3 }
 */
export function getRelicCounts() {
    const counts = {};
    for (const item of state.inventory || []) {
        const isString = typeof item === "string";
        const name = (isString ? item : item?.name || "").replace(/\s+Relic$/, "").trim();
        if (!name) continue;
        counts[name] = (counts[name] || 0) + (isString ? 1 : item.count || 1);
    }
    return counts;
}
