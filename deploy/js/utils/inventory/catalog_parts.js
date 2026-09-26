import { state } from "../../state.js";

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

// items Galariak and Sagek Prime have isPrime false but drop at mission end
export function esPrime(item) {
    return !!item?.isPrime || / Prime$/.test(item?.name || "");
}

export function piezasSinReliquias(catalogo, nombresEnReliquias) {
    const conReliquia = new Set();
    for (const n of nombresEnReliquias) {
        const m = /^(.*? Prime)\b/.exec(n);
        if (m) conReliquia.add(m[1]);
    }
    return catalogo
        .filter((it) => esPrime(it) && !conReliquia.has(it.name))
        .flatMap((it) => (it.components || []).filter((c) => c.ducats > 0 || TIPOS_DE_PIEZA.has(c.name)).map((c) => {
            const base = /\bPrime\b/.test(c.name) ? c.name : `${it.name} ${c.name}`;
            const plano = CATEGORIAS_BP.has(it.category) ? CON_BLUEPRINT.has(c.name) : !it.isPrime && c.name !== "Blueprint";
            return plano ? `${base} Blueprint` : base;
        }));
}

export function ducadosDePieza(nombre) {
    return state.itemsDatabase?.[nombre]?.[0]?.ducats || state.ducatsDatabase?.[nombre]?.ducats || 0;
}
