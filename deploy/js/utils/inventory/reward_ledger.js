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

export const MEMORIA_PANTALLA_MS = 60 * 60 * 1000;

/** Labels in cell order: what identifies the screen. */
export function huellaPantalla(items) {
    return (items || []).filter((i) => i?.name).map((i) => `${i.name}×${Math.max(1, i.qty || 1)}`);
}

export function esPantallaRecordada(items, memoria, ahora = Date.now()) {
    if (!memoria?.huella?.length || !(ahora - (memoria.t || 0) < MEMORIA_PANTALLA_MS)) return false;
    const actual = huellaPantalla(items);
    if (actual.length === 0 || actual.length < memoria.huella.length - 1) return false;
    let j = 0;
    for (const h of actual) {
        while (j < memoria.huella.length && memoria.huella[j] !== h) j++;
        if (j >= memoria.huella.length) return false;
        j++;
    }
    return true;
}

export function recuerdaPantalla(items, ledger, ahora = Date.now()) {
    return { huella: huellaPantalla(items), committed: { ...(ledger?.committed || {}) }, t: ahora };
}

/**
 * Where that memory lives across reloads. `storage` is a function so Node has no `localStorage` on
 * import; on failure (private mode) it stays in the session.
 */
export function memoriaPantalla(storage, clave) {
    let cache;
    return {
        lee() {
            if (cache === undefined) { try { cache = JSON.parse(storage().getItem(clave) || "null"); } catch { cache = null; } }
            return cache;
        },
        guarda(valor) {
            cache = valor;
            try { storage().setItem(clave, JSON.stringify(valor)); } catch { /* no persistence: valid for this session */ }
        },
    };
}
