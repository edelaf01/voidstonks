import {
    nextConsensus,
    INITIAL_CONSENSUS,
} from "./reward_consensus.js";

/** Lecturas idénticas seguidas de referencia. */
export const CONSENSUS_FRAMES = 2;

/**
 * `committed` son los nombres ya dados de alta EN ESTA PANTALLA. Lo reinicia quien la abandona
 * (el escáner, al soltar el contexto MISSION_COMPLETE): dentro de la misma pantalla nada se
 * apunta dos veces; en la misión siguiente, la misma pieza vuelve a contar.
 */
export const INITIAL_LEDGER = Object.freeze({
    consensus: INITIAL_CONSENSUS,
    committed: null,
});

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
    const committed = s.committed || {};

    // Lo ya apuntado no vuelve al consenso. Con más de cuatro filas (Plague Star, varios
    // contratos seguidos) el panel se desplaza y las casillas salen y vuelven a entrar: verlas
    // otra vez no es recibirlas otra vez. Antes bastaba con que el ratón tapara el panel unos
    // frames para que la MISMA recompensa entrara dos veces.
    const nuevos = (items || []).filter((i) => i?.name && !committed[i.name]);
    const { state: nextConsState, confirmed } = nextConsensus(prevConsensus, nuevos);
    const commit = confirmed.length > 0 ? confirmed : null;

    let nextCommitted = s.committed;
    if (commit) {
        nextCommitted = { ...committed };
        for (const c of confirmed) nextCommitted[c.name] = true;
    }

    // Un confirmado ya vive en `committed`; un candidato que dejó de verse se olvida cuando su
    // puntuación se apaga, para que una lectura suelta no acumule para siempre.
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
