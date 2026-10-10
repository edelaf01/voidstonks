const PLANTILLAS = [[0.14, 0.645], [0.755, 0.92], [0.14, 0.92]];
const TOLERANCIA = 0.07;
const MIN_PUNTOS = 1;
const MAX_RIVAL = 0.75;
const MARGEN_GEOMETRIA = 0.08;

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
    const gridW = Math.min(cols * cellW, img.width - gridX);
    const gridH = Math.min(rows * cellH, img.height - gridY);
    return {
        gridZone: { x: gridX, y: gridY, w: gridW, h: gridH },
        gridX, gridY, gridW, gridH, cellW, cellH, gapX: 0, gapY: 0, cols, rows,
        auto: true, confidence: Math.min(1, (rows + cols) / 10), deMemoria: true,
    };
}

export function rejillaConMemoria(calib, trace, memoria, img) {
    if (!memoria || (calib && !calib.colorAnchored && !calib.dosFilas)) return calib;
    const cerca = (a, b) => Math.abs(a - b) <= b * MARGEN_GEOMETRIA;
    if (calib && cerca(calib.cellW, memoria.cellW) && cerca(calib.cellH, memoria.cellH) && (calib.dosFilas || calib.cols === memoria.cols)) return calib;
    return rejillaDesdeMemoria(trace?.bands, memoria, img, trace) || calib;
}

export function memoriaDeRejilla(calib) {
    if (!calib || calib.colorAnchored || calib.dosFilas || calib.deMemoria) return null;
    return { cellW: calib.cellW, cellH: calib.cellH, cols: calib.cols, gridX: calib.gridX };
}
