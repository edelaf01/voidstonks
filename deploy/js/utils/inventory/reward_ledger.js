import {
    nextConsensus,
    INITIAL_CONSENSUS,
} from "./reward_consensus.js";

export const CONSENSUS_FRAMES = 2;

export const INITIAL_LEDGER = Object.freeze({
    consensus: INITIAL_CONSENSUS,
    committed: null,
});

export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const prevConsensus = s.consensus || INITIAL_CONSENSUS;
    const committed = s.committed || {};

    // already committed items do not return to consensus: scrolling brings cells back in view
    const nuevos = (items || []).filter((i) => i?.name && !committed[i.name]);
    const { state: nextConsState, confirmed } = nextConsensus(prevConsensus, nuevos);
    const commit = confirmed.length > 0 ? confirmed : null;

    let nextCommitted = s.committed;
    if (commit) {
        nextCommitted = { ...committed };
        for (const c of confirmed) nextCommitted[c.name] = true;
    }

    const nextItems = {};
    for (const [name, entry] of Object.entries(nextConsState.items)) {
        if (entry.confirmed || entry.score < 0.05) continue;
        nextItems[name] = entry;
    }

    return {
        ledger: {
            consensus: { items: nextItems },
            committed: nextCommitted,
        },
        commit,
    };
}
