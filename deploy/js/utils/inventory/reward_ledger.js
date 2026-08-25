export const CONSENSUS_FRAMES = 2;

export const INITIAL_LEDGER = Object.freeze({
    pending: null,
    pendingCount: 0,
    committed: null,
});

export function readingSignature(items) {
    if (!items || items.length === 0) return "0";
    return items
        .map((i) => `${i.name}x${i.qty || 1}`)
        .sort()
        .join("|");
}

export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const sig = readingSignature(items);

    if (sig === "0") return { ledger: { ...s, pending: null, pendingCount: 0 }, commit: null };

    if (sig === s.committed) return { ledger: s, commit: null };

    const pendingCount = s.pending === sig ? s.pendingCount + 1 : 1;
    if (pendingCount >= CONSENSUS_FRAMES) {
        return {
            ledger: { pending: null, pendingCount: 0, committed: sig },
            commit: items,
        };
    }
    return { ledger: { ...s, pending: sig, pendingCount }, commit: null };
}
