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

/** The name without " Relic", the form two entries are compared in. */
export function relicKey(name) {
    return String(name || "").replace(/\s+Relic$/i, "").trim().toUpperCase();
}

/**
 * Puts a scan's counts into the inventory without duplicating entries.
 *
 * "Set" semantics, like the prime inventory: the scan REPLACES the count, it does not add. Entries are
 * compared by relicKey, so "Neo N12 Relic" finds "Neo N12". The STORED name is not touched.
 *
 * @param inventory  state.inventory (mix of strings and {name, count})
 * @param scanned    Map|Object of canonical name -> count read
 * @returns new array of {name, count}; entries at 0 drop
 */
export function mergeRelicCounts(inventory, scanned) {
    const out = [];
    const index = new Map();

    for (const item of inventory || []) {
        const isString = typeof item === "string";
        const name = (isString ? item : item?.name) || "";
        const key = relicKey(name);
        if (!key) continue;
        const count = isString ? 1 : Number(item?.count) || 1;
        const prev = index.get(key);
        // the old format repeats the relic once per copy: add them up
        if (prev) prev.count += count;
        else {
            const entry = { name: String(name).trim(), count };
            out.push(entry);
            index.set(key, entry);
        }
    }

    const pairs = scanned instanceof Map ? [...scanned] : Object.entries(scanned || {});
    for (const [name, raw] of pairs) {
        const key = relicKey(name);
        if (!key) continue;
        const count = Math.max(0, Math.round(Number(raw) || 0));
        const prev = index.get(key);
        if (prev) prev.count = count;
        else if (count > 0) {
            const entry = { name: String(name).trim(), count };
            out.push(entry);
            index.set(key, entry);
        }
    }

    return out.filter((e) => e.count > 0);
}
