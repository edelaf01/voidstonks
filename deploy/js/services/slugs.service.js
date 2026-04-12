import { state } from "../state.js";

/**
 * Converts an item name to a warframe.market URL slug.
 * @param {string} itemName
 * @returns {string}
 */
export function getSlug(itemName) {
    if (!itemName) return "";
    let cleanName = itemName.trim().replaceAll("&", "and");
    let slug = cleanName
        .toLowerCase()
        .replaceAll(/[^a-z0-9 ]/g, "")
        .trim()
        .replaceAll(/\s+/g, "_");
    const manualFixes = {
        kompressa_prime_receiver: "kompressa_prime_reciever",
        kavasa_prime_set: "kavasa_prime_kubrow_collar_set",
        kavasa_prime_blueprint: "kavasa_prime_kubrow_collar_blueprint",
        kavasa_prime_buckle: "kavasa_prime_kubrow_collar_buckle",
        kavasa_prime_band: "kavasa_prime_kubrow_collar_band",
    };
    return manualFixes[slug] || slug;
}

/**
 * Resolves a weapon name to its riven-compatible base slug.
 * Strips known prefixes/suffixes and validates against state.allRivenNames.
 * @param {string} inputVal
 * @returns {string}
 */
export function getRivenSlug(inputVal) {
    const originalSlug = inputVal.toLowerCase().trim().replaceAll(/\s+/g, "_");
    let baseCandidate = originalSlug;
    const prefixes = ["coda_", "kuva_", "tenet_", "mk1_", "prisma_", "dex_", "carmine_"];
    const suffixes = ["_prime", "_vandal", "_wraith"];

    let changed = true;
    while (changed) {
        changed = false;
        for (const pre of prefixes) {
            if (baseCandidate.startsWith(pre)) {
                baseCandidate = baseCandidate.substring(pre.length);
                changed = true;
            }
        }
        for (const suf of suffixes) {
            if (baseCandidate.endsWith(suf)) {
                baseCandidate = baseCandidate.substring(0, baseCandidate.length - suf.length);
                changed = true;
            }
        }
    }

    if (baseCandidate === originalSlug) return originalSlug;

    const allNames = state.allRivenNames || [];
    const baseExists = allNames.some((name) => {
        const slug = name.toLowerCase().trim().replaceAll(/\s+/g, "_");
        return slug === baseCandidate;
    });

    return baseExists ? baseCandidate : originalSlug;
}
