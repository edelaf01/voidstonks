/**
 * Probabilities of the Vosfor calculator: how many rolls it takes to gather N copies of an arcane, and the
 * real chances of reaching rank 5. Pure math so it can be tested: it is the only number in that tab the user
 * cannot check by eye, and a wrong "72.3 %" reads as believable as the right one.
 */

/**
 * Probability of AT LEAST `kNeeded` successes in `n` tries with probability `p`. Computed by the complement
 * (1 minus the lower tail), term by term with the binomial recurrence: computing each combination apart
 * overflows, C(3000, 21) does not fit in a double.
 */
export function binomialGe(n, kNeeded, p) {
    if (n < kNeeded) return 0;
    let sumBelow = 0;
    let term = Math.pow(1 - p, n);
    sumBelow += term;
    for (let i = 1; i < kNeeded; i++) {
        // 1e-9 floor on the divisor: with p = 1 the recurrence would divide by zero, and a single arcane pack gives
        // exactly that
        term = term * ((n - i + 1) / i) * (p / Math.max(1e-9, 1 - p));
        sumBelow += term;
    }
    const prob = Math.max(0, 1 - sumBelow);
    return Math.min(1, prob);
}

/**
 * Readable percentage. The extremes show as ">99.9" and "<0.1" instead of rounding to 100 or 0: promising a
 * certainty that does not exist is worse than "almost sure".
 */
export function formatProbPct(p) {
    if (p >= 1) return "100.0";
    if (p <= 0) return "0.0";
    const pct = p * 100;
    if (pct >= 99.95) return ">99.9";
    if (pct <= 0.05) return "<0.1";
    return pct.toFixed(1);
}

/**
 * Probability of getting the target arcane with the packs that will be opened.
 * @returns {{pAtLeastOnePct: string, pTargetPct: string}} already formatted for display
 */
export function targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, copiesWanted) {
    // the pack probability is per RARITY: it is shared among the arcanes of that rarity
    const singleProb = rollProb / Math.max(1, sameRarityCount);
    const totalRolls = packsNeeded * 3;

    return {
        pAtLeastOnePct: formatProbPct(1 - Math.pow(1 - singleProb, totalRolls)),
        pTargetPct: formatProbPct(binomialGe(totalRolls, copiesWanted, singleProb)),
    };
}

/** Max rank of an arcane clamped to [1, 5]; 5 when the catalog does not say. */
export function maxRankOf(meta) {
    return Math.max(1, Math.min(meta?.maxRank ?? 5, 5));
}

/**
 * Copies needed for an arcane's max rank (triangular numbers): fusionLimit 5 -> 21 copies, fusionLimit 3 -> 10
 * copies.
 */
export function copiesForMaxRank(meta) {
    const mr = maxRankOf(meta);
    return ((mr + 1) * (mr + 2)) / 2;
}

/**
 * What to expect from spending `vosforAmount` on a pack: mean copies per rarity and probability of reaching max
 * rank. Per rank inside each rarity, not one figure: Cetus, Fortuna and Necralisk mix 21 copy arcanes in the
 * same rarity with Exodia/Virtuos/Pax/Residual, which rank up with 10. The rarity `probPct`/`probRaw`/`copies`
 * fields are those of the highest rank present, which decides the "not viable" warning.
 *
 * Under 200 it returns null: that is the cost of one pack, so there is not a single roll to simulate.
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
