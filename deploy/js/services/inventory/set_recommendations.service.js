import { state } from "../../state.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getRequiredCount } from "../../utils/ui_utils.js";
import { getPriceValue } from "../../repositories/storage.repository.js";
import { calculatePartExpectedRuns, getPlayerOdds } from "../../utils/inventory/relic_drop_odds.utils.js";

// below this share of the full set price, buying the part beats farming it
const BUY_INSTEAD_RATIO = 0.15;

const RECS_PREFS_KEY = "vs_farm_routes_filters_v2";
const DEFAULT_RECS_PREFS = {
    maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0, sortBy: "near", era: "",
    bestFor: "",
};
const SORT_KEYS = new Set(["near", "perHour", "gain"]);
// Requiem relics also complete parts (Kuva/Tenet)
export const RELIC_ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
const ERA_KEYS = new Set(["", ...RELIC_ERAS]);
// "" = any; filters by the refinement where the route is cheapest
export const REFINEMENT_KEYS_FILTER = ["intact", "exceptional", "flawless", "radiant"];
const BESTFOR_KEYS = new Set(["", ...REFINEMENT_KEYS_FILTER]);

export function getSetRecsPrefs() {
    try {
        const raw = localStorage.getItem(RECS_PREFS_KEY);
        if (!raw) return { ...DEFAULT_RECS_PREFS };
        const parsed = JSON.parse(raw);
        // a stored NaN would fail every comparison and empty the list
        const umbral = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
        return {
            maxMissing: Number.isInteger(parsed.maxMissing) ? parsed.maxMissing : 0,
            buyOnly: typeof parsed.buyOnly === "boolean" ? parsed.buyOnly : false,
            query: typeof parsed.query === "string" ? parsed.query : "",
            minPerHour: umbral(parsed.minPerHour),
            minGain: umbral(parsed.minGain),
            sortBy: SORT_KEYS.has(parsed.sortBy) ? parsed.sortBy : "near",
            era: ERA_KEYS.has(parsed.era) ? parsed.era : "",
            bestFor: BESTFOR_KEYS.has(parsed.bestFor) ? parsed.bestFor : "",
        };
    } catch (e) {
        return { ...DEFAULT_RECS_PREFS };
    }
}

export function saveSetRecsPrefs(prefs) {
    try {
        localStorage.setItem(RECS_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        console.error("Error guardando preferencias de recomendaciones de sets:", e);
    }
}

// recommendations keep their parts in `.matches`, routes in `.missing`
const MATCHES = (rec) => rec.matches;

/**
 * Eras of every relic that drops a missing part, not only the recommended one.
 */
export function erasOf(rec, piecesOf = MATCHES) {
    const eras = new Set();
    for (const m of piecesOf(rec) || []) {
        for (const src of m.relics || m.fissures || []) if (src?.tier) eras.add(src.tier);
    }
    return eras;
}

function applyRecsPrefs(recommendations, prefs, piecesOf = MATCHES) {
    let filtered = recommendations;

    // matches the set name and its part names
    const query = normalizeQuery(prefs.query);
    if (query) {
        filtered = filtered.filter((rec) =>
            normalizeQuery(rec.setName).includes(query)
            || (piecesOf(rec) || []).some((m) => normalizeQuery(m.part).includes(query)));
    }

    if (prefs.maxMissing > 0) {
        filtered = filtered.filter((rec) => rec.missingCount <= prefs.maxMissing);
    }

    if (prefs.era) {
        filtered = filtered.filter((rec) => erasOf(rec, piecesOf).has(prefs.era));
    }

    // "best for intact" = closes sooner without spending traces
    if (prefs.bestFor) {
        filtered = filtered.filter((rec) => rec.bestRefinement === prefs.bestFor);
    }

    // an unpriced route fails a minimum on purpose; sorting keeps it at the end instead
    if (prefs.minPerHour > 0) {
        filtered = filtered.filter((rec) => (rec.platPerHour ?? 0) >= prefs.minPerHour);
    }
    if (prefs.minGain > 0) {
        filtered = filtered.filter((rec) => (rec.gain ?? 0) >= prefs.minGain);
    }
    if (prefs.buyOnly) {
        // keeps the whole route: each part line is the farming plan
        filtered = filtered.filter((rec) => (piecesOf(rec) || []).some((m) => m.betterToBuy));
    }
    return filtered;
}

/**
 * Lowercase without accents. Shared with the Set tab strip so both searches match.
 */
export function normalizeQuery(text) {
    return String(text || "")
        .normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "")
        .toLowerCase().trim();
}

function normalizeFissureTier(tier) {
    if (tier === "Vanguard") return "Axi";
    return tier;
}

// some sets need 2 of the same part
function getMissingParts(setName) {
    const parts = state.setsDatabase?.[setName] || [];
    return parts.filter((p) => (state.primeInventory?.[p] || 0) < (getRequiredCount(setName, p) || 1));
}

export function getFissureSetRecommendations(activeFissures) {
    if (!state.setsDatabase || !state.itemsDatabase || !Array.isArray(activeFissures) || activeFissures.length === 0) {
        return [];
    }

    const fissuresByTier = new Map();
    for (const f of activeFissures) {
        const tier = normalizeFissureTier(f.tier);
        if (!fissuresByTier.has(tier)) fissuresByTier.set(tier, []);
        fissuresByTier.get(tier).push(f);
    }
    if (fissuresByTier.size === 0) return [];

    const { refinement, squadSize } = getPlayerOdds();

    const recommendations = [];

    for (const setName of Object.keys(state.setsDatabase)) {
        const totalParts = state.setsDatabase[setName].length;
        const missingParts = getMissingParts(setName);
        if (missingParts.length === 0) continue;

        const matches = [];
        for (const part of missingParts) {
            const sources = state.itemsDatabase[part] || [];
            const fissures = [];
            const seenNodes = new Set();
            for (const src of sources) {
                const tier = normalizeFissureTier(src.tier);
                const tierFissures = fissuresByTier.get(tier);
                if (!tierFissures) continue;
                for (const f of tierFissures) {
                    const key = `${f.node}|${f.type}`;
                    if (seenNodes.has(key)) continue;
                    seenNodes.add(key);
                    fissures.push(f);
                }
            }
            if (fissures.length > 0) {
                const avgRuns = calculatePartExpectedRuns(part, refinement, squadSize);
                matches.push({ part, fissures, ducats: sources[0]?.ducats || 0, avgRuns });
            }
        }

        if (matches.length === 0) continue;

        recommendations.push({
            setName,
            totalParts,
            missingCount: missingParts.length,
            missingParts,
            matches,
        });
    }

    recommendations.sort((a, b) => {
        if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
        const aFissures = a.matches.reduce((n, m) => n + m.fissures.length, 0);
        const bFissures = b.matches.reduce((n, m) => n + m.fissures.length, 0);
        return bFissures - aFissures;
    });

    return recommendations;
}

export async function attachSetPrices(recommendations, piecesOf = MATCHES) {
    await Promise.all(recommendations.map(async (rec) => {
        const setItemName = `${rec.setName} Set`;
        rec.setPricePlat = await getPriceValue(setItemName, getSlug(setItemName));

        await Promise.all(piecesOf(rec).map(async (m) => {
            m.buyPricePlat = await getPriceValue(m.part, getSlug(m.part));
            const ratio = rec.setPricePlat > 0 ? m.buyPricePlat / rec.setPricePlat : 0;
            m.betterToBuy = m.buyPricePlat > 0 && ratio > 0 && ratio <= BUY_INSTEAD_RATIO;
        }));
    }));
    return recommendations;
}

export function filterSetRecommendations(recommendations, prefs = getSetRecsPrefs(), piecesOf = MATCHES) {
    return applyRecsPrefs(recommendations, prefs, piecesOf);
}
