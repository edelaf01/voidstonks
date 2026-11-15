export const VOTOS_PARA_CERO = 2;
export const CADUCIDAD_VOTO_MS = 14 * 24 * 60 * 60 * 1000;
export const ESTADO_AUSENCIAS = Object.freeze({ votos: Object.freeze({}), apertura: null });
export const PRIMERO_EN_LISTA = Object.freeze(new Set(["Odonata Prime Blueprint"]));

export function vaPrimeroEnLista(n) {
    return PRIMERO_EN_LISTA.has(n);
}

export function ordenEsNombre(texto) {
    const s = String(texto || "").toUpperCase().replace(/[^A-Z]/g, "");
    return s.includes("NAME") || s.includes("NOMBRE");
}

function enLectura(celdas) {
    return [...(celdas || [])].sort((a, b) => (a.r ?? 0) - (b.r ?? 0) || (a.c ?? 0) - (b.c ?? 0));
}

function esCasada(celda) {
    return celda?.tipo === "item" && !!celda.nombre;
}

function contiguas(a, b, cols) {
    if (!Number.isInteger(a?.r) || !Number.isInteger(a?.c) || !Number.isInteger(b?.r) || !Number.isInteger(b?.c)) {
        return false;
    }
    if (b.r === a.r) {
        return b.c === a.c + 1;
    }
    return Number.isInteger(cols) && b.r === a.r + 1 && b.c === 0 && a.c === cols - 1;
}

export function claveSet(nombre, getSetName, vaPrimero) {
    if (vaPrimero?.(nombre)) return "\u0000" + nombre;
    const s = getSetName(nombre);
    return nombre === s || nombre.startsWith(s + " ") ? s : nombre;
}

export function comparaNombres(a, b, getSetName, vaPrimero) {
    const rawA = claveSet(a, getSetName, vaPrimero);
    const rawB = claveSet(b, getSetName, vaPrimero);
    const setA = rawA.toLowerCase();
    const setB = rawB.toLowerCase();
    if (setA < setB) return -1;
    if (setA > setB) return 1;
    const pA = a.slice(rawA.length).trim().toLowerCase();
    const pB = b.slice(rawB.length).trim().toLowerCase();
    const rA = pA === "blueprint" ? 1 : 0;
    const rB = pB === "blueprint" ? 1 : 0;
    if (rA !== rB) return rA - rB;
    return pA < pB ? -1 : pA > pB ? 1 : 0;
}

export function revisaOrden(nombres, getSetName, vaPrimero) {
    const vistos = new Set();
    for (let i = 0; i < (nombres || []).length; i++) {
        const n = nombres[i];
        if (!n) return { motivo: "sin_nombre", en: i };
        if (vistos.has(n)) return { motivo: "repetido", en: i };
        vistos.add(n);
        if (i > 0 && comparaNombres(nombres[i - 1], n, getSetName, vaPrimero) >= 0) return { motivo: "desordenado", en: i };
    }
    return null;
}

export function rachasConfiadas(celdas, cols) {
    const ordenadas = enLectura(celdas);
    const rachas = [];
    let racha = [];
    for (const celda of ordenadas) {
        if (!esCasada(celda)) {
            if (racha.length) {
                rachas.push(racha);
                racha = [];
            }
        } else {
            if (!racha.length || contiguas(racha[racha.length - 1], celda, cols)) {
                racha.push(celda);
            } else {
                rachas.push(racha);
                racha = [celda];
            }
        }
    }
    if (racha.length) rachas.push(racha);
    return rachas;
}

export function ausentesEnPagina(celdas, inventario, getSetName, opciones = {}) {
    const { puerta, cols, vaPrimero, previo } = opciones || {};
    if (puerta !== true) {
        return { inferible: false, motivo: "sin_puerta", ausentes: [] };
    }
    const casadas = enLectura(celdas).filter(esCasada);
    const nombres = casadas.map((x) => x.nombre);
    const fallo = revisaOrden(nombres, getSetName, vaPrimero);
    if (fallo) {
        return { inferible: false, motivo: fallo.motivo, ausentes: [] };
    }
    const cants = casadas.map((x) => Number(x.qty ?? 1));
    let tieneCreciente = false;
    for (let i = 1; i < cants.length; i++) {
        if (cants[i] > cants[i - 1]) {
            tieneCreciente = true;
            break;
        }
    }
    if (!tieneCreciente) {
        return { inferible: false, motivo: "cantidades", ausentes: [] };
    }
    const sets = [];
    for (const n of nombres) {
        const s = claveSet(n, getSetName, vaPrimero);
        if (!sets.includes(s)) sets.push(s);
    }
    const interiores = new Set(sets.slice(1, -1));
    const dudosos = new Set(previo != null ? nombres.filter((n) => !(Number(previo[n]) > 0)).map((n) => claveSet(n, getSetName, vaPrimero)) : []);
    const enPagina = new Set(nombres);
    const ausentes = [];
    for (const [nombre, cant] of Object.entries(inventario || {})) {
        if (!(Number(cant) > 0)) continue;
        if (enPagina.has(nombre)) continue;
        if (vaPrimero?.(nombre)) continue;
        if (dudosos.has(claveSet(nombre, getSetName, vaPrimero))) continue;
        if (!interiores.has(claveSet(nombre, getSetName, vaPrimero))) continue;
        const j = nombres.findIndex((n) => comparaNombres(nombre, n, getSetName, vaPrimero) < 0);
        if (j > 0 && comparaNombres(nombres[j - 1], nombre, getSetName, vaPrimero) < 0 && contiguas(casadas[j - 1], casadas[j], cols)) {
            ausentes.push(nombre);
        }
    }
    ausentes.sort((a, b) => comparaNombres(a, b, getSetName, vaPrimero));
    return { inferible: true, ausentes };
}

export function avanzaTramo(tramo, celdas, cols, getSetName, vaPrimero, inventario) {
    const rachas = rachasConfiadas(celdas, cols);
    if (!rachas.length) return tramo;
    const mayor = rachas.reduce((a, b) => (b.length > a.length ? b : a), rachas[0]);
    const nuevo = () => {
        const nombres = mayor.map((x) => x.nombre);
        if (revisaOrden(nombres, getSetName, vaPrimero)) return null;
        const c0 = mayor[0];
        return {
            nombres,
            cants: mayor.map((x) => Number(x.qty ?? 1)),
            inicio: Boolean(vaPrimero?.(c0.nombre) && c0.r === 0 && c0.c === 0),
            id: (tramo?.id ?? 0) + 1,
        };
    };
    if (!tramo?.nombres?.length) return nuevo();
    let actual = tramo;
    let intersecta = false;
    for (const racha of rachas) {
        const last = actual.nombres[actual.nombres.length - 1];
        const first = racha[0].nombre;
        const une = racha.some((x) => actual.nombres.includes(x.nombre)) || (
            inventario &&
            comparaNombres(last, first, getSetName, vaPrimero) < 0 &&
            !Object.entries(inventario).some(([n, qty]) => Number(qty) > 0 && !vaPrimero?.(n) && comparaNombres(last, n, getSetName, vaPrimero) < 0 && comparaNombres(n, first, getSetName, vaPrimero) < 0)
        );
        if (!une) continue;
        intersecta = true;
        if (revisaOrden(racha.map((x) => x.nombre), getSetName, vaPrimero)) return nuevo();
        const mapa = new Map(actual.nombres.map((n, i) => [n, Number(actual.cants?.[i] ?? 1)]));
        for (const celda of racha) {
            mapa.set(celda.nombre, Number(celda.qty ?? 1));
        }
        const nombres = [...mapa.keys()].sort((a, b) => comparaNombres(a, b, getSetName, vaPrimero));
        if (revisaOrden(nombres, getSetName, vaPrimero)) return nuevo();
        const c0 = racha[0];
        const inicioRacha = Boolean(vaPrimero?.(c0.nombre) && c0.r === 0 && c0.c === 0);
        actual = {
            nombres,
            cants: nombres.map((n) => mapa.get(n)),
            inicio: Boolean((actual.inicio || inicioRacha) && vaPrimero?.(nombres[0])),
            id: actual.id,
        };
    }
    return intersecta ? actual : nuevo();
}

export function ausentesEnTramo(tramo, inventario, getSetName, vaPrimero, previo) {
    if (!tramo) {
        return { inferible: false, motivo: "sin_tramo", ausentes: [] };
    }
    const cants = (tramo.cants || []).map((x) => Number(x ?? 1));
    let tieneCreciente = false;
    for (let i = 1; i < cants.length; i++) {
        if (cants[i] > cants[i - 1]) {
            tieneCreciente = true;
            break;
        }
    }
    if (!tieneCreciente) {
        return { inferible: false, motivo: "cantidades", ausentes: [] };
    }
    const nombres = tramo.nombres || [];
    const sets = [];
    for (const n of nombres) {
        const s = claveSet(n, getSetName, vaPrimero);
        if (!sets.includes(s)) sets.push(s);
    }
    const cubiertos = new Set(sets.slice(tramo.inicio ? 0 : 1, -1));
    const dudosos = new Set(previo != null ? nombres.filter((n) => !(Number(previo[n]) > 0)).map((n) => claveSet(n, getSetName, vaPrimero)) : []);
    const enTramo = new Set(nombres);
    const ausentes = [];
    for (const [nombre, cant] of Object.entries(inventario || {})) {
        if (!(Number(cant) > 0)) continue;
        if (enTramo.has(nombre)) continue;
        if (vaPrimero?.(nombre)) continue;
        if (dudosos.has(claveSet(nombre, getSetName, vaPrimero))) continue;
        const antes = Boolean(tramo.inicio && nombres.length && comparaNombres(nombre, nombres[0], getSetName, vaPrimero) < 0);
        if (!cubiertos.has(claveSet(nombre, getSetName, vaPrimero)) && !antes) continue;
        ausentes.push(nombre);
    }
    ausentes.sort((a, b) => comparaNombres(a, b, getSetName, vaPrimero));
    return { inferible: true, ausentes };
}

export function registraVistos(estado, vistos, idApertura) {
    const base = estado || ESTADO_AUSENCIAS;
    const apertura = base.apertura && base.apertura.id === idApertura
        ? base.apertura
        : { id: idApertura, vistos: [], pendientes: [] };
    const votos = { ...base.votos };
    for (const nombre of vistos || []) {
        delete votos[nombre];
    }
    return {
        ...base,
        votos,
        apertura: {
            ...apertura,
            vistos: [...new Set([...apertura.vistos, ...(vistos || [])])]
        }
    };
}

export function acumulaNoVistos(estado, candidatos, idApertura, vistos = []) {
    const e = registraVistos(estado, vistos, idApertura);
    return {
        ...e,
        apertura: {
            ...e.apertura,
            pendientes: [...new Set([...e.apertura.pendientes, ...(candidatos || [])])]
        }
    };
}

export function cierraEscaneo(estado, idApertura, inventario, ahora) {
    const base = estado || ESTADO_AUSENCIAS;
    if (!base.apertura || base.apertura.id !== idApertura) {
        return { estado: base, aCero: [] };
    }
    const inv = inventario || {};
    const vistos = new Set(base.apertura.vistos);
    const votos = { ...base.votos };
    for (const nombre of base.apertura.pendientes || []) {
        if (vistos.has(nombre)) continue;
        const previos = votos[nombre] || [];
        if (previos.some((v) => v.id === idApertura)) continue;
        votos[nombre] = [...previos, { id: idApertura, cant: Number(inv[nombre]), ts: ahora }];
    }
    const aCero = [];
    const quedan = {};
    for (const [nombre, lista] of Object.entries(votos)) {
        const cant = Number(inv[nombre]);
        const validos = (lista || []).filter(
            (v) => cant > 0 && v.cant === cant && v.ts <= ahora && ahora - v.ts <= CADUCIDAD_VOTO_MS
        );
        if (validos.length >= VOTOS_PARA_CERO) {
            aCero.push(nombre);
        } else if (validos.length > 0) {
            quedan[nombre] = validos;
        }
    }
    return {
        estado: { ...base, votos: quedan, apertura: null },
        aCero
    };
}
