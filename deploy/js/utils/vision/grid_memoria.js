import { ASPECTO_CELDA } from "./grid_detect.js";
import { filasEnFase } from "./grid_alignment.js";

const PLANTILLAS = [[0.14, 0.645], [0.755, 0.92], [0.14, 0.92]];
const TOLERANCIA = 0.07;
const MIN_PUNTOS = 1;
const MAX_RIVAL = 0.75;
const MARGEN_GEOMETRIA = 0.08;
const BASE_NOMBRE = 0.92;
const FILAS_BUSQUEDA = 3;

const triangulo = (r, t) => Math.max(0, 1 - Math.abs(r - t) / TOLERANCIA);
const topDeCelda = (y, fase, cellH) => fase + Math.floor((y - fase) / cellH) * cellH;

function encaje(banda, fase, cellH) {
    const top = topDeCelda(banda.y0, fase, cellH);
    const r0 = (banda.y0 - top) / cellH, r1 = (banda.y1 - top) / cellH;
    return Math.max(...PLANTILLAS.map(([a, b]) => Math.min(triangulo(r0, a), triangulo(r1, b))));
}

export function faseDesdeBandas(bandas, cellH) {
    if (!bandas?.length || !(cellH > 0)) return null;
    const n = Math.round(cellH);
    const puntos = Array.from({ length: n }, (_, p) => bandas.reduce((s, b) => s + encaje(b, p, cellH), 0));
    const fase = puntos.indexOf(Math.max(...puntos));
    const rival = Math.max(0, ...puntos.filter((_, p) => Math.min(Math.abs(p - fase), n - Math.abs(p - fase)) > 0.15 * cellH));
    const buenas = bandas.filter((b) => encaje(b, fase, cellH) >= 0.5).length;
    return { fase, puntos: puntos[fase], rival, buenas };
}

function monta({ gridX, gridY, cellW, cellH, cols, rows }, img) {
    const gridW = Math.min(cols * cellW, img.width - gridX);
    const gridH = Math.min(rows * cellH, img.height - gridY);
    return {
        gridZone: { x: gridX, y: gridY, w: gridW, h: gridH },
        gridX, gridY, gridW, gridH, cellW, cellH, gapX: 0, gapY: 0, cols, rows,
        auto: true, confidence: Math.min(1, (rows + cols) / 10), deMemoria: true,
    };
}

export function rejillaDesdeMemoria(bandas, memoria, img, trace = {}) {
    const { cellW, cellH, cols, gridX } = memoria;
    const ajuste = faseDesdeBandas(bandas, cellH);
    trace.memoria = ajuste;
    if (!ajuste || ajuste.buenas < 2 || ajuste.puntos < MIN_PUNTOS || ajuste.rival > ajuste.puntos * MAX_RIVAL) return null;
    const tops = bandas.filter((b) => encaje(b, ajuste.fase, cellH) > 0)
        .map((b) => topDeCelda((b.y0 + b.y1) / 2, ajuste.fase, cellH))
        .filter((t) => t >= -cellH * 0.15 && t < img.height);
    if (!tops.length) return null;
    const gridY = Math.round(Math.min(...tops));
    const rows = Math.round((Math.max(...tops) - gridY) / cellH) + 1;
    return monta({ gridX, gridY, cellW, cellH, cols, rows }, img);
}

export function rejillaDeBusqueda(bandas, memoria, img, trace = {}) {
    const { cellW, cols, gridX } = memoria;
    const cellH = Math.round(cellW * ASPECTO_CELDA);
    const gridY = (bandas || []).map((b) => Math.round(b.y1 - cellH * BASE_NOMBRE)).find((t) => t >= -cellH * 0.15 && t <= cellH * 0.25);
    if (gridY === undefined || filasEnFase(bandas, { gridY: gridY + 2 * cellH, cellH, rows: 1 })) return null;
    const rows = Math.min(FILAS_BUSQUEDA, Math.floor((img.height - gridY) / cellH));
    if (rows < 2) return null;
    trace.memoria = { busqueda: true, gridY, cellH };
    return { ...monta({ gridX, gridY, cellW, cellH, cols, rows }, img), deBusqueda: true };
}

export function rejillaConMemoria(calib, trace, memoria, img, conBusqueda = false) {
    if (!memoria) return calib;
    const cerca = (a, b) => Math.abs(a - b) <= b * MARGEN_GEOMETRIA;
    const casa = !!calib && cerca(calib.cellW, memoria.cellW) && cerca(calib.cellH, memoria.cellH);
    if (conBusqueda && !(casa && calib.cols === memoria.cols)) {
        const deBusqueda = rejillaDeBusqueda(trace?.bands, memoria, img, trace);
        if (deBusqueda) return deBusqueda;
    }
    if (calib && !calib.colorAnchored && !calib.dosFilas) return calib;
    if (casa && (calib.dosFilas || calib.cols === memoria.cols)) return calib;
    return rejillaDesdeMemoria(trace?.bands, memoria, img, trace) || calib;
}

export function memoriaDeRejilla(calib) {
    if (!calib || calib.colorAnchored || calib.dosFilas || calib.deMemoria) return null;
    const esperado = calib.cellW * ASPECTO_CELDA;
    if (Math.abs(calib.cellH - esperado) > esperado * MARGEN_GEOMETRIA) return null;
    return { cellW: calib.cellW, cellH: calib.cellH, cols: calib.cols, gridX: calib.gridX };
}
