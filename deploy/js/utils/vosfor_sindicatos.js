import { copiesForMaxRank } from "./vosfor_math.js";

export function slugsDeSindicatos(data) {
    return [...new Set((data?.sindicatos || []).flatMap((s) => s.ofertas.map((o) => o.slug)))];
}

export function rentaSindicatos(data, { stats, precioSuelto, precioMax }) {
    const rangoDe = (slug) => data?.tradables?.[slug]?.[2] ?? data?.arcanes?.[slug]?.maxRank ?? 5;
    return (data?.sindicatos || []).map((s) => {
        const filas = s.ofertas.map((o) => {
            const st = stats.get(o.slug);
            const rangoMax = Math.max(1, Math.min(5, rangoDe(o.slug)));
            const copias = copiesForMaxRank({ maxRank: rangoMax });
            const suelto = st ? precioSuelto(st) : 0;
            const max = st ? precioMax(st) : 0;
            const porMilSuelto = suelto > 0 ? (suelto * 1000) / o.standing : 0;
            const porMilSet = max > 0 ? (max * 1000) / (o.standing * copias) : 0;
            return {
                ...o, rangoMax, copias, suelto, max, porMilSuelto, porMilSet, cargado: !!st,
                mejor: porMilSet > porMilSuelto ? "set" : "suelto",
                renta: Math.max(porMilSuelto, porMilSet),
            };
        }).sort((a, b) => b.renta - a.renta);
        return { id: s.id, en: s.en, es: s.es, filas };
    }).sort((a, b) => (b.filas[0]?.renta || 0) - (a.filas[0]?.renta || 0));
}
