import { state } from "../../state.js";

// Nombre con que sale cada pieza en las recompensas: warframes y archwings llevan "Blueprint"
// detrás de chasis, neurópticos, sistemas, arnés y alas; los sentinels no.
const CON_BLUEPRINT = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);
const CATEGORIAS_BP = new Set(["Warframes", "Archwing"]);

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
        .filter((it) => it?.isPrime && !conReliquia.has(it.name))
        .flatMap((it) => (it.components || []).filter((c) => c.ducats > 0).map((c) => {
            const base = /\bPrime\b/.test(c.name) ? c.name : `${it.name} ${c.name}`;
            return CATEGORIAS_BP.has(it.category) && CON_BLUEPRINT.has(c.name) ? `${base} Blueprint` : base;
        }));
}

/** Ducados de una pieza: de sus reliquias o, si aún no sale en ninguna, del catálogo. */
export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
