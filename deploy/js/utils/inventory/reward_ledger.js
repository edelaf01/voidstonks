/**
 * Cuándo se da por buena una lectura de MISSION COMPLETE y se escribe en el inventario.
 *
 * La pantalla dura ~15 s y el escáner la ve muchas veces, así que sin memoria una misma
 * recompensa entraría una vez por frame. Y como el alta es automática, una lectura de un
 * frame malo no puede escribir: se exige verla DOS veces seguidas idéntica.
 *
 * Puro: entra el estado y sale el estado siguiente, para poder probarlo sin navegador.
 */

/** Lecturas idénticas seguidas que hacen falta para escribir en el inventario. */
export const CONSENSUS_FRAMES = 2;

export const INITIAL_LEDGER = Object.freeze({
    pending: null,
    pendingCount: 0,
    committed: null,
});

/**
 * Firma de una lectura: nombres y cantidades, en orden.
 *
 * Ordenada a propósito: el orden en que salgan las celdas no debe cambiar la firma, o dos
 * lecturas iguales no se reconocerían entre sí y el consenso no llegaría nunca.
 */
export function readingSignature(items) {
    if (!items || items.length === 0) return "0";
    return items
        .map((i) => `${i.name}x${i.qty || 1}`)
        .sort()
        .join("|");
}

/**
 * @param prev    estado anterior: { pending, pendingCount, committed }
 * @param items   piezas leídas en ESTE frame ([{name, qty}])
 * @returns {{ledger: object, commit: Array|null}}  `commit` trae las piezas a dar de alta,
 *          o null si aún no toca (poco consenso, o esta pantalla ya se escribió).
 */
export function nextLedger(prev, items) {
    const s = { ...INITIAL_LEDGER, ...prev };
    const sig = readingSignature(items);

    // Sin piezas no hay nada que confirmar, pero tampoco se borra lo ya escrito: el usuario
    // puede pasar el ratón por encima y tapar la única pieza durante un par de frames.
    if (sig === "0") return { ledger: { ...s, pending: null, pendingCount: 0 }, commit: null };

    // Esta misma pantalla ya se dio de alta. Volver a verla no suma: es el caso de todos los
    // frames que quedan hasta que el usuario pulse continuar.
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
