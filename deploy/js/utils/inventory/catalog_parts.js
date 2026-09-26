import { state } from "../../state.js";

// Nombre con que sale cada pieza en las recompensas: warframes y archwings llevan "Blueprint"
// detrás de chasis, neurópticos, sistemas, arnés y alas; los sentinels no.
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
 * Galariak y Sagek Prime (The Perita Rebellion) llegan con isPrime false por no ser intercambiables,
 * pero salen en fin de misión: sin ellos en el catálogo el lector tomaba Galariak por Galatine.
 */
export function esPrime(item) {
    return !!item?.isPrime || / Prime$/.test(item?.name || "");
}

/**
 * Piezas de los primes del catálogo de los que no sale NINGUNA pieza en las reliquias: los recién
 * lanzados, hasta que se publican las tablas de drops. Con el nombre de las recompensas; medido,
 * casa en 575 de 575 piezas de los primes que sí tienen reliquias.
 */
export function piezasSinReliquias(catalogo, nombresEnReliquias) {
    const conReliquia = new Set();
    for (const n of nombresEnReliquias) {
        const m = /^(.*? Prime)\b/.exec(n);
        if (m) conReliquia.add(m[1]);
    }
    return catalogo
        .filter((it) => esPrime(it) && !conReliquia.has(it.name))
        // Los no intercambiables no tienen ducados; el tipo de pieza deja fuera los recursos (Orokin Cell).
        .flatMap((it) => (it.components || []).filter((c) => c.ducats > 0 || TIPOS_DE_PIEZA.has(c.name)).map((c) => {
            const base = /\bPrime\b/.test(c.name) ? c.name : `${it.name} ${c.name}`;
            // Los no intercambiables dan el plano de cada pieza: "Galariak Prime Blade Blueprint".
            const plano = CATEGORIAS_BP.has(it.category) ? CON_BLUEPRINT.has(c.name) : !it.isPrime && c.name !== "Blueprint";
            return plano ? `${base} Blueprint` : base;
        }));
}

/** Ducados de una pieza: de sus reliquias o, si aún no sale en ninguna, del catálogo. */
export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
