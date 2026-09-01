import {
    nextConsensus,
    INITIAL_CONSENSUS,
} from "./reward_consensus.js";

/** Lecturas idénticas seguidas de referencia. */
export const CONSENSUS_FRAMES = 2;

export const INITIAL_LEDGER = Object.freeze({
    consensus: INITIAL_CONSENSUS,
    committed: null,
});

/**
 * Firma de una lectura: nombres y cantidades, en orden.
 */
export function readingSignature(items) {
    if (!items || items.length === 0) return "0";
    return items
        .map((i) => `${i.name}x${i.qty || 1}`)
        .sort()
        .join("|");
}

/**
 * Avanza el estado del ledger acumulando consenso por ítem.
 *
 * @param prev    estado anterior: { consensus, committed }
 * @param items   piezas leídas en ESTE frame ([{name, qty}])
 * @returns {{ledger: object, commit: Array|null}}
 */
export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const prevConsensus = s.consensus || INITIAL_CONSENSUS;

    // Una pantalla ya escrita no se vuelve a escribir aunque el consenso la haya olvidado: si
    // entre medias hay bastantes frames sin lectura (el ratón tapando el panel), la puntuación
    // decae hasta que se poda, y al reaparecer la MISMA recompensa entraba dos veces.
    if (s.committed && readingSignature(items) === s.committed) return { ledger: s, commit: null };

    const { state: nextConsState, confirmed } = nextConsensus(prevConsensus, items);

    const hasNewCommit = confirmed.length > 0;
    const commit = hasNewCommit ? confirmed : null;

    let committed = s.committed;
    let nextItems = nextConsState.items;

    if (hasNewCommit) {
        committed = readingSignature(items);

        // Al confirmar una pantalla nueva, se descartan del consenso los confirmados
        // de pantallas anteriores que ya no están presentes en este frame.
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
