import { VENDER_YA } from "./vender_ya.js";

export const MOMENTO = {
    PRECIO_MIN: 15,
    ANUNCIO_DIAS: 14,
    VENDER_DIAS: 7,
    COMPRAR_DESDE_DIAS: 21,
    COMPRAR_HASTA_DIAS: 56,
    COMPRA_DESCUENTO: 0.2,
    PREVIO_SEMANAS: 3,
    SERIE_SEMANAS: 10,
    CAIDA_FUERTE: 0.3,
    VOLUMEN_ALTO: 10,
    VARZIA_DIAS: 28,
};

const DIA_MS = 86400000;

function ms(fecha) {
    const t = Date.parse(fecha || "");
    return Number.isFinite(t) ? t : null;
}

function serieDe(historial, nombre) {
    const s = historial?.s?.[`${nombre} Set`];
    const d = historial?.d;
    if (!Array.isArray(s) || !Array.isArray(d)) return [];
    const puntos = [];
    for (let i = 0; i < s.length && i < d.length; i++) if (s[i] > 0) puntos.push({ d: d[i], p: s[i] });
    return puntos;
}

function eventosDe(nombre, eventos, vc) {
    const lista = [];
    for (const [inicio, fin] of eventos?._unvaults?.[nombre] || []) lista.push({ tipo: "unvault", inicio, fin });
    const v = eventos?._varzia;
    if (v?.n?.includes(nombre) && ms(v.fin) !== null) {
        lista.push({ tipo: "varzia", inicio: new Date(ms(v.fin) - MOMENTO.VARZIA_DIAS * DIA_MS).toISOString().slice(0, 10), fin: v.fin.slice(0, 10) });
    }
    if (v?.sig?.n?.includes(nombre) && ms(v.sig.ini) !== null) {
        lista.push({ tipo: "varzia", inicio: v.sig.ini.slice(0, 10), fin: (v.sig.fin || "").slice(0, 10) || null });
    }
    if (vc?.t === "resurgence_proxima" && ms(vc.d) !== null) lista.push({ tipo: "varzia", inicio: vc.d, fin: vc.h || null });
    const vistos = new Set();
    return lista.filter((e) => ms(e.inicio) !== null && !vistos.has(`${e.tipo}${e.inicio}`) && vistos.add(`${e.tipo}${e.inicio}`));
}

function faseDe(dias, vigente) {
    if (dias < -MOMENTO.ANUNCIO_DIAS) return null;
    if (dias < 0) return "anuncio";
    if (dias < MOMENTO.VENDER_DIAS) return "semana1";
    if (dias < MOMENTO.COMPRAR_DESDE_DIAS || vigente) return "espera";
    if (dias <= MOMENTO.COMPRAR_HASTA_DIAS) return "compra";
    return null;
}

function eventoActivo(eventos, hoy) {
    let mejor = null;
    for (const e of eventos) {
        const fase = faseDe((hoy - ms(e.inicio)) / DIA_MS, ms(e.fin) !== null && hoy < ms(e.fin));
        if (!fase) continue;
        const prioridad = fase === "anuncio" || fase === "semana1" ? 2 : fase === "compra" ? 1 : 0;
        if (!mejor || prioridad > mejor.prioridad || (prioridad === mejor.prioridad && ms(e.inicio) > ms(mejor.evento.inicio))) mejor = { evento: e, fase, prioridad };
    }
    return mejor;
}

function precioPrevio(puntos, inicio) {
    const antes = puntos.filter((x) => ms(x.d) < ms(inicio)).slice(-MOMENTO.PREVIO_SEMANAS);
    if (!antes.length) return 0;
    return Math.round(antes.reduce((a, x) => a + x.p, 0) / antes.length);
}

function nivel(puntos) {
    return puntos >= 4 ? "alta" : puntos >= 2 ? "media" : "baja";
}

export function senalMomento({ nombre, historial, eventos, tendencia, precio, propio = false, hoy = Date.now() } = {}) {
    const vacio = { estado: null, confianza: null, fase: null, motivo: null, evento: null, serie: [] };
    if (!nombre) return vacio;
    const ev = eventos?.[nombre] || {};
    const t = tendencia || {};
    const lista = eventosDe(nombre, eventos, t.vc);
    const ciclo = Boolean(ev.v || ev.ve || lista.length);
    if (!propio && !ciclo) return vacio;

    const puntos = serieDe(historial, nombre);
    const serie = puntos.slice(-MOMENTO.SERIE_SEMANAS);
    const actual = precio > 0 ? precio : t.p > 0 ? t.p : puntos.length ? puntos[puntos.length - 1].p : 0;
    const volumen = Number.isFinite(t.v) ? t.v : null;
    const activo = eventoActivo(lista, hoy);
    const fase = activo?.fase || "sinEvento";
    const evento = activo ? { tipo: activo.evento.tipo, inicio: activo.evento.inicio, fin: activo.evento.fin || null } : null;
    const base = { fase, evento, serie };

    const caida = actual > 0 && t.p7 > 0 ? (t.p7 - actual) / t.p7 : 0;
    const enVentana = fase === "anuncio" || fase === "semana1";
    const porCaida = caida >= VENDER_YA.CAIDA_MIN;

    if (enVentana || porCaida) {
        const apto = actual >=MOMENTO.PRECIO_MIN && (volumen === null || volumen > VENDER_YA.VOLUMEN_MIN);
        if (!apto) return { ...base, estado: "esperar", confianza: "baja", motivo: null };
        const tamano = (enVentana ? 1 : 0) + (porCaida ? 1 : 0) + (caida >= MOMENTO.CAIDA_FUERTE ? 1 : 0);
        const vol = volumen !== null && volumen >= MOMENTO.VOLUMEN_ALTO ? 1 : 0;
        const real = ev.v || (eventos?._unvaults?.[nombre] || []).length || activo?.evento.tipo === "varzia" ? 1 : 0;
        return { ...base, estado: "vender", confianza: nivel(tamano + vol + real), motivo: enVentana ? "ventana" : "caida", pct: Math.round(caida * 100) };
    }

    if (fase === "compra") {
        const previo = precioPrevio(puntos, activo.evento.inicio);
        if (previo > 0 && actual > 0 && actual <= previo * (1 - MOMENTO.COMPRA_DESCUENTO)) {
            return { ...base, estado: "comprar", confianza: "baja", motivo: "bajoPrevio", pct: Math.round((1 - actual / previo) * 100) };
        }
    }

    return { ...base, estado: "esperar", confianza: "baja", motivo: null };
}

let prediccionCarga = null;
let prediccionDatos = null;

export function cargaPrediccion() {
    prediccionCarga ??= fetch("assets/json/prediccion_prime.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
            prediccionDatos = d?.v === 1 && d.items && Array.isArray(d.niveles) ? d : null;
            return prediccionDatos;
        })
        .catch(() => {
            prediccionCarga = null;
            return null;
        });
    return prediccionCarga;
}

export function prediccionDe(slug) {
    const it = prediccionDatos?.items?.[slug];
    if (!it) return null;
    const nivelNombre = prediccionDatos.niveles[it.n];
    if (!nivelNombre || !(it.p10 > 0) || !(it.p90 >= it.p10)) return null;
    return {
        p10: it.p10,
        p50: it.p50,
        p90: it.p90,
        nivel: nivelNombre,
        horizonte: prediccionDatos.horizonte_dias || 28,
        error: prediccionDatos.error?.[nivelNombre] || null,
    };
}
