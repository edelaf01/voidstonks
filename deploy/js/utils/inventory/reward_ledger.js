import {
    nextConsensus,
    INITIAL_CONSENSUS,
} from "./reward_consensus.js";

/** Reference count of identical readings in a row. */
export const CONSENSUS_FRAMES = 2;

export const INITIAL_LEDGER = Object.freeze({
    consensus: INITIAL_CONSENSUS,
    committed: null,
});

export function readingSignature(items) {
    if (!items || items.length === 0) return "0";
    return items
        .map((i) => `${i.name}x${i.qty || 1}`)
        .sort()
        .join("|");
}

/**
 * @param prev    previous state: { consensus, committed }
 * @param items   parts read in THIS frame ([{name, qty}])
 * @returns {{ledger: object, commit: Array|null}}
 */
export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const prevConsensus = s.consensus || INITIAL_CONSENSUS;

    if (s.committed && readingSignature(items) === s.committed) return { ledger: s, commit: null };

    const { state: nextConsState, confirmed } = nextConsensus(prevConsensus, items);

    const hasNewCommit = confirmed.length > 0;
    const commit = hasNewCommit ? confirmed : null;

    let committed = s.committed;
    let nextItems = nextConsState.items;

    if (hasNewCommit) {
        committed = readingSignature(items);

        const currentItemNames = new Set((items || []).map((it) => it?.name).filter(Boolean));
        const pruned = {};
        for (const [name, entry] of Object.entries(nextItems)) {
            if (entry.confirmed && !currentItemNames.has(name)) {
                continue;
            }
            pruned[name] = entry;
        }
        nextItems = pruned;
    } else {
        let pruned = null;
        for (const [name, entry] of Object.entries(nextItems)) {
            if (entry.score < 0.05) {
                if (!pruned) pruned = { ...nextItems };
                delete pruned[name];
            }
        }
        if (pruned) nextItems = pruned;
    }

    return {
        ledger: {
            consensus: { items: nextItems },
            committed,
        },
        commit,
    };
}
