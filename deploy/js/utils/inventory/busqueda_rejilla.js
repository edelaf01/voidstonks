import { ESTADO_AUSENCIAS, acumulaNoVistos, cierraEscaneo } from "./ausencias_rejilla.js";
import { editDistance } from "../fuzzy_search.js";

export const MIN_CONSULTA = 3;
export const VACIA_STD = 8;
export const TOPE_CEROS = 8;
export const ESTADO_BUSQUEDA = Object.freeze({ clave: null, ausencias: ESTADO_AUSENCIAS });

export function normalizaTexto(s) {
    return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizaConsulta(texto) {
    const t = normalizaTexto(texto);
    if (/^search\W*$/.test(t)) {
        return "";
    }
    return t;
}

function caracterCompartido(t, visibles, esDelante) {
    let inter = null;
    for (const v of visibles) {
        const chars = new Set();
        let pos = v.indexOf(t);
        while (pos !== -1) {
            if (esDelante) {
                if (pos > 0 && v[pos - 1] !== " ") {
                    chars.add(v[pos - 1]);
                }
            } else {
                const fin = pos + t.length;
                if (fin < v.length && v[fin] !== " ") {
                    chars.add(v[fin]);
                }
            }
            pos = v.indexOf(t, pos + 1);
        }
        if (inter === null) {
            inter = chars;
        } else {
            for (const c of inter) {
                if (!chars.has(c)) {
                    inter.delete(c);
                }
            }
        }
    }
    if (!inter || inter.size === 0) {
        return "";
    }
    if (inter.size === 1) {
        return [...inter][0];
    }
    return null;
}

export function resuelveConsulta(texto, nombresVisibles) {
    const q = normalizaConsulta(texto);
    const tries = [q];
    if (/[|il1!]$/.test(q)) {
        tries.push(normalizaTexto(q.slice(0, -1)));
    }
    const visibles = (nombresVisibles || []).map(normalizaTexto);
    for (const t of tries) {
        if (t.length >= MIN_CONSULTA && /^[a-z0-9 '\-]+$/.test(t) && visibles.length > 0 && visibles.every((v) => v.includes(t))) {
            let res = t;
            const tras = caracterCompartido(res, visibles, false);
            if (tras === null) {
                return null;
            }
            if (tras) {
                res = res + tras;
            }
            const delante = visibles.length > 1 ? caracterCompartido(res, visibles, true) : "";
            if (delante === null) {
                return null;
            }
            if (delante) {
                res = delante + res;
            }
            return res;
        }
    }
    return null;
}

export function rejillaCompleta(celdas, filas, cols) {
    if (!Number.isInteger(filas) || filas < 1 || !Number.isInteger(cols) || cols < 1) {
        return false;
    }
    if (!Array.isArray(celdas) || celdas.length !== filas * cols) {
        return false;
    }
    const vistos = new Set();
    for (const celda of celdas) {
        if (!celda || !Number.isInteger(celda.r) || !Number.isInteger(celda.c)) {
            return false;
        }
        if (celda.r < 0 || celda.r >= filas || celda.c < 0 || celda.c >= cols) {
            return false;
        }
        const pos = `${celda.r},${celda.c}`;
        if (vistos.has(pos)) {
            return false;
        }
        vistos.add(pos);
        if (celda.tipo !== "item" && celda.tipo !== "vacia") {
            return false;
        }
        if (celda.tipo === "item" && !celda.nombre) {
            return false;
        }
    }
    const ordenadas = [...celdas].sort((a, b) => a.r - b.r || a.c - b.c);
    let n = 0;
    while (n < ordenadas.length && ordenadas[n].tipo === "item") {
        n++;
    }
    if (n === 0) {
        return false;
    }
    for (let i = n; i < ordenadas.length; i++) {
        if (ordenadas[i].tipo !== "vacia") {
            return false;
        }
    }
    const ultimaFila = Math.floor((n - 1) / cols);
    return n < cols || ultimaFila < filas - 1;
}

export function ausentesDeBusqueda({ texto, celdas, filas, cols, inventario, textoDe = (n) => n, excluye = () => false, repite = false, filaParcial = false } = {}) {
    if (!rejillaCompleta(celdas, filas, cols)) {
        return { consulta: null, motivo: "incompleta", vistos: [], candidatos: [] };
    }
    if (filaParcial && celdas.every((c) => c.r !== 0 || c.tipo === "item")) {
        return { consulta: null, motivo: "fila_llena", vistos: [], candidatos: [] };
    }
    const ordenadas = [...celdas].sort((a, b) => a.r - b.r || a.c - b.c);
    const vistos = ordenadas.filter((c) => c.tipo === "item").map((c) => c.nombre);
    if (!repite && new Set(vistos).size !== vistos.length) {
        return { consulta: null, motivo: "repetida", vistos, candidatos: [] };
    }
    const consulta = resuelveConsulta(texto, vistos.map(textoDe));
    if (!consulta) {
        return { consulta: null, motivo: "sin_consulta", vistos, candidatos: [] };
    }
    const vistosSet = new Set(vistos);
    const candidatos = Object.keys(inventario || {})
        .filter((k) => Number(inventario[k]) > 0 && !vistosSet.has(k) && (vistos.length > 1 ? normalizaTexto(textoDe(k)).includes(consulta) : ` ${normalizaTexto(textoDe(k))}`.includes(` ${consulta}`)) && !excluye(k) && (!repite || !vistos.some((v) => editDistance(k, v, 1) <= 1)))
        .sort();
    if (candidatos.length > TOPE_CEROS) {
        return { consulta: null, motivo: "demasiados", vistos, candidatos: [] };
    }
    return { consulta, motivo: null, vistos, candidatos };
}

export function pasoBusqueda(estado, resultado, clave, idEscaneo, inventario, ahora) {
    if (!resultado || resultado.motivo || !resultado.consulta || !clave) {
        return { estado: ESTADO_BUSQUEDA, aCero: [], pendientes: [] };
    }
    const base = estado && estado.clave === clave ? estado.ausencias : ESTADO_AUSENCIAS;
    const abierto = acumulaNoVistos(base, resultado.candidatos, idEscaneo, resultado.vistos);
    const { estado: cerrado, aCero } = cierraEscaneo(abierto, idEscaneo, inventario, ahora);
    return { estado: { clave, ausencias: cerrado }, aCero, pendientes: Object.keys(cerrado.votos) };
}

export function categoriaDeBusqueda(texto) {
    const s = String(texto || "").toUpperCase();
    if (/PRIME\s*PART|PARTES?\s*PRIME/.test(s)) {
        return "piezas";
    }
    if (/RELI[CQ]/.test(s)) {
        return "reliquias";
    }
    return null;
}

export function analizaFranjaBusqueda(pix, ancho, alto) {
    const borde = ancho - Math.max(1, Math.round(ancho * 0.06));
    let tinta = 0;
    let alBorde = false;
    const isInk = new Uint8Array(ancho);
    for (let y = 0; y < alto; y++) {
        const rowOffset = y * ancho;
        let inkCount = 0;
        for (let x = 0; x < ancho; x++) {
            const idx = (rowOffset + x) * 4;
            const luma = 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];
            if (luma > 140) {
                isInk[x] = 1;
                inkCount++;
            } else {
                isInk[x] = 0;
            }
        }
        if (inkCount > ancho * 0.5) {
            for (let x = 0; x < ancho; x++) {
                const idx = (rowOffset + x) * 4;
                pix[idx] = 255;
                pix[idx + 1] = 255;
                pix[idx + 2] = 255;
            }
        } else {
            for (let x = 0; x < ancho; x++) {
                const idx = (rowOffset + x) * 4;
                if (isInk[x]) {
                    pix[idx] = 0;
                    pix[idx + 1] = 0;
                    pix[idx + 2] = 0;
                    tinta++;
                    if (x >= borde) {
                        alBorde = true;
                    }
                } else {
                    pix[idx] = 255;
                    pix[idx + 1] = 255;
                    pix[idx + 2] = 255;
                }
            }
        }
    }
    return { tinta, alBorde };
}

export function celdaEnBlanco(pix, tope = VACIA_STD) {
    if (!pix || pix.length < 4) {
        return false;
    }
    const n = Math.floor(pix.length / 4);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        sum += 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];
    }
    const mean = sum / n;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        const luma = 0.299 * pix[idx] + 0.587 * pix[idx + 1] + 0.114 * pix[idx + 2];
        const diff = luma - mean;
        sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / n);
    return std <= tope;
}
