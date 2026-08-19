import { state } from "../../state.js";

export const DROP_RATES_BY_RARITY = {
    rare: { intact: 0.02, exceptional: 0.04, flawless: 0.06, radiant: 0.10 },
    uncommon: { intact: 0.11, exceptional: 0.13, flawless: 0.17, radiant: 0.20 },
    common: { intact: 0.2533, exceptional: 0.2333, flawless: 0.20, radiant: 0.1667 },
};

// state.refinement holds the UI label ("Rad"); the rates use lowercase
export const REFINEMENT_KEYS = {
    Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Rad: "radiant",
};

export const REFINEMENT_LABELS = Object.fromEntries(
    Object.entries(REFINEMENT_KEYS).map(([label, key]) => [key, label]),
);

/** Player refinement and squad, normalized for the rates. */
export function getPlayerOdds() {
    return {
        refinement: REFINEMENT_KEYS[state.refinement] || "radiant",
        squadSize: Math.min(4, Math.max(1, state.squadSize || 4)),
    };
}

/**
 * Rarity as the drop table writes it, reduced to a DROP_RATES_BY_RARITY key. null when unknown, so the
 * caller can skip sorting instead of sorting wrong.
 */
export function normalizeRarity(rarity) {
    const r = String(rarity || "").toLowerCase();
    // "uncommon" CONTAINS "common": check it first
    if (r.includes("uncommon")) return "uncommon";
    if (r.includes("common")) return "common";
    if (r.includes("rare")) return "rare";
    return null;
}

/**
 * Real rarity of a reward inside a relic, from its intact chance. The source's `rarity` label is wrong:
 * warframe-drop-data has no "Common" for relics.
 */
export function rarityFromChance(chance) {
    let c = Number(chance);
    if (!Number.isFinite(c) || c <= 0) return null;
    // some sources give it as a fraction
    if (c <= 1.0) c *= 100;
    if (c > 17) return "common";
    if (c > 5) return "uncommon";
    return "rare";
}

/**
 * Average runs for a given reward of a given relic. The chance rules; the label is only read without a
 * chance (see rarityFromChance).
 */
export function runsForDrop(drop, refinement = "radiant", squadSize = 4) {
    const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
    return runsForRarity(rarity, refinement, squadSize);
}

/**
 * Average runs for a part with THAT rarity in ONE relic. The drop table chance is the intact one, and
 * refining changes the order: uncommon goes up while common goes down.
 * @returns {number|null}
 */
export function runsForRarity(rarity, refinement = "radiant", squadSize = 4) {
    const key = normalizeRarity(rarity);
    const pSingle = key ? DROP_RATES_BY_RARITY[key]?.[refinement] : null;
    if (!pSingle) return null;
    // squadSize not clamped on purpose: 0 players gives Infinity runs, which is what to show.
    // getPlayerOdds() clamps
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
                // "uncommon" CONTAINS "common": check it first
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

    const dVal = state.itemsDatabase[partName] ? state.itemsDatabase[partName][0]?.ducats : 0;
    if (dVal === 15) return "common";
    if (dVal === 45) return "uncommon";
    if (dVal === 100) return "rare";

    return "common";
}

/**
 * Average runs for a part without choosing a relic: the rarity of the relic where it drops best, so the
 * best case. runsForRarity compares concrete relics.
 */
export function calculatePartExpectedRuns(partName, refinement = "radiant", squadSize = 4) {
    const runs = runsForRarity(getPartRarity(partName), refinement, squadSize);
    // unknown refinement: falls back to radiant rare
    return runs ?? runsForRarity("rare", "radiant", squadSize);
}

/**
 * What you expect from opening ONE relic, in the unit `valueOf` returns (platinum, ducats...).
 *
 * In a squad N relics open and the group keeps ONE reward, the best: each reward's chance is that of
 * being the max of N rolls.
 *
 * @param drops   relic rewards: [{ chance, rarity? }]
 * @param valueOf (drop) => what that reward is worth; unknown goes to 0.
 */
export function relicOpenEV(drops, { refinement = "radiant", squadSize = 1, valueOf } = {}) {
    if (!Array.isArray(drops) || drops.length === 0) return 0;

    const entries = drops.map((d) => {
        const rarity = rarityFromChance(d?.chance) ?? normalizeRarity(d?.rarity);
        return {
            value: Math.max(0, Number(valueOf ? valueOf(d) : d?.value) || 0),
            // unknown rarity: chance 0 instead of an invented one; the residual below picks up the gap
            p: (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0,
        };
    }).sort((a, b) => a.value - b.value);

    // a real relic has 6 slots summing to 1: what is missing enters as an unvalued reward, first since
    // the list goes from low to high
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
