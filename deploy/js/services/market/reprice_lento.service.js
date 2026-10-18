import { estadisticasDe, editOrder } from "./wfm_orders.service.js";
import { revisaPrecios } from "../../utils/market/precio_reciente.js";

export const ESPERA_MS = 2 * 60 * 60 * 1000;
export const RITMO_MS = 2500;
export const FALLOS_SEGUIDOS = 3;

const CLAVE_REPRICE = "vs_reprice_v1";

let memoria = { mercados: {}, cambios: {} };
let soloMemoria = false;

let estadoActual = {
    fase: "libre",
    hechos: 0,
    total: 0,
    pendientes: 0
};

const suscriptores = new Set();
let promesaRevision = null;

function esVigente(t, ahora) {
    return typeof t === "number" && t <= ahora && ahora - t < ESPERA_MS;
}

function leeAlmacen() {
    if (!soloMemoria) {
        try {
            const data = JSON.parse(localStorage.getItem(CLAVE_REPRICE));
            if (data && typeof data === "object") {
                return {
                    mercados: { ...(data.mercados || {}) },
                    cambios: { ...(data.cambios || {}) }
                };
            }
            return { mercados: {}, cambios: {} };
        } catch {}
    }
    return {
        mercados: { ...(memoria.mercados || {}) },
        cambios: { ...(memoria.cambios || {}) }
    };
}

function guardaAlmacen(datos, ahora = Date.now()) {
    const tAhora = typeof ahora === "function" ? ahora() : ahora;
    const mercados = {};
    for (const [s, v] of Object.entries(datos.mercados || {})) {
        if (v && esVigente(v.t, tAhora)) {
            mercados[s] = v;
        }
    }
    const cambios = {};
    for (const [id, t] of Object.entries(datos.cambios || {})) {
        if (esVigente(t, tAhora)) {
            cambios[id] = t;
        }
    }
    memoria = { mercados, cambios };
    try {
        localStorage.setItem(CLAVE_REPRICE, JSON.stringify(memoria));
        soloMemoria = false;
    } catch {
        soloMemoria = true;
    }
}

function notifica() {
    const copia = estado();
    for (const fn of [...suscriptores]) {
        try {
            fn(copia);
        } catch {}
    }
}

export function estado() {
    return { ...estadoActual };
}

export function suscribe(fn) {
    suscriptores.add(fn);
    return () => {
        suscriptores.delete(fn);
    };
}

export function enEspera(ordenes, ahora = Date.now()) {
    const tAhora = typeof ahora === "function" ? ahora() : ahora;
    const ventas = (ordenes || []).filter((o) => (o?.type || "").toLowerCase() === "sell");
    const { mercados, cambios } = leeAlmacen();

    const enEsperaOrdenes = [];
    const resto = [];

    for (const orden of ventas) {
        const tCambio = cambios[orden.id];
        if (esVigente(tCambio, tAhora)) {
            enEsperaOrdenes.push(orden);
        } else {
            resto.push(orden);
        }
    }

    const mercadosGuardados = {};
    for (const [s, v] of Object.entries(mercados)) {
        if (v && esVigente(v.t, tAhora) && v.d != null) {
            mercadosGuardados[s] = v.d;
        }
    }

    const resultadoRevisa = revisaPrecios(resto, mercadosGuardados, tAhora);

    const faltanSet = new Set();
    for (const orden of resto) {
        const slug = orden?.itemSlug || orden?.item?.slug;
        if (!slug) continue;
        const v = mercados[slug];
        if (!v || !esVigente(v.t, tAhora)) {
            faltanSet.add(slug);
        }
    }

    return {
        desfasadas: resultadoRevisa.desfasadas,
        alDia: resultadoRevisa.alDia,
        sinDatos: resultadoRevisa.sinDatos,
        enEspera: enEsperaOrdenes.length,
        faltan: [...faltanSet]
    };
}

export function revisa(ordenes, { espera = (ms) => new Promise((r) => setTimeout(r, ms)), ahora = Date.now } = {}) {
    if (promesaRevision) return promesaRevision;
    if (estadoActual.fase === "aplicando") return Promise.resolve({ ocupado: true });

    const tAhora = typeof ahora === "function" ? ahora : () => ahora;

    const enCurso = (async () => {
        try {
            const inicial = enEspera(ordenes, tAhora());
            const faltan = inicial.faltan;
            estadoActual.fase = "revisando";
            estadoActual.total = faltan.length;
            estadoActual.hechos = 0;
            notifica();

            let frenado = false;
            let guardados = 0;
            let seguidos = 0;
            for (let i = 0; i < faltan.length; i++) {
                if (i > 0) {
                    await espera(RITMO_MS);
                }
                const slug = faltan[i];
                const res = await estadisticasDe(slug);
                if (res.ok && res.mercado) {
                    const datos = leeAlmacen();
                    datos.mercados[slug] = { t: tAhora(), d: res.mercado };
                    guardaAlmacen(datos, tAhora());
                    guardados++;
                    seguidos = 0;
                } else {
                    seguidos++;
                }
                estadoActual.hechos++;
                notifica();
                if (res.error === "rate") {
                    frenado = true;
                    break;
                }
                if (seguidos >= FALLOS_SEGUIDOS) break;
            }

            const r = enEspera(ordenes, tAhora());
            estadoActual.pendientes = r.desfasadas.length;
            estadoActual.fase = "libre";
            notifica();
            return { ...r, frenado, sinRevisar: faltan.length - guardados };
        } finally {
            if (estadoActual.fase === "revisando") {
                estadoActual.fase = "libre";
                notifica();
            }
        }
    })();

    promesaRevision = enCurso;
    const suelta = () => {
        if (promesaRevision === enCurso) promesaRevision = null;
    };
    enCurso.then(suelta, suelta);
    return enCurso;
}

export async function aplica(elegidas, { espera = (ms) => new Promise((r) => setTimeout(r, ms)), ahora = Date.now } = {}) {
    if (promesaRevision || estadoActual.fase !== "libre") {
        return { hechas: 0, fallos: 0, ocupado: true };
    }

    const tAhora = typeof ahora === "function" ? ahora : () => ahora;
    const listaElegidas = Array.isArray(elegidas) ? elegidas : [];

    estadoActual.fase = "aplicando";
    estadoActual.total = listaElegidas.length;
    estadoActual.hechos = 0;
    notifica();

    let hechas = 0;
    let fallos = 0;
    let frenado = false;

    try {
        for (let i = 0; i < listaElegidas.length; i++) {
            if (i > 0) {
                await espera(RITMO_MS);
            }
            const item = listaElegidas[i];
            const res = await editOrder(item.orden.id, "update", { platinum: item.precio });
            if (res.ok) {
                const datos = leeAlmacen();
                datos.cambios[item.orden.id] = tAhora();
                guardaAlmacen(datos, tAhora());
                hechas++;
                estadoActual.hechos++;
                notifica();
            } else if (res.error === "unauthorized" || res.error === "no_token" || res.error === "rate") {
                frenado = res.error === "rate";
                fallos += listaElegidas.length - i;
                estadoActual.hechos = listaElegidas.length;
                notifica();
                break;
            } else {
                fallos++;
                estadoActual.hechos++;
                notifica();
            }
        }
    } finally {
        estadoActual.pendientes = Math.max(0, estadoActual.pendientes - hechas);
        estadoActual.fase = "libre";
        notifica();
    }

    return { hechas, fallos, frenado };
}

export function marcaVistas() {
    if (!estadoActual.pendientes) return;
    estadoActual.pendientes = 0;
    notifica();
}

export function _reinicia() {
    estadoActual = {
        fase: "libre",
        hechos: 0,
        total: 0,
        pendientes: 0
    };
    suscriptores.clear();
    promesaRevision = null;
    memoria = { mercados: {}, cambios: {} };
    soloMemoria = false;
}
