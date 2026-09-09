import { relicKey } from "./relic_counts.js";

export const VOTES_TO_APPLY = 2;

export function voteReadings(estado, lectura, votosMin = VOTES_TO_APPLY) {
    const changed = [];
    for (const { name, count } of lectura) {
        let byCount = estado.votes.get(name);
        if (!byCount) { byCount = new Map(); estado.votes.set(name, byCount); }
        const n = (byCount.get(count) || 0) + 1;
        byCount.set(count, n);
        if (n < votosMin || estado.applied.get(name) === count) continue;
        estado.applied.set(name, count);
        changed.push({ name, count });
    }
    return changed;
}

export function applyRelicCounts(inventory, changed) {
    let lista = Array.isArray(inventory) ? inventory : [];
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
    return lista.filter((i) => i?.name && (Number(i.count) || 0) > 0);
}

export function sumaReliquias(inventory, recibidas) {
    const lista = applyRelicCounts(inventory, []);
    const total = new Map(lista.map((i) => [relicKey(i.name), { name: i.name, count: Number(i.count) || 0 }]));
    for (const { name, qty } of recibidas || []) {
        const n = Math.floor(Number(qty) || 1);
        if (!name || n <= 0) continue;
        const previa = total.get(relicKey(name));
        if (previa) previa.count += n;
        else total.set(relicKey(name), { name, count: n });
    }
    return applyRelicCounts(lista, [...total.values()]);
}

// the carried relic is consumed when the fissure ends, not when picked
export function restaReliquia(inventory, name, n = 1) {
    const lista = applyRelicCounts(inventory, []);
    const actual = lista.find((i) => relicKey(i.name) === relicKey(name));
    if (!actual) return lista;
    return applyRelicCounts(lista, [{ name: actual.name, count: (Number(actual.count) || 0) - n }]);
}
