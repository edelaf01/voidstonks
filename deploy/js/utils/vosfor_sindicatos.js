import { copiesForMaxRank } from "./vosfor_math.js";

export function slugsDeSindicatos(data) {
    return [...new Set((data?.sindicatos || []).flatMap((s) => s.ofertas.map((o) => o.slug)))];
}

export function rentaSindicatos(data, { stats, precioSuelto, precioMax, tasaPl = 0, orden = "pl" }) {
    const rangoDe = (slug) => data?.tradables?.[slug]?.[2] ?? data?.arcanes?.[slug]?.maxRank ?? 5;
    const porVos = orden === "vos";
    const clave = (f) => (porVos ? f.vosPorMil || 0 : f.renta);
    return (data?.sindicatos || []).map((s) => {
        const filas = s.ofertas.map((o) => {
            const st = stats.get(o.slug);
            const rangoMax = Math.max(1, Math.min(5, rangoDe(o.slug)));
            const copias = copiesForMaxRank({ maxRank: rangoMax });
            const suelto = st ? precioSuelto(st) : 0;
            const max = st ? precioMax(st) : 0;
            const porMilSuelto = suelto > 0 ? (suelto * 1000) / o.standing : 0;
            const porMilSet = max > 0 ? (max * 1000) / (o.standing * copias) : 0;
            const vosfor = data?.arcanes?.[o.slug]?.vosfor > 0 ? data.arcanes[o.slug].vosfor : null;
            const vosPorMil = vosfor ? (vosfor * 1000) / o.standing : null;
            return {
                ...o, rangoMax, copias, suelto, max, porMilSuelto, porMilSet, cargado: !!st,
                mejor: porMilSet > porMilSuelto ? "set" : "suelto",
                renta: Math.max(porMilSuelto, porMilSet),
                vosfor, vosPorMil,
                plEquivalente: vosPorMil && tasaPl > 0 ? vosPorMil * tasaPl : null,
            };
        }).sort((a, b) => clave(b) - clave(a) || b.renta - a.renta);
        const mejorPl = filas.reduce((m, f) => (f.renta > (m?.renta || 0) ? f : m), null);
        const mejorVos = filas.reduce((m, f) => (f.vosPorMil > (m?.vosPorMil || 0) ? f : m), null);
        const empatesVos = mejorVos ? filas.filter((f) => f.vosPorMil === mejorVos.vosPorMil).length : 0;
        const disolverRindeMas = !!(mejorPl && mejorVos?.plEquivalente > mejorPl.renta);
        return { id: s.id, en: s.en, es: s.es, filas, mejorPl, mejorVos, empatesVos, disolverRindeMas };
    }).sort((a, b) => (porVos
        ? (b.mejorVos?.vosPorMil || 0) - (a.mejorVos?.vosPorMil || 0)
        : 0) || (b.mejorPl?.renta || 0) - (a.mejorPl?.renta || 0));
}
