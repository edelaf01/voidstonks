import { state } from "../../state.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getPriceValue } from "../../repositories/storage.repository.js";
import { calculatePartExpectedRuns } from "../../utils/inventory/relic_drop_odds.utils.js";

// Por debajo de este % del precio del set completo, comprar la pieza suelta sale más a cuenta
// que farmearla (referencia: coste de oportunidad bajo frente al valor total del set).
const BUY_INSTEAD_RATIO = 0.15;

const RECS_PREFS_KEY = "vs_fissure_set_recs_prefs";
const DEFAULT_RECS_PREFS = { maxMissing: 0, buyOnly: false };

export function getSetRecsPrefs() {
    try {
        const raw = localStorage.getItem(RECS_PREFS_KEY);
        if (!raw) return { ...DEFAULT_RECS_PREFS };
        const parsed = JSON.parse(raw);
        return {
            maxMissing: Number.isInteger(parsed.maxMissing) ? parsed.maxMissing : 0,
            buyOnly: typeof parsed.buyOnly === "boolean" ? parsed.buyOnly : false,
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

function applyRecsPrefs(recommendations, prefs) {
    let filtered = recommendations;
    if (prefs.maxMissing > 0) {
        filtered = filtered.filter((rec) => rec.missingCount <= prefs.maxMissing);
    }
    if (prefs.buyOnly) {
        filtered = filtered
            .map((rec) => ({ ...rec, matches: rec.matches.filter((m) => m.betterToBuy) }))
            .filter((rec) => rec.matches.length > 0);
    }
    return filtered;
}

// state.refinement guarda la etiqueta de la UI ("Rad"); las tasas van en minúscula.
const REFINEMENT_KEYS = { Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Rad: "radiant" };

function normalizeFissureTier(tier) {
    if (tier === "Vanguard") return "Axi";
    return tier;
}

function getMissingParts(setName) {
    const parts = state.setsDatabase?.[setName] || [];
    return parts.filter((p) => !(state.primeInventory?.[p] > 0));
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

    // Runs con TU refinamiento y TU escuadra, no con "radiante y 4" fijos: en solitario y
    // con reliquias intactas la estimación se va al triple, así que el número que se
    // enseñaba no era el del jugador que lo estaba leyendo.
    const refinement = REFINEMENT_KEYS[state.refinement] || "radiant";
    const squadSize = Math.min(4, Math.max(1, state.playerCount || 4));

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

export async function attachSetPrices(recommendations) {
    await Promise.all(recommendations.map(async (rec) => {
        const setItemName = `${rec.setName} Set`;
        rec.setPricePlat = await getPriceValue(setItemName, getSlug(setItemName));

        await Promise.all(rec.matches.map(async (m) => {
            m.buyPricePlat = await getPriceValue(m.part, getSlug(m.part));
            const ratio = rec.setPricePlat > 0 ? m.buyPricePlat / rec.setPricePlat : 0;
            m.betterToBuy = m.buyPricePlat > 0 && ratio > 0 && ratio <= BUY_INSTEAD_RATIO;
        }));
    }));
    return recommendations;
}

/**
 * Aplica las preferencias de filtro guardadas (máximo de piezas restantes, solo "mejor comprar")
 * sobre recomendaciones que ya pasaron por attachSetPrices.
 */
export function filterSetRecommendations(recommendations, prefs = getSetRecsPrefs()) {
    return applyRecsPrefs(recommendations, prefs);
}
