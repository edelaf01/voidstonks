import { state } from "../../state.js";

const CON_BLUEPRINT = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);
const CATEGORIAS_BP = new Set(["Warframes", "Archwing"]);

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

export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
