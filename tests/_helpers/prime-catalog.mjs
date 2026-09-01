import { readFileSync } from "node:fs";

/**
 * the REAL Prime parts catalog, from the repo JSON (`cleaned_entities.json` warframes and sentinels, `cleaned_weapons.json` weapons)
 * the matcher picks against the WHOLE catalog, so a 20-name test list measures an easier problem than the real one
 */

const RAIZ = new URL("../../deploy/assets/json/", import.meta.url);
const lee = (f) => JSON.parse(readFileSync(new URL(f, RAIZ), "utf8"));

// components that are NOT a sellable set part (blueprint resources)
const RECURSOS = new Set(["Orokin Cell", "Argon Crystal", "Nitain Extract", "Tellurium",
    "Neural Sensors", "Neurodes", "Gallium", "Morphics", "Control Module", "Oxium"]);

// a warframe component market name ends in "Blueprint"; a weapon one does not
const CON_BLUEPRINT = new Set(["Chassis", "Neuroptics", "Systems", "Harness", "Wings"]);

function piezasDe(entidad) {
    const nombres = [];
    for (const c of entidad.components || []) {
        if (RECURSOS.has(c.name)) continue;
        nombres.push(`${entidad.name} ${c.name}${CON_BLUEPRINT.has(c.name) ? " Blueprint" : ""}`);
    }
    return nombres;
}

/**
 * @param {boolean} [soloPrime=true]
 * @returns {string[]}
 */
export function catalogoPrime(soloPrime = true) {
    const fuentes = [...lee("cleaned_entities.json"), ...lee("cleaned_weapons.json")];
    const piezas = new Set(["Forma Blueprint", "Forma Blueprint (Aura)"]);
    for (const e of fuentes) {
        if (soloPrime && !e.isPrime) continue;
        for (const n of piezasDe(e)) piezas.add(n);
    }
    return [...piezas].sort();
}

/** what `initMatcherData` expects in `state.itemsDatabase` */
export function comoItemsDatabase(nombres = catalogoPrime()) {
    return Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15, name: n }]]));
}
