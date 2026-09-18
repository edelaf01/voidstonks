import {
    nextConsensus,
    INITIAL_CONSENSUS,
} from "./reward_consensus.js";

/** Reference count of identical readings in a row. */
export const CONSENSUS_FRAMES = 2;

/**
 * `committed` = names already added ON THIS SCREEN. Reset by whoever leaves it (the scanner, when it
 * drops MISSION_COMPLETE): the same part counts again next mission.
 */
export const INITIAL_LEDGER = Object.freeze({
    consensus: INITIAL_CONSENSUS,
    committed: null,
});

/**
 * @param prev    previous state: { consensus, committed }
 * @param items   parts read in THIS frame ([{name, qty}])
 * @returns {{ledger: object, commit: Array|null}}
 */
export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const prevConsensus = s.consensus || INITIAL_CONSENSUS;
    const committed = s.committed || {};

    // already committed does not return to consensus: with more than four rows the panel scrolls and cells
    // leave and come back, seeing them again is not receiving them again
    const nuevos = (items || []).filter((i) => i?.name && !committed[i.name]);
    const { state: nextConsState, confirmed } = nextConsensus(prevConsensus, nuevos);
    const commit = confirmed.length > 0 ? confirmed : null;

    let nextCommitted = s.committed;
    if (commit) {
        nextCommitted = { ...committed };
        for (const c of confirmed) nextCommitted[c.name] = true;
    }

    // a confirmed item lives in `committed`; a candidate no longer seen is forgotten when its score fades
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
