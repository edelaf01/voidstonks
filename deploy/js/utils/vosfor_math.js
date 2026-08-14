// calculates probabilities for arcane pack rolls and rank 5 chances in Vosfor trading

export function binomialGe(n, kNeeded, p) {
    if (n < kNeeded) return 0;
    let sumBelow = 0;
    let term = Math.pow(1 - p, n);
    sumBelow += term;
    for (let i = 1; i < kNeeded; i++) {
        // floor on divisor because with p = 1 a single arcane pack would divide by zero
        term = term * ((n - i + 1) / i) * (p / Math.max(1e-9, 1 - p));
        sumBelow += term;
    }
    const prob = Math.max(0, 1 - sumBelow);
    return Math.min(1, prob);
}

export function formatProbPct(p) {
    if (p >= 1) return "100.0";
    if (p <= 0) return "0.0";
    const pct = p * 100;
    if (pct >= 99.95) return ">99.9";
    if (pct <= 0.05) return "<0.1";
    return pct.toFixed(1);
}

export function targetSimProbabilities(packsNeeded, rollProb, sameRarityCount, copiesWanted) {
    const singleProb = rollProb / Math.max(1, sameRarityCount);
    const totalRolls = packsNeeded * 3;

    return {
        pAtLeastOnePct: formatProbPct(1 - Math.pow(1 - singleProb, totalRolls)),
        pTargetPct: formatProbPct(binomialGe(totalRolls, copiesWanted, singleProb)),
    };
}

export function calculateR5Realism(vosforAmount, pack, data) {
    if (!vosforAmount || vosforAmount < 200 || !pack || !data) return null;
    const pulls = Math.floor(vosforAmount / (pack.cost?.vosfor || 200));
    const totalRolls = pulls * 3;

    const rollsMap = pack.rolls && pack.rolls[0] ? pack.rolls[0] : { LEGENDARY: 0.05, RARE: 0.15, UNCOMMON: 0.30, COMMON: 0.50 };

    const results = {};
    for (const rarity of ["LEGENDARY", "RARE", "UNCOMMON", "COMMON"]) {
        const sameRarityItems = pack.items.filter((s) => data.arcanes[s]?.rarity === rarity);
        if (sameRarityItems.length === 0) {
            results[rarity] = { expected: "0.0", probPct: "0.0", probRaw: 0, itemCount: 0 };
            continue;
        }

        const count = sameRarityItems.length;
        const rarityRollProb = (rollsMap[rarity] !== undefined && rollsMap[rarity] !== null) ? rollsMap[rarity] : 0.05;
        const singleProb = rarityRollProb / count;
        const probR5 = binomialGe(totalRolls, 21, singleProb);

        results[rarity] = {
            expected: (totalRolls * singleProb).toFixed(1),
            probPct: formatProbPct(probR5),
            probRaw: probR5,
            itemCount: count,
        };
    }

    return { pulls, totalRolls, results };
}
