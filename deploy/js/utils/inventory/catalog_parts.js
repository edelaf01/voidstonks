import { state } from "../../state.js";

// rewards name warframe and archwing chassis, neuroptics, systems, harness and wings with a trailing
// "Blueprint"; sentinels do not
const CON_BLUEPRINT = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);
const CATEGORIAS_BP = new Set(["Warframes", "Archwing"]);

export const TIPOS_DE_PIEZA = new Set([
    "Blueprint", "Barrel", "Receiver", "Stock", "Blade", "Hilt",
    "Chassis", "Neuroptics", "Systems", "Carapace", "Cerebrum",
    "Harness", "Wings", "Link", "Pouch", "Stars", "Head", "Motor",
    "Grip", "String", "Limb", "Upper Limb", "Lower Limb", "Guard",
    "Disc", "Boot", "Gauntlet", "Chain", "Handle", "Ornament",
    "Buckle", "Band",
]);

/**
 * Galariak and Sagek Prime come with isPrime false (not tradeable) but drop at mission end: without them
 * the reader took Galariak for Galatine.
 */
export function esPrime(item) {
    return !!item?.isPrime || / Prime$/.test(item?.name || "");
}

/**
 * Parts of catalog primes with no part in any relic yet (just released), named as in the rewards.
 */
export function piezasSinReliquias(catalogo, nombresEnReliquias) {
    const conReliquia = new Set();
    for (const n of nombresEnReliquias) {
        const m = /^(.*? Prime)\b/.exec(n);
        if (m) conReliquia.add(m[1]);
    }
    return catalogo
        .filter((it) => esPrime(it) && !conReliquia.has(it.name))
        // untradeables have no ducats; the part type leaves resources out (Orokin Cell)
        .flatMap((it) => (it.components || []).filter((c) => c.ducats > 0 || TIPOS_DE_PIEZA.has(c.name)).map((c) => {
            const base = /\bPrime\b/.test(c.name) ? c.name : `${it.name} ${c.name}`;
            // untradeables give each part's blueprint: "Galariak Prime Blade Blueprint"
            const plano = CATEGORIAS_BP.has(it.category) ? CON_BLUEPRINT.has(c.name) : !it.isPrime && c.name !== "Blueprint";
            return plano ? `${base} Blueprint` : base;
        }));
}

/** Ducats of a part: from its relics or, when it drops from none yet, from the catalog. */
export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
