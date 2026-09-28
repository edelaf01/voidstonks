/**
 * Suggested sale price from real sales in the last 48 h (`reciente` from the worker, per rank): the
 * median, pulled toward the last sale when it is within 12 h. With no recent sales, the median of the last
 * closed day, only for unranked items: in a mod it mixes R0 with max rank.
 */
export const HORAS_ULTIMA_VENTA = 12;

export function precioSugerido(mercado, rango = null, ahora = Date.now()) {
    const r = mercado?.reciente?.[rango ?? ""];
    if (r?.mediana > 0) {
        const horas = (ahora - Date.parse(r.hora)) / 3600000;
        const conUltima = r.ultima > 0 && horas <= HORAS_ULTIMA_VENTA;
        const precio = Math.max(1, Math.round(conUltima ? (r.mediana + r.ultima) / 2 : r.mediana));
        return { precio, base: "reciente", mediana: r.mediana, ultima: r.ultima, horas, ventas: r.volumen };
    }
    if (rango == null && mercado?.median > 0) {
        return { precio: Math.max(1, Math.round(mercado.median)), base: "dia", mediana: mercado.median, ventas: mercado.volume ?? null };
    }
    return null;
}

/** Stale when off by more than 10% and 2p: between 10 and 11 another request is not worth it. */
export function desfase(tuPrecio, sugerido) {
    const dif = tuPrecio - sugerido;
    return { dif, pct: Math.round((dif / sugerido) * 100), desfasada: Math.abs(dif) >= 2 && Math.abs(dif) >= sugerido * 0.1 };
}

export function revisaPrecios(ordenes, mercados, ahora = Date.now()) {
    const desfasadas = [];
    let alDia = 0, sinDatos = 0;
    for (const orden of ordenes) {
        if ((orden.type || "").toLowerCase() !== "sell") continue;
        const s = precioSugerido(mercados[orden.itemSlug], Number.isInteger(orden.rank) ? orden.rank : null, ahora);
        if (!s) { sinDatos++; continue; }
        const d = desfase(orden.platinum, s.precio);
        if (d.desfasada) desfasadas.push({ orden, ...s, ...d });
        else alDia++;
    }
    desfasadas.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return { desfasadas, alDia, sinDatos };
}
