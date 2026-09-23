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

export const MEMORIA_PANTALLA_MS = 60 * 60 * 1000;

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

export function memoriaPantalla(storage, clave) {
    let cache;
    return {
        lee() {
            if (cache === undefined) { try { cache = JSON.parse(storage().getItem(clave) || "null"); } catch { cache = null; } }
            return cache;
        },
        guarda(valor) {
            cache = valor;
            try { storage().setItem(clave, JSON.stringify(valor)); } catch {}
        },
    };
}
