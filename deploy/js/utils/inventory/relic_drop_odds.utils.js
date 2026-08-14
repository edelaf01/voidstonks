import { state } from "../../state.js";

export const DROP_RATES_BY_RARITY = {
    rare: { intact: 0.02, exceptional: 0.04, flawless: 0.06, radiant: 0.10 },
    uncommon: { intact: 0.11, exceptional: 0.13, flawless: 0.17, radiant: 0.20 },
    common: { intact: 0.2533, exceptional: 0.2333, flawless: 0.20, radiant: 0.1667 },
};

export function getPartRarity(partName) {
    const drops = state.itemsDatabase[partName];
    if (drops && drops.length > 0) {
        let maxChance = 0;
        let hasCommon = false;
        let hasUncommon = false;

        drops.forEach((d) => {
            if (d.rarity) {
                const r = String(d.rarity).toLowerCase();
                // "uncommon" CONTIENE "common": mirando common primero, toda pieza poco común
                // se clasificaba como común. Y como abajo se devuelve "common" en cuanto
                // hasCommon es true, se le aplicaban las tasas equivocadas (radiant 0.1667 en
                // vez de 0.20), o sea más runs estimadas de las reales.
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

export function calculatePartExpectedRuns(partName, refinement = "radiant", squadSize = 4) {
    const rarity = getPartRarity(partName);
    const pSingle = DROP_RATES_BY_RARITY[rarity]?.[refinement] || 0.10;
    const pSquad = 1 - Math.pow(1 - pSingle, squadSize);
    if (pSquad <= 0) return Infinity;
    return 1 / pSquad;
}
