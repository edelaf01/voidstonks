import { state } from "../../state.js";
import { ducadosDePieza } from "./catalog_parts.js";

export const DROP_RATES_BY_RARITY = {
    rare: { intact: 0.02, exceptional: 0.04, flawless: 0.06, radiant: 0.10 },
    uncommon: { intact: 0.11, exceptional: 0.13, flawless: 0.17, radiant: 0.20 },
    common: { intact: 0.2533, exceptional: 0.2333, flawless: 0.20, radiant: 0.1667 },
};

export const REFINEMENT_KEYS = {
    Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Rad: "radiant",
};

export function getPlayerOdds() {
    return {
        refinement: REFINEMENT_KEYS[state.refinement] || "radiant",
        squadSize: Math.min(4, Math.max(1, state.squadSize || 4)),
    };
}

export function normalizeRarity(rarity) {
    const r = String(rarity || "").toLowerCase();
    // "uncommon" contains "common": check it first
    if (r.includes("uncommon")) return "uncommon";
    if (r.includes("common")) return "common";
    if (r.includes("rare")) return "rare";
    return null;
}

export function rarityFromChance(chance) {
    let c = Number(chance);
    if (!Number.isFinite(c) || c <= 0) return null;
    if (c <= 1.0) c *= 100;
    if (c > 17) return "common";
    if (c > 5) return "uncommon";
    return "rare";
}

export function runsForDrop(drop, refinement = "radiant", squadSize = 4) {
    const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
    return runsForRarity(rarity, refinement, squadSize);
}

export function runsForRarity(rarity, refinement = "radiant", squadSize = 4) {
    const key = normalizeRarity(rarity);
    const pSingle = key ? DROP_RATES_BY_RARITY[key]?.[refinement] : null;
    if (!pSingle) return null;
    const pSquad = 1 - Math.pow(1 - pSingle, squadSize);
    return pSquad > 0 ? 1 / pSquad : Infinity;
}

export function getPartRarity(partName) {
    const drops = state.itemsDatabase[partName];
    if (drops && drops.length > 0) {
        let maxChance = 0;
        let hasCommon = false;
        let hasUncommon = false;

        drops.forEach((d) => {
            if (d.rarity) {
                const r = String(d.rarity).toLowerCase();
                if (r.includes("uncommon")) hasUncommon = true;
                else if (r.includes("common")) hasCommon = true;
            }
            let c = d.chance;
            if (c !== undefined && c !== null) {
                if (c <= 1.0) c = c * 100;
                if (c > maxChance) maxChance = c;
            }
        });

        if (hasCommon || maxChance > 17) return "common";
        if (hasUncommon || maxChance > 5) return "uncommon";
        if (maxChance > 0) return "rare";
    }

    const dVal = ducadosDePieza(partName);
    if (dVal === 15) return "common";
    if (dVal === 45) return "uncommon";
    if (dVal === 100) return "rare";

    return "common";
}

export function calculatePartExpectedRuns(partName, refinement = "radiant", squadSize = 4) {
    const runs = runsForRarity(getPartRarity(partName), refinement, squadSize);
    return runs ?? runsForRarity("rare", "radiant", squadSize);
}

export function relicOpenEV(drops, { refinement = "radiant", squadSize = 1, valueOf } = {}) {
    if (!Array.isArray(drops) || drops.length === 0) return 0;

    const entries = drops.map((d) => {
        const rarity = rarityFromChance(d?.chance) ?? normalizeRarity(d?.rarity);
        return {
            value: Math.max(0, Number(valueOf ? valueOf(d) : d?.value) || 0),
            p: (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0,
        };
    }).sort((a, b) => a.value - b.value);

    const listed = entries.reduce((sum, e) => sum + e.p, 0);
    if (listed < 1) entries.unshift({ value: 0, p: 1 - listed });

    let ev = 0;
    let acc = 0;
    for (const e of entries) {
        const next = acc + e.p;
        ev += e.value * (Math.pow(next, squadSize) - Math.pow(acc, squadSize));
        acc = next;
    }
    return ev;
}
