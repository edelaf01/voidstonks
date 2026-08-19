import { state } from "../../state.js";

export const DROP_RATES_BY_RARITY = {
    rare: { intact: 0.02, exceptional: 0.04, flawless: 0.06, radiant: 0.10 },
    uncommon: { intact: 0.11, exceptional: 0.13, flawless: 0.17, radiant: 0.20 },
    common: { intact: 0.2533, exceptional: 0.2333, flawless: 0.20, radiant: 0.1667 },
};

// state.refinement guarda la etiqueta de la UI ("Rad"); las tasas van en minúscula.
export const REFINEMENT_KEYS = {
    Intact: "intact", Exceptional: "exceptional", Flawless: "flawless", Rad: "radiant",
};

// El camino de vuelta, para quien elige por la clave de las tasas y tiene que escribir en
// state.refinement. Derivado y no escrito a mano: dos mapas sueltos acaban discrepando.
export const REFINEMENT_LABELS = Object.fromEntries(
    Object.entries(REFINEMENT_KEYS).map(([label, key]) => [key, label]),
);

/** Refinamiento y escuadra que tiene puestos el jugador, ya normalizados para las tasas. */
export function getPlayerOdds() {
    return {
        refinement: REFINEMENT_KEYS[state.refinement] || "radiant",
        squadSize: Math.min(4, Math.max(1, state.squadSize || 4)),
    };
}

/**
 * La rareza tal cual la escribe la tabla de drops, reducida a la clave de DROP_RATES_BY_RARITY.
 * Devuelve null si no se reconoce, para que quien la use pueda no ordenar en vez de ordenar mal.
 */
export function normalizeRarity(rarity) {
    const r = String(rarity || "").toLowerCase();
    // "uncommon" CONTIENE "common": mirando common primero, toda pieza poco común se
    // clasificaba como común y se le aplicaban las tasas equivocadas. Es el mismo tropiezo
    // que ya está documentado en getPartRarity.
    if (r.includes("uncommon")) return "uncommon";
    if (r.includes("common")) return "common";
    if (r.includes("rare")) return "rare";
    return null;
}

/**
 * La rareza REAL de un premio dentro de una reliquia, deducida de su probabilidad intacta.
 *
 * No se usa la etiqueta `rarity` del origen porque está mal: en warframe-drop-data no existe
 * ni un solo "Common" para reliquias — los 2.316 premios que caen al 25,33 % (que es la tasa
 * de común) vienen etiquetados "Uncommon", igual que los 1.544 que caen al 11 %. Creerse la
 * etiqueta junta dos rarezas distintas en una y deja de poder comparar dos reliquias.
 *
 * La probabilidad sí es fiable y hay una por rareza: 25,33 / 11 / 2. Los cortes son los mismos
 * que ya usa getPartRarity.
 */
export function rarityFromChance(chance) {
    let c = Number(chance);
    if (!Number.isFinite(c) || c <= 0) return null;
    // Algunos orígenes la dan en tanto por uno.
    if (c <= 1.0) c *= 100;
    if (c > 17) return "common";
    if (c > 5) return "uncommon";
    return "rare";
}

/**
 * Runs medias para que caiga un premio concreto de una reliquia concreta. Manda la
 * probabilidad; la etiqueta solo se mira si no viene probabilidad (ver rarityFromChance).
 *
 * @param drop {{ chance?: number, rarity?: string }} una entrada de itemsDatabase
 */
export function runsForDrop(drop, refinement = "radiant", squadSize = 4) {
    const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
    return runsForRarity(rarity, refinement, squadSize);
}

/**
 * Runs medias para que caiga una pieza que tiene ESA rareza en UNA reliquia concreta.
 *
 * Es lo que permite comparar dos reliquias de la misma pieza, y no se puede sustituir por la
 * probabilidad de la tabla de drops: esa es la INTACTA, y al refinar el orden cambia. Una
 * pieza poco común pasa de 11 % a 20 % con radiante mientras que una común BAJA de 25,33 % a
 * 16,67 %, así que ordenar por la intacta manda a la reliquia peor a quien juega con radiantes.
 *
 * @returns {number|null} null si la rareza no se reconoce.
 */
export function runsForRarity(rarity, refinement = "radiant", squadSize = 4) {
    const key = normalizeRarity(rarity);
    const pSingle = key ? DROP_RATES_BY_RARITY[key]?.[refinement] : null;
    if (!pSingle) return null;
    // Sin acotar squadSize a propósito: con 0 jugadores la probabilidad es 0 y las runs
    // Infinity, que es lo que hay que enseñar. Quien acota es getPlayerOdds().
    const pSquad = 1 - Math.pow(1 - pSingle, squadSize);
    return pSquad > 0 ? 1 / pSquad : Infinity;
}

export function getPartRarity(partName) {
    const drops = state.itemsDatabase[partName];
    if (drops && drops.length > 0) {
        let maxChance = 0;
        let hasCommon = false;
        let hasUncommon = false;

        drops.forEach((d) => {
            if (d.rarity) {
                const r = String(d.rarity).toLowerCase();
                // "uncommon" CONTIENE "common": mirando common primero, toda pieza poco común
                // se clasificaba como común. Y como abajo se devuelve "common" en cuanto
                // hasCommon es true, se le aplicaban las tasas equivocadas (radiant 0.1667 en
                // vez de 0.20), o sea más runs estimadas de las reales.
                if (r.includes("uncommon")) hasUncommon = true;
                else if (r.includes("common")) hasCommon = true;
            }
            let c = d.chance;
            if (c !== undefined && c !== null) {
                if (c <= 1.0) c = c * 100;
                if (c > maxChance) maxChance = c;
            }
        });

        if (hasCommon || maxChance > 17) return "common";
        if (hasUncommon || maxChance > 5) return "uncommon";
        if (maxChance > 0) return "rare";
    }

    const dVal = state.itemsDatabase[partName] ? state.itemsDatabase[partName][0]?.ducats : 0;
    if (dVal === 15) return "common";
    if (dVal === 45) return "uncommon";
    if (dVal === 100) return "rare";

    return "common";
}

/**
 * Runs medias para una pieza SIN elegir reliquia: getPartRarity se queda con la rareza de la
 * reliquia donde mejor cae, así que esto es el mejor caso. Para comparar reliquias concretas
 * de esa pieza está runsForRarity.
 */
export function calculatePartExpectedRuns(partName, refinement = "radiant", squadSize = 4) {
    const runs = runsForRarity(getPartRarity(partName), refinement, squadSize);
    // Refinamiento desconocido: se cae a la tasa de una rara radiante, como hacía antes.
    return runs ?? runsForRarity("rare", "radiant", squadSize);
}

/**
 * Lo que esperas sacar de abrir UNA reliquia, en la unidad que diga `valueOf` (platino,
 * ducados…).
 *
 * En escuadra no se suma `valor × probabilidad`: se abren N reliquias y el grupo se queda con
 * UNA recompensa, la mejor. La probabilidad de cada premio es entonces la de ser el máximo de N
 * tiradas, y por eso una rara cara arrastra el total mucho más de lo que sugiere su tasa suelta.
 *
 * Había dos implementaciones de esto —la pestaña de Reliquias y la lista del inventario— y
 * daban cifras distintas para la misma reliquia: la del inventario iba siempre en solitario,
 * ignorando la escuadra que el jugador tenía puesta.
 *
 * @param drops   premios de la reliquia: [{ chance, rarity? }]
 * @param valueOf (drop) => cuánto vale ese premio. Lo que no se sepa valorar va a 0.
 */
export function relicOpenEV(drops, { refinement = "radiant", squadSize = 1, valueOf } = {}) {
    if (!Array.isArray(drops) || drops.length === 0) return 0;

    const entries = drops.map((d) => {
        const rarity = rarityFromChance(d?.chance) ?? normalizeRarity(d?.rarity);
        return {
            value: Math.max(0, Number(valueOf ? valueOf(d) : d?.value) || 0),
            // Rareza irreconocible: probabilidad 0 en vez de una inventada. El hueco que deja
            // lo recoge el residuo de abajo, así que el total no se descuadra.
            p: (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0,
        };
    }).sort((a, b) => a.value - b.value);

    // Una reliquia real trae los 6 huecos y sus tasas suman 1. Si la lista viene incompleta, lo
    // que falta es un premio sin valorar: entra como valor 0 —y por delante, que la lista va de
    // menor a mayor— en vez de quedar implícito por encima del premio más caro, que es lo que
    // hacía el cálculo anterior y le restaba valor a la reliquia.
    const listed = entries.reduce((sum, e) => sum + e.p, 0);
    if (listed < 1) entries.unshift({ value: 0, p: 1 - listed });

    let ev = 0;
    let acc = 0;
    for (const e of entries) {
        const next = acc + e.p;
        ev += e.value * (Math.pow(next, squadSize) - Math.pow(acc, squadSize));
        acc = next;
    }
    return ev;
}
