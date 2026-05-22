import { state } from "../state.js";

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

export function getRivenSlug(inputVal) {
    if (!inputVal) return "";
    
    let cleanVal = inputVal.toLowerCase().trim().replaceAll("&", "and").replaceAll("-", "_").replaceAll(/\s+/g, "_");
    
    cleanVal = cleanVal.replaceAll(/[^a-z0-9_]/g, "");
    cleanVal = cleanVal.replaceAll(/_+/g, "_");
    
    // dual weapon: Dex Furis uses the Afuris riven mod
    if (cleanVal === "dex_furis" || cleanVal === "dex_afuris") {
        return "afuris";
    }
    
    const overrides = {
        "pangolin_prime": "pangolin_sword",
        "prime_laser_rifle": "laser_rifle",
        "prime_burst_laser": "burst_laser",
        "prime_robo_deth": "robo_deth",
        "prime_deth_machine_rifle": "deth_machine_rifle",
        "vaykor_marelok": "marelok",
        "vaykor_hek": "hek"
    };
    
    if (overrides[cleanVal]) {
        return overrides[cleanVal];
    }
    
    let baseCandidate = cleanVal;
    const prefixes = [
        "coda_", "kuva_", "tenet_", "mk1_", "mk_1_", "prisma_", "dex_", "carmine_",
        "telos_", "synoid_", "secura_", "rakta_", "sancti_", "mara_",
        "vaykor_", "dragon_", "prime_"
    ];
    const suffixes = ["_prime", "_vandal", "_wraith", "_coda"];

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

    if (baseCandidate === "pangolin") {
        baseCandidate = "pangolin_sword";
    }

    if (baseCandidate === cleanVal) return cleanVal;

    let allNames = state.allRivenNames || [];
    if (!allNames.length && state.weaponMap) {
        allNames = Object.keys(state.weaponMap);
    }
    const baseExists = allNames.some((name) => {
        const slug = name.toLowerCase().trim().replaceAll("&", "and").replaceAll("-", "_").replaceAll(/[^a-z0-9 ]/g, "").trim().replaceAll(/\s+/g, "_").replaceAll(/_+/g, "_");
        return slug === baseCandidate;
    });

    return baseExists ? baseCandidate : cleanVal;
}

