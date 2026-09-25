import { state } from "../../state.js";

// rewards name warframe and archwing chassis, neuroptics, systems, harness and wings with a trailing
// "Blueprint"; sentinels do not
const CON_BLUEPRINT = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);
const CATEGORIAS_BP = new Set(["Warframes", "Archwing"]);

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
        .filter((it) => it?.isPrime && !conReliquia.has(it.name))
        .flatMap((it) => (it.components || []).filter((c) => c.ducats > 0).map((c) => {
            const base = /\bPrime\b/.test(c.name) ? c.name : `${it.name} ${c.name}`;
            return CATEGORIAS_BP.has(it.category) && CON_BLUEPRINT.has(c.name) ? `${base} Blueprint` : base;
        }));
}

/** Ducats of a part: from its relics or, when it drops from none yet, from the catalog. */
export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
