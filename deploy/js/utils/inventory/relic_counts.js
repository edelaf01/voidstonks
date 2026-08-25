import { state } from "../../state.js";

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

export function relicKey(name) {
    return String(name || "").replace(/\s+Relic$/i, "").trim().toUpperCase();
}

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
