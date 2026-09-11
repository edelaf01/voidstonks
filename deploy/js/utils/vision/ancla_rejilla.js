import { lanes, bestLattice } from "./mission_complete_grid.js";

const CUADRADO = { ladoMin: 8, arTol: 0.15, rellenoMin: 0.20, rellenoMax: 0.55 };
const TOL_TAMANO = 1.35;
const MIN_COLS = 3;
const COBERTURA_MIN = 0.6;
const PASO_MIN = 4;
const PASO_MAX = 20;
const POBLACION_MIN = 0.6;

export function unidadTipografica(comps, zona) {
    const cuadrados = comps.filter((c) => {
        if (c.w < CUADRADO.ladoMin || c.h < CUADRADO.ladoMin) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, Math.max(c.w, c.h) * CUADRADO.arTol)) return false;
        const relleno = c.area / (c.w * c.h);
        return relleno > CUADRADO.rellenoMin && relleno < CUADRADO.rellenoMax;
    });
    if (cuadrados.length < 3) return null;

    const lados = cuadrados.map((c) => (c.w + c.h) / 2);
    const vistos = new Set();
    const grupos = [];
    for (const centro of lados) {
        const g = cuadrados.filter((_, i) => lados[i] >= centro / TOL_TAMANO && lados[i] <= centro * TOL_TAMANO);
        if (g.length < 3) continue;
        const firma = g.map((c) => `${c.x},${c.y}`).join("|");
        if (vistos.has(firma)) continue;
        vistos.add(firma);
        grupos.push(g);
    }
    if (!grupos.length) return null;

    const mayorPoblacion = Math.max(...grupos.map((g) => g.length));
    const candidatos = grupos
        .filter((g) => g.length >= mayorPoblacion * POBLACION_MIN)
        .sort((a, b) => b.length - a.length);
    for (const grupo of candidatos) {
        const lado = grupo.reduce((s, c) => s + (c.w + c.h) / 2, 0) / grupo.length;
        const sep = lado * 0.5;
        const { pitch: pasoX, positions: cols } = bestLattice(lanes(grupo.map((c) => c.x), sep), lado, zona.w);
        if (!pasoX || cols.length < MIN_COLS) continue;
        const enRetícula = grupo.filter((c) => {
            const k = Math.round((c.x - cols[0]) / pasoX);
            return Math.abs(c.x - cols[0] - k * pasoX) <= lado * 0.5;
        }).length;
        if (enRetícula < grupo.length * COBERTURA_MIN) continue;
        if (pasoX > lado * PASO_MAX || pasoX < lado * PASO_MIN) continue;
        const { positions: filas } = bestLattice(lanes(grupo.map((c) => c.y), sep), lado, zona.h);
        return { lado, paso: pasoX, cols: cols.length, filas: filas.length, anclas: grupo };
    }
    return null;
}
