// accumulates item evidence across scanner frames with exponential decay

// decay 0.75, threshold 1.5: two frames in a row confirm, one noisy between two good ones too
export const DEFAULT_DECAY = 0.75;
export const DEFAULT_THRESHOLD = 1.5;
export const DEFAULT_WEIGHT = 1.0;

export const INITIAL_CONSENSUS = Object.freeze({
    items: Object.freeze({}),
});

export function getWinningQty(qtyVotes, fallbackQty = 1) {
    if (!qtyVotes || typeof qtyVotes !== "object") return fallbackQty;
    let maxVotes = -1;
    let winner = fallbackQty;
    for (const [qtyStr, count] of Object.entries(qtyVotes)) {
        const qty = Number(qtyStr);
        const votes = Number(count) || 0;
        if (votes > maxVotes || (votes === maxVotes && qty === fallbackQty)) {
            maxVotes = votes;
            winner = qty;
        }
    }
    return winner;
}

export function getItemConsensus(state, name) {
    if (!state?.items || !name) return null;
    return state.items[name] || null;
}

export function nextConsensus(prev, items, options = {}) {
    const decay = Number.isFinite(options?.decay) ? options.decay : DEFAULT_DECAY;
    const threshold = Number.isFinite(options?.threshold) ? options.threshold : DEFAULT_THRESHOLD;
    const defaultWeight = Number.isFinite(options?.weight) ? options.weight : DEFAULT_WEIGHT;

    const prevState = prev || INITIAL_CONSENSUS;
    const prevItems = prevState.items || {};

    const nextItems = {};
    const confirmed = [];

    for (const [name, entry] of Object.entries(prevItems)) {
        nextItems[name] = {
            score: (entry.score || 0) * decay,
            qtyVotes: { ...(entry.qtyVotes || {}) },
            qty: entry.qty ?? 1,
            confirmed: Boolean(entry.confirmed),
        };
    }

    for (const item of items || []) {
        const name = item?.name;
        if (!name || typeof name !== "string") continue;

        const rawQty = item.qty ?? 1;
        const parsedQty = Math.floor(Number(rawQty));
        const qty = parsedQty > 0 ? parsedQty : 1;
        const weight = Number.isFinite(item.weight) ? item.weight : defaultWeight;

        let entry = nextItems[name];
        if (!entry) {
            entry = {
                score: 0,
                qtyVotes: {},
                qty,
                confirmed: false,
            };
            nextItems[name] = entry;
        }

        entry.score += weight;
        entry.qtyVotes[qty] = (entry.qtyVotes[qty] || 0) + 1;
        entry.qty = getWinningQty(entry.qtyVotes, qty);
    }

    for (const [name, entry] of Object.entries(nextItems)) {
        if (!entry.confirmed && entry.score >= threshold) {
            entry.confirmed = true;
            confirmed.push({
                name,
                qty: entry.qty,
            });
        }
    }

    const state = { items: nextItems };
    return {
        state,
        consensus: state,
        confirmed,
        commit: confirmed.length > 0 ? confirmed : null,
    };
}
