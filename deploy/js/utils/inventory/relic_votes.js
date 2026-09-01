import { relicKey } from "./relic_counts.js";

/**
 * Consenso y escritura de las cantidades leídas en VOID RELICS/REFINEMENT. Aparte del servicio
 * porque escribe en el inventario sin red: una lectura mala pisa un número real.
 */

/** Lecturas idénticas seguidas que hacen falta antes de escribir. */
export const VOTES_TO_APPLY = 2;

/** `estado` se arrastra entre frames; devuelve solo lo que ya tiene consenso. */
export function voteReadings(estado, lectura, votosMin = VOTES_TO_APPLY) {
    const changed = [];
    for (const { name, count } of lectura) {
        let byCount = estado.votes.get(name);
        if (!byCount) { byCount = new Map(); estado.votes.set(name, byCount); }
        const n = (byCount.get(count) || 0) + 1;
        byCount.set(count, n);
        // Ya aplicado con ESE número: no se reescribe (evita repintar y re-guardar en bucle).
        if (n < votosMin || estado.applied.get(name) === count) continue;
        estado.applied.set(name, count);
        changed.push({ name, count });
    }
    return changed;
}

/**
 * Entrada a entrada y no reconstruyendo: en la rejilla solo se ven las reliquias que caben en
 * pantalla, así que rehacer el array desde lo escaneado borraría todo lo demás.
 */
export function applyRelicCounts(inventory, changed) {
    let lista = Array.isArray(inventory) ? inventory : [];
    // El formato viejo (strings repetidos) no se puede actualizar en sitio: se convierte,
    // que es lo mismo que hace state.js en cuanto se pulsa un +/-.
    if (lista.some((i) => typeof i === "string")) {
        const counts = new Map();
        for (const i of lista) {
            const name = typeof i === "string" ? i : i?.name;
            if (!name) continue;
            const suma = typeof i === "string" ? 1 : Number(i.count) || 1;
            const prev = counts.get(relicKey(name));
            if (prev) prev.count += suma;
            else counts.set(relicKey(name), { name, count: suma });
        }
        lista = [...counts.values()];
    }

    const byKey = new Map(lista.map((i) => [relicKey(i?.name), i]));
    for (const { name, count } of changed) {
        const existing = byKey.get(relicKey(name));
        if (existing) existing.count = count;
        else if (count > 0) {
            const entry = { name, count };
            lista.push(entry);
            byKey.set(relicKey(name), entry);
        }
    }
    // Una entrada sin nombre (save viejo, lectura a medias) sale en el panel como una fila
    // vacía que el usuario no puede ni borrar.
    return lista.filter((i) => i?.name && (Number(i.count) || 0) > 0);
}
