/**
 * Acumulación de evidencia por ítem a lo largo de frames de escáner.
 *
 * Reemplaza la comprobación todo-o-nada de pantalla idéntica por una puntuación
 * ponderada con decaimiento exponencial por ítem, tolerando frames ruidosos aislados
 * sin perder los ítems leídos correctamente.
 *
 * Puro: no interactúa con el DOM ni muta el estado previo.
 */

// Con decaimiento 0.75 y umbral 1.5, dos frames consecutivos suman 1.75 (confirman)
// y un frame ruidoso entre dos buenos suma 1.5625 (también confirma), mientras
// que 1 frame cada 5 frames tiene techo asintótico en ~1.311 (nunca confirma).
export const DEFAULT_DECAY = 0.75;
export const DEFAULT_THRESHOLD = 1.5;
export const DEFAULT_WEIGHT = 1.0;

export const INITIAL_CONSENSUS = Object.freeze({
    items: Object.freeze({}),
});

/**
 * Determina la cantidad más votada en el mapa de votos.
 * Ante empate, prioriza la cantidad del último frame o la primera encontrada.
 */
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

/**
 * Consulta el estado acumulado de un ítem concreto.
 */
export function getItemConsensus(state, name) {
    if (!state?.items || !name) return null;
    return state.items[name] || null;
}

/**
 * Avanza el estado de consenso con las lecturas del frame actual.
 *
 * @param {object} prev Estado previo ({ items: { [name]: { score, qty, qtyVotes, confirmed } } })
 * @param {Array<{name: string, qty?: number, weight?: number}>} items Lecturas del frame actual
 * @param {object} [options] Configuración opcional ({ decay, threshold, weight })
 * @returns {{ state: object, consensus: object, confirmed: Array<{name: string, qty: number}>, commit: Array<{name: string, qty: number}>|null }}
 */
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
