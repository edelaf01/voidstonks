import { state } from "../../state.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getRequiredCount } from "../../utils/ui_utils.js";
import { getPriceValue } from "../../repositories/storage.repository.js";
import { calculatePartExpectedRuns, getPlayerOdds } from "../../utils/inventory/relic_drop_odds.utils.js";

// Por debajo de este % del precio del set completo, comprar la pieza suelta sale más a cuenta
// que farmearla (referencia: coste de oportunidad bajo frente al valor total del set).
const BUY_INSTEAD_RATIO = 0.15;

// v2 al fusionarse los dos paneles del inventario. La clave vieja guardaba filtros que se
// configuraron sobre la lista de RECOMENDACIONES; aplicados de golpe a las RUTAS, un
// "máx. 1 pieza restante" que alguien dejó puesto hace meses esconde casi todo el panel y no
// hay forma de adivinar por qué está vacío. Clave nueva = todo el mundo arranca sin filtro.
const RECS_PREFS_KEY = "vs_farm_routes_filters_v2";
// Los umbrales van a 0 = apagado, y el orden a "near" = el de siempre: quien ya tenía filtros
// guardados no se encuentra la lista reordenada ni recortada al actualizar.
const DEFAULT_RECS_PREFS = {
    maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0, sortBy: "near", era: "",
    bestFor: "",
};
const SORT_KEYS = new Set(["near", "perHour", "gain"]);
// "" = cualquiera. Requiem entra porque sus reliquias también cierran piezas (Kuva/Tenet).
export const RELIC_ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
const ERA_KEYS = new Set(["", ...RELIC_ERAS]);
// "" = cualquiera. Filtra por el refinamiento con el que la ruta sale más barata.
export const REFINEMENT_KEYS_FILTER = ["intact", "exceptional", "flawless", "radiant"];
const BESTFOR_KEYS = new Set(["", ...REFINEMENT_KEYS_FILTER]);

export function getSetRecsPrefs() {
    try {
        const raw = localStorage.getItem(RECS_PREFS_KEY);
        if (!raw) return { ...DEFAULT_RECS_PREFS };
        const parsed = JSON.parse(raw);
        // Los umbrales se saneen a un entero >= 0: un NaN guardado (input vacío) filtraba con
        // NaN y toda comparación daba false, o sea la lista entera vacía sin motivo visible.
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

// Las piezas de una recomendación viven en `.matches`, pero el panel unificado trabaja sobre
// RUTAS, que las llaman `.missing`. Es la única diferencia de forma entre las dos, así que se
// parametriza en vez de duplicar el filtrado y el cálculo de precios.
const MATCHES = (rec) => rec.matches;

/**
 * Eras de las reliquias que sueltan lo que falta de un set.
 *
 * Se miran TODAS las reliquias de cada pieza, no solo la recomendada: la pregunta que contesta
 * el filtro es "tengo Lith de sobra, ¿qué avanzo con ellas?", y una pieza suele caer de varias
 * eras. Quedarse con `relics[0]` escondería sets que sí se pueden avanzar con esa era.
 *
 * Sirve a las dos formas que pasan por aquí: las RUTAS traen `relics` por pieza y las
 * recomendaciones de fisura traen `fissures`. Ambas llevan `tier`.
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

    // Busca en el nombre del SET y en el de sus piezas: quien escribe "chasis" quiere ver los
    // sets a los que les falta un chasis, y quien escribe "saryn" el suyo. Sin acentos ni
    // mayúsculas, que es como se teclea de verdad.
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

    // "Mejor para intacta" = las rutas que se cierran antes SIN gastar vestigios. Es el filtro
    // que contesta "¿en qué me gasto los vestigios y en qué no?": a un set de piezas comunes
    // refinar le BAJA la tasa (25,3 % → 16,7 %) y encima cuesta 100 por reliquia.
    if (prefs.bestFor) {
        filtered = filtered.filter((rec) => rec.bestRefinement === prefs.bestFor);
    }

    // Umbrales de platino. Una ruta sin valorar (`gain`/`platPerHour` a null porque el precio
    // del set no estaba en caché) NO cumple "págame 100 p/h o más", así que sale. Es lo
    // contrario de lo que hace el orden, que las conserva detrás: allí no hay nada que pedir,
    // aquí has puesto un mínimo a propósito. Cuál de los dos filtros vació la lista lo dice
    // el estado vacío del panel.
    if (prefs.minPerHour > 0) {
        filtered = filtered.filter((rec) => (rec.platPerHour ?? 0) >= prefs.minPerHour);
    }
    if (prefs.minGain > 0) {
        filtered = filtered.filter((rec) => (rec.gain ?? 0) >= prefs.minGain);
    }
    if (prefs.buyOnly) {
        // Se conserva la ruta ENTERA, solo se descartan las que no tienen ninguna pieza que
        // compense comprar. Recortar aquí sus piezas dejaría la ruta a medias: en el panel
        // unificado, la línea de cada pieza es el plan de farmeo, no solo el aviso de compra.
        filtered = filtered.filter((rec) => (piecesOf(rec) || []).some((m) => m.betterToBuy));
    }
    return filtered;
}

/**
 * Minúsculas y sin acentos: "Ámbar" y "ambar" tienen que encontrar lo mismo.
 *
 * Exportada porque la tira de la pestaña Set filtra con ella. Recopiarla allí es lo que lleva a
 * que un buscador encuentre "Bo Prime" y el otro no.
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

// Una copia no siempre cierra la pieza: hay sets que piden 2 del mismo componente. Contando
// solo "tienes alguna", esos salían como completos aquí mientras el panel de rutas —que sí
// mira getRequiredCount— los seguía listando como pendientes, justo encima y en el mismo panel.
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

    // Runs con TU refinamiento y TU escuadra, no con "radiante y 4" fijos: en solitario y
    // con reliquias intactas la estimación se va al triple, así que el número que se
    // enseñaba no era el del jugador que lo estaba leyendo.
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

/**
 * Aplica las preferencias de filtro guardadas (máximo de piezas restantes, solo "mejor comprar")
 * sobre recomendaciones que ya pasaron por attachSetPrices.
 */
export function filterSetRecommendations(recommendations, prefs = getSetRecsPrefs(), piecesOf = MATCHES) {
    return applyRecsPrefs(recommendations, prefs, piecesOf);
}
