import { VENDER_YA } from "./vender_ya.js";

export const MOMENTO = {
    PRECIO_MIN: 15,
    VENDER_PRECIO_MIN: 30,
    ANUNCIO_DIAS: 14,
    VENDER_DIAS: 7,
    COMPRAR_DESDE_DIAS: 21,
    COMPRAR_HASTA_DIAS: 56,
    COMPRA_DESCUENTO: 0.2,
    PREVIO_SEMANAS: 3,
    SERIE_SEMANAS: 10,
    VARZIA_DIAS: 28,
    HUECO_MIN_DIAS: 60,
    HUECO_ALTO_DIAS: 120,
    ESTABLE_DIAS: 14,
    MANTENER_DIAS: 56,
    RANGO_PASOS: 4,
    RANGO_MIN_MUESTRAS: 12,
    RANGO_VENTANA_SEMANAS: 104,
};

const DIA_MS = 86400000;
const cacheRangoGlobal = new WeakMap();

function ms(fecha) {
    const t = Date.parse(fecha || "");
    return Number.isFinite(t) ? t : null;
}

function puntosDe(d, s) {
    if (!Array.isArray(s) || !Array.isArray(d)) return [];
    const puntos = [];
    for (let i = 0; i < s.length && i < d.length; i++) if (s[i] > 0) puntos.push({ d: d[i], p: s[i] });
    return puntos;
}

function serieDe(historial, nombre) {
    return puntosDe(historial?.d, historial?.s?.[`${nombre} Set`]);
}

function cuantil(ordenados, q) {
    const pos = (ordenados.length - 1) * q;
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = ordenados[base];
    const b = ordenados[base + 1];
    return b === undefined ? a : a + (b - a) * frac;
}

function cocientesDe(puntos) {
    const ventana = puntos.slice(-MOMENTO.RANGO_VENTANA_SEMANAS);
    const paso = MOMENTO.RANGO_PASOS;
    const objetivo = paso * 7;
    const res = [];
    for (let i = 0; i + paso < ventana.length; i++) {
        const a = ventana[i];
        const b = ventana[i + paso];
        const ta = ms(a.d);
        const tb = ms(b.d);
        if (ta === null || tb === null || !(a.p > 0) || !(b.p > 0)) continue;
        const dias = (tb - ta) / DIA_MS;
        if (Math.abs(dias - objetivo) <= 7) res.push(b.p / a.p);
    }
    return res;
}

function cuantilesDe(cocientes) {
    if (!cocientes.length) return null;
    const ord = [...cocientes].sort((a, b) => a - b);
    return [cuantil(ord, 0.1), cuantil(ord, 0.5), cuantil(ord, 0.9)];
}

function cuantilesGlobales(historial) {
    if (!historial || typeof historial !== "object") return null;
    if (cacheRangoGlobal.has(historial)) return cacheRangoGlobal.get(historial);
    const d = historial.d;
    const sMap = historial.s;
    const todos = [];
    if (Array.isArray(d) && sMap && typeof sMap === "object") {
        for (const serie of Object.values(sMap)) {
            const c = cocientesDe(puntosDe(d, serie));
            for (let j = 0; j < c.length; j++) todos.push(c[j]);
        }
    }
    const q = cuantilesDe(todos);
    cacheRangoGlobal.set(historial, q);
    return q;
}

export function rangoDe(puntos, actual, historial) {
    if (!(actual > 0) || !Number.isFinite(actual)) return null;
    const propios = cocientesDe(puntos || []);
    const usaPropio = propios.length >= MOMENTO.RANGO_MIN_MUESTRAS;
    const q = usaPropio ? cuantilesDe(propios) : cuantilesGlobales(historial);
    if (!q) return null;
    const p10 = Math.max(1, Math.round(actual * q[0]));
    const p50 = Math.max(p10, Math.round(actual * q[1]));
    const p90 = Math.max(p50, Math.round(actual * q[2]));
    const amp = (p90 - p10) / p50;
    let nivel = "baja";
    if (usaPropio) {
        if (propios.length >= 40 && amp <= 0.25) nivel = "alta";
        else if (propios.length >= 20 && amp <= 0.45) nivel = "media";
    }
    return { ref: actual, p10, p50, p90, nivel, horizonte: MOMENTO.RANGO_PASOS * 7 };
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

function huecoAnterior(lista, inicio) {
    const ini = ms(inicio);
    let prev = null;
    for (const e of lista) {
        const t = ms(e.inicio);
        if (t !== null && t < ini && (prev === null || t > prev)) prev = t;
    }
    return prev === null ? null : (ini - prev) / DIA_MS;
}

function estable(puntos, actual, hoy) {
    const limite = hoy - MOMENTO.ESTABLE_DIAS * DIA_MS;
    let ref = null;
    for (const x of puntos) {
        const t = ms(x.d);
        if (t !== null && t <= limite) ref = x.p;
    }
    return ref === null || actual >= ref * 0.97;
}

export function senalMomento({ nombre, historial, eventos, tendencia, precio, propio = false, hoy = Date.now() } = {}) {
    const vacio = { estado: null, confianza: null, fase: null, motivo: null, evento: null, serie: [], rango: null };
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
    const rango = rangoDe(puntos, actual, historial);
    const base = { fase, evento, serie, rango };

    const enVentana = fase === "anuncio" || fase === "semana1";
    if (enVentana) {
        const apto = actual >= MOMENTO.VENDER_PRECIO_MIN && (volumen === null || volumen > VENDER_YA.VOLUMEN_MIN);
        if (!apto) return { ...base, estado: "esperar", confianza: "baja", motivo: null };
        const hueco = huecoAnterior(lista, activo.evento.inicio);
        if (hueco !== null && hueco <= MOMENTO.HUECO_MIN_DIAS) return { ...base, estado: "esperar", confianza: "baja", motivo: null };
        const confianza = hueco === null || hueco > MOMENTO.HUECO_ALTO_DIAS ? "alta" : "media";
        return { ...base, estado: "vender", confianza, motivo: "ventana" };
    }

    if (fase === "compra") {
        const previo = precioPrevio(puntos, activo.evento.inicio);
        const minOk = activo.evento.tipo !== "varzia" || actual >= MOMENTO.VENDER_PRECIO_MIN;
        if (previo > 0 && actual > 0 && minOk && actual <= previo * (1 - MOMENTO.COMPRA_DESCUENTO) && estable(puntos, actual, hoy)) {
            return { ...base, estado: "comprar", confianza: "media", motivo: "bajoPrevio", pct: Math.round((1 - actual / previo) * 100), mantener: MOMENTO.MANTENER_DIAS };
        }
    }

    return { ...base, estado: "esperar", confianza: "baja", motivo: null };
}

let vaultEstimadoCarga = null;
let eventosPorSlug = null;

function claveSlug(nombre) {
    return nombre.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function cargaVaultEstimado() {
    vaultEstimadoCarga ??= fetch("assets/json/eventos_prime.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((eventos) => {
            if (!eventos) {
                vaultEstimadoCarga = null;
                return null;
            }
            eventosPorSlug = new Map();
            for (const [nombre, ev] of Object.entries(eventos)) if (!nombre.startsWith("_") && ev) eventosPorSlug.set(`${claveSlug(nombre)}_set`, ev);
            return eventosPorSlug;
        })
        .catch(() => {
            vaultEstimadoCarga = null;
            return null;
        });
    return vaultEstimadoCarga;
}

export function precioBajoPrediccion(pred) {
    return Boolean(pred) && pred.ref < MOMENTO.PRECIO_MIN;
}

export function vaultEstimadoDe(slug) {
    const ev = eventosPorSlug?.get(slug);
    if (!ev || ev.v || !ev.ve) return null;
    const mes = String(ev.ve).slice(0, 7);
    return /^\d{4}-\d{2}$/.test(mes) ? mes : null;
}
