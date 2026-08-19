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
