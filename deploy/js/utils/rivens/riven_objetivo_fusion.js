import { RECETAS_COMBINAR } from "./riven_cycling.js";

const CLAVE = "voidstonks_objetivo_fusion";
const MAX_ARMAS = 60;

let memoria = null;

function lee() {
    if (memoria) return memoria;
    try {
        const datos = JSON.parse(localStorage.getItem(CLAVE) || "{}");
        memoria = datos && typeof datos === "object" && !Array.isArray(datos) ? datos : {};
    } catch {
        memoria = {};
    }
    return memoria;
}

export function objetivoFusion(arma) {
    const i = arma ? lee()[arma] : undefined;
    return Number.isInteger(i) && RECETAS_COMBINAR[i] ? i : null;
}

export function fijaObjetivoFusion(arma, indice) {
    if (!arma) return null;
    const datos = { ...lee() };
    delete datos[arma];
    const nuevo = Number.isInteger(indice) && RECETAS_COMBINAR[indice] ? indice : null;
    if (nuevo !== null) datos[arma] = nuevo;
    memoria = Object.fromEntries(Object.entries(datos).slice(-MAX_ARMAS));
    try {
        localStorage.setItem(CLAVE, JSON.stringify(memoria));
    } catch (e) {
        console.warn("objetivo de fusión sin guardar:", e);
    }
    return nuevo;
}

const RANGO = { lista: 0, falta: 1, otra: 2 };

export function opcionesDeCartas(combinados) {
    const cartas = (combinados || []).filter((c) => c?.opciones?.length);
    if (!cartas.length) return [];
    return cartas[0].opciones.map((o) => {
        const todas = cartas.map((c) => c.opciones.find((x) => x.indice === o.indice)).filter(Boolean);
        const estado = todas.map((x) => x.estado).sort((a, b) => RANGO[a] - RANGO[b])[0];
        const faltas = [...new Set(todas.filter((x) => x.estado === "falta").map((x) => x.falta))];
        return {
            ...o, estado, activo: o.indice === cartas[0].objetivo,
            falta: estado === "falta" && faltas.length === 1 ? faltas[0] : null,
            recomendada: todas.some((x) => x.recomendada),
        };
    });
}

export function botonesDeCartas(combinados) {
    const porNombre = new Map();
    const orden = opcionesDeCartas(combinados)
        .filter((o) => o.activo || o.estado !== "otra")
        .sort((a, b) => b.activo - a.activo || RANGO[a.estado] - RANGO[b.estado] || a.indice - b.indice);
    for (const o of orden) if (!porNombre.has(o.nombre)) porNombre.set(o.nombre, o);
    return [...porNombre.values()].sort((a, b) => RANGO[a.estado] - RANGO[b.estado] || a.indice - b.indice);
}
