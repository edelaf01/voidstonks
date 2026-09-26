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

// Desde la última vez que se vio: más que un tooltip o una recarga, menos que una misión. Con una
// hora desde el alta, la misma reliquia en dos misiones seguidas no sumaba la segunda vez.
export const MEMORIA_PANTALLA_MS = 90 * 1000;

/** Los rótulos en orden de casilla: es lo que identifica la pantalla. */
export function huellaPantalla(items) {
    return (items || []).filter((i) => i?.name).map((i) => `${i.name}×${Math.max(1, i.qty || 1)}`);
}

/**
 * Si la pantalla que se ve es la ÚLTIMA que ya se dio de alta. Al perder el contexto (tooltip,
 * pausa, recarga de la página) el ledger se reiniciaba y la misma pantalla volvía a sumar. Se
 * admite que a la lectura actual le falte UNA casilla (el OCR no siempre lee todas), pero no
 * menos: una misión nueva con una sola pieza coincidente tiene que contar.
 */
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

/** Lo que se guarda tras un alta: la huella de la pantalla, lo que ya se apuntó de ella y cuándo se vio. */
export function recuerdaPantalla(items, ledger, ahora = Date.now()) {
    return { huella: huellaPantalla(items), committed: { ...(ledger?.committed || {}) }, t: ahora };
}

/** La memoria con la hora al día mientras la pantalla sigue a la vista, o null si no hace falta escribir. */
export function sigueALaVista(memoria, ahora = Date.now()) {
    return memoria?.huella?.length && ahora - (memoria.t || 0) >= 5000 ? { ...memoria, t: ahora } : null;
}

/**
 * Dónde vive esa memoria entre recargas. `storage` es una función para que en Node no exista
 * `localStorage` al importar; si falla (modo privado) se queda en la sesión.
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
            try { storage().setItem(clave, JSON.stringify(valor)); } catch { /* sin persistencia: vale para esta sesión */ }
        },
    };
}
