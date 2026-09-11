import { readFileSync } from "node:fs";

const RAIZ = new URL("../../deploy/assets/json/", import.meta.url);
const lee = (f) => JSON.parse(readFileSync(new URL(f, RAIZ), "utf8"));

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

export function catalogoPrime(soloPrime = true) {
    const fuentes = [...lee("cleaned_entities.json"), ...lee("cleaned_weapons.json")];
    const piezas = new Set(["Forma Blueprint", "Forma Blueprint (Aura)"]);
    for (const e of fuentes) {
        if (soloPrime && !e.isPrime) continue;
        for (const n of piezasDe(e)) piezas.add(n);
    }
    return [...piezas].sort();
}

export function comoItemsDatabase(nombres = catalogoPrime()) {
    return Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15, name: n }]]));
}
