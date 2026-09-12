/**
 * Probabilidades de la calculadora de Vosfor: cuántas tiradas hacen falta para juntar N copias
 * de un arcano, y qué posibilidades reales hay de llegar a rango 5.
 *
 * Vivía dentro de ui_vosfor.js, donde no había forma de comprobarlo: las tres funciones son
 * matemática pura, pero estaban entre 2600 líneas de render. Y es el único número de esa
 * pestaña que el usuario no puede verificar a ojo — un "72,3 %" mal calculado se lee igual de
 * creíble que el bueno, y a partir de ahí decide si gasta 12.000 de Vosfor.
 */

/**
 * Probabilidad de sacar AL MENOS `kNeeded` éxitos en `n` intentos con probabilidad `p`.
 *
 * Se calcula por el complementario (1 menos la cola de abajo) y término a término con la
 * recurrencia del binomio. Calcular cada combinatoria por separado desborda: con las ~3000
 * tiradas que salen de un objetivo normal, C(3000, 21) no cabe en un double.
 */
export function binomialGe(n, kNeeded, p) {
    if (n < kNeeded) return 0;
    let sumBelow = 0;
    let term = Math.pow(1 - p, n);
    sumBelow += term;
    for (let i = 1; i < kNeeded; i++) {
        // Máximo 1e-9 en el divisor: con p = 1 la recurrencia dividiría por cero, y ese caso
        // (probabilidad 1) llega de un pack de un solo arcano.
        term = term * ((n - i + 1) / i) * (p / Math.max(1e-9, 1 - p));
        sumBelow += term;
    }
    const prob = Math.max(0, 1 - sumBelow);
    return Math.min(1, prob);
}

/** Porcentaje legible. Los extremos se marcan como ">99.9" y "<0.1" en vez de redondear a
 *  100 o a 0: prometer una certeza que no existe es peor que decir "casi seguro". */
export function formatProbPct(p) {
    if (p >= 1) return "100.0";
    if (p <= 0) return "0.0";
    const pct = p * 100;
    if (pct >= 99.95) return ">99.9";
    if (pct <= 0.05) return "<0.1";
    return pct.toFixed(1);
}

/**
 * Probabilidad de sacar el arcano objetivo con los packs que se van a abrir.
 * @returns {{pAtLeastOnePct: string, pTargetPct: string}} ya formateadas para pintar
 */
export function targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, copiesWanted) {
    // La probabilidad del pack es de la RAREZA: se reparte entre los arcanos que la comparten.
    const singleProb = rollProb / Math.max(1, sameRarityCount);
    const totalRolls = packsNeeded * 3;

    return {
        pAtLeastOnePct: formatProbPct(1 - Math.pow(1 - singleProb, totalRolls)),
        pTargetPct: formatProbPct(binomialGe(totalRolls, copiesWanted, singleProb)),
    };
}

/** Rango máximo de un arcano acotado a [1, 5]; 5 si el catálogo no lo dice. */
export function maxRankOf(meta) {
    return Math.max(1, Math.min(meta?.maxRank ?? 5, 5));
}

/**
 * Copias necesarias para el rango máximo de un arcano (números triangulares):
 * fusionLimit 5 -> 21 copias, fusionLimit 3 -> 10 copias.
 */
export function copiesForMaxRank(meta) {
    const mr = maxRankOf(meta);
    return ((mr + 1) * (mr + 2)) / 2;
}

/**
 * Qué esperar de gastar `vosforAmount` en un pack: copias medias por rareza y probabilidad de
 * llegar al rango máximo.
 *
 * Por rango dentro de cada rareza, no una sola cifra: Cetus, Fortuna y Necralisk mezclan en
 * la misma rareza arcanos de 21 copias con Exodia/Virtuos/Pax/Residual, que se rankean con
 * 10. Con el 21 fijo la tarjeta simulaba el doble de copias y avisaba "R5 inviable" para
 * arcanos cuyo rango máximo sí era alcanzable. Los campos `probPct`/`probRaw`/`copies` de la
 * rareza son los del rango más alto presente, que es el que decide el aviso de "inviable".
 *
 * Por debajo de 200 devuelve null: es el coste de un pack, así que no hay ni una tirada que
 * simular y enseñar ceros haría creer que el cálculo dice algo.
 * @returns {{pulls: number, totalRolls: number, results: object}|null}
 */
export function calculateR5Realism(vosforAmount, pack, data) {
    if (!vosforAmount || vosforAmount < 200 || !pack || !data) return null;
    const pulls = Math.floor(vosforAmount / (pack.cost?.vosfor || 200));
    const totalRolls = pulls * 3;

    const rollsMap = pack.rolls && pack.rolls[0] ? pack.rolls[0] : { LEGENDARY: 0.05, RARE: 0.15, UNCOMMON: 0.30, COMMON: 0.50 };

    const results = {};
    for (const rarity of ["LEGENDARY", "RARE", "UNCOMMON", "COMMON"]) {
        const sameRarityItems = pack.items.filter((s) => data.arcanes[s]?.rarity === rarity);
        if (sameRarityItems.length === 0) {
            results[rarity] = { expected: "0.0", probPct: "0.0", probRaw: 0, itemCount: 0, copies: 0, ranks: [] };
            continue;
        }

        const count = sameRarityItems.length;
        const rarityRollProb = (rollsMap[rarity] !== undefined && rollsMap[rarity] !== null) ? rollsMap[rarity] : 0.05;
        const singleProb = rarityRollProb / count;

        const itemsByRank = new Map();
        for (const slug of sameRarityItems) {
            const mr = maxRankOf(data.arcanes[slug]);
            itemsByRank.set(mr, (itemsByRank.get(mr) || 0) + 1);
        }
        const ranks = [...itemsByRank]
            .sort((a, b) => b[0] - a[0])
            .map(([maxRank, itemCount]) => {
                const copies = copiesForMaxRank({ maxRank });
                const prob = binomialGe(totalRolls, copies, singleProb);
                return { maxRank, copies, itemCount, probPct: formatProbPct(prob), probRaw: prob };
            });

        results[rarity] = {
            expected: (totalRolls * singleProb).toFixed(1),
            probPct: ranks[0].probPct,
            probRaw: ranks[0].probRaw,
            copies: ranks[0].copies,
            itemCount: count,
            ranks,
        };
    }

    return { pulls, totalRolls, results };
}
