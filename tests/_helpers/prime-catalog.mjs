import { readFileSync } from "node:fs";

/**
 * El catálogo REAL de piezas Prime, sacado de los JSON que ya lleva el repo
 * (`cleaned_entities.json` = warframes/centinelas, `cleaned_weapons.json` = armas).
 *
 * Existe porque las listas de piezas escritas a mano en los tests eran de 20-300 nombres
 * inventados, y el matcher se juega justamente ahí: `getValidItemMatch` y `parseRewards`
 * eligen contra TODO el catálogo, así que con 20 vecinos cualquier lectura sucia acierta y
 * con los 800 de verdad compite contra "Braton Prime Stock" vs "Braton Prime Barrel" vs
 * "Boltor Prime Stock". Un test con catálogo pequeño mide un problema más fácil que el real.
 */

const RAIZ = new URL("../../deploy/assets/json/", import.meta.url);
const lee = (f) => JSON.parse(readFileSync(new URL(f, RAIZ), "utf8"));

// Componentes que NO son una pieza vendible del set (recursos del blueprint).
const RECURSOS = new Set(["Orokin Cell", "Argon Crystal", "Nitain Extract", "Tellurium",
    "Neural Sensors", "Neurodes", "Gallium", "Morphics", "Control Module", "Oxium"]);

// El nombre de mercado de un componente de warframe lleva "Blueprint" detrás; el de un arma no.
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
 * @param {boolean} [soloPrime=true] false incluye también las piezas no-prime, que es lo que
 *        ve el escáner cuando el jugador tiene el catálogo entero cargado.
 * @returns {string[]} nombres de pieza tal y como los indexa `state.itemsDatabase`.
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

/** Lo que `initMatcherData` espera en `state.itemsDatabase`. */
export function comoItemsDatabase(nombres = catalogoPrime()) {
    return Object.fromEntries(nombres.map((n) => [n, [{ ducats: 15, name: n }]]));
}
