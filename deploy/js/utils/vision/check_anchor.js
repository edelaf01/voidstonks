/**
 * La marca ✓ de las celdas como ancla de FASE de la rejilla del inventario.
 *
 * Cada celda con cantidad ≥ 2 lleva el mismo ✓ en la misma esquina (centro a 0,134·ancho y
 * 0,159·alto de la celda), del color del tema. Con tres o cuatro marcas en dos filas y dos
 * columnas se sabe exactamente dónde empiezan filas y columnas, sin perfiles de bordes ni
 * heurísticas de HUD. Medido en 44 páginas grabadas (780 celdas): se encuentra en 620 de 620
 * celdas con marca y no da ningún falso positivo con puntuación ≥ 0,6. Con 1 unidad la esquina
 * está vacía: por eso es ancla de fase y no de celda.
 */

// Media de 46 marcas de páginas a 1440p (celda de 296 px), canal máximo, a mitad de resolución:
// 16×16 con 16 niveles. Cubre un diámetro de ~29 px de celda.
export const PLANTILLA_CHECK = "110013567641001111028cca9cc92011013aa5322249b41103b810122101ac4008b200111005cea01b511000005dedc34b21431116dfd5a56a14ca327efd51977a14cda7ded511965c215ceeec5111a62c5015dec41113b318a2115b5111199002b8201211118b30003aa4112249b40000028bbabbb930000011126897200000";
export const CHECK_CELDA_REF = 296;      // alto de celda con el que se hizo la plantilla
export const CHECK_ESCALA_REF = 2;       // reducción con la que se hizo
export const CHECK_OFFSET = Object.freeze({ x: 37 / 277, y: 47 / 296 });
export const CHECK_UMBRAL = 0.6;
const LADO = 16;

const plantilla = (() => {
    const t = new Float32Array(LADO * LADO);
    let s = 0;
    for (let i = 0; i < t.length; i++) { t[i] = parseInt(PLANTILLA_CHECK[i], 16); s += t[i]; }
    const mu = s / t.length;
    let v = 0;
    for (let i = 0; i < t.length; i++) { t[i] -= mu; v += t[i] * t[i]; }
    const sd = Math.sqrt(v / t.length) || 1;
    for (let i = 0; i < t.length; i++) t[i] /= sd;
    return t;
})();

/** Canal máximo (el ✓ es del color del tema, no gris) de un ImageData, reducido por `f` (media de bloque). */
export function reduceMax(imageData, f, { y0 = 0, y1 = imageData.height } = {}) {
    const { width, data } = imageData;
    const fi = Math.max(1, Math.round(f));
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(imageData.height, Math.ceil(y1));
    const w = Math.floor(width / f), h = Math.max(0, Math.floor((y1 - y0) / f));
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let s = 0;
            for (let dy = 0; dy < fi; dy++) {
                let i = ((y0 + y * fi + dy) * width + x * fi) * 4;
                for (let dx = 0; dx < fi; dx++, i += 4) s += Math.max(data[i], data[i + 1], data[i + 2]);
            }
            out[y * w + x] = s / (fi * fi);
        }
    }
    return { data: out, w, h };
}

/**
 * Correlación normalizada de la plantilla sobre la imagen reducida; devuelve los picos por encima
 * del umbral con supresión de vecinos. Coordenadas: centro del ✓ en la imagen REDUCIDA.
 */
export function picosCheck(reducida, { umbral = CHECK_UMBRAL, separacion = 12, paso = 2 } = {}) {
    const { data, w, h } = reducida;
    const n = LADO * LADO;
    const score = (x, y) => {
        let s = 0, s2 = 0;
        for (let j = 0; j < LADO; j++) { let i = (y + j) * w + x; for (let k = 0; k < LADO; k++, i++) { s += data[i]; s2 += data[i] * data[i]; } }
        const mu = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mu * mu));
        if (sd < 4) return 0; // liso: ni texto ni marca
        let c = 0;
        for (let j = 0; j < LADO; j++) { let i = (y + j) * w + x; for (let k = 0; k < LADO; k++, i++) c += (data[i] - mu) * plantilla[j * LADO + k]; }
        return c / (n * sd);
    };
    // Barrido a `paso` píxeles (el ✓ mide 16: no se escapa) y afino a 1 px solo alrededor de lo que
    // pasa el listón: 4 veces menos correlaciones, 260 -> 70 ms por página a 1440p.
    const picos = [];
    for (let y = 0; y + LADO <= h; y += paso) {
        for (let x = 0; x + LADO <= w; x += paso) {
            if (score(x, y) < umbral * 0.85) continue;
            let mejor = { x, y, score: -1 };
            for (let dy = -paso + 1; dy < paso; dy++) for (let dx = -paso + 1; dx < paso; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx + LADO > w || yy + LADO > h) continue;
                const sc = score(xx, yy);
                if (sc > mejor.score) mejor = { x: xx, y: yy, score: sc };
            }
            if (mejor.score >= umbral) picos.push({ x: mejor.x + LADO / 2, y: mejor.y + LADO / 2, score: mejor.score });
        }
    }
    picos.sort((a, b) => b.score - a.score);
    const out = [];
    for (const p of picos) if (!out.some((q) => Math.abs(q.x - p.x) <= separacion && Math.abs(q.y - p.y) <= separacion)) out.push(p);
    return out;
}

/** Marcas ✓ de un recorte (ImageData de la zona de la rejilla), en coordenadas del recorte. */
export function buscaChecks(imageData, cellH, { ventanasY = null } = {}) {
    const f = CHECK_ESCALA_REF * cellH / CHECK_CELDA_REF;
    if (!(f >= 1)) return [];
    const fr = Math.max(1, Math.round(f));
    // Con rejilla propuesta se reduce y correla solo la franja de cada fila (±0,3 celda, más
    // el medio ✓ de margen): las franjas no se solapan, así que ningún pico sale dos veces.
    const franjas = ventanasY
        ? ventanasY.map(([a, b]) => [a - LADO / 2 * fr, b + LADO / 2 * fr]).filter(([a, b]) => b > 0 && a < imageData.height)
        : [[0, imageData.height]];
    const picos = [];
    for (const [y0, y1] of franjas) {
        const red = reduceMax(imageData, f, { y0, y1 });
        const desde = Math.max(0, Math.floor(y0));
        for (const p of picosCheck(red, { separacion: Math.round(LADO * 0.75) })) picos.push({ x: p.x * fr, y: p.y * fr + desde, score: p.score });
    }
    return picos.sort((a, b) => b.score - a.score);
}

/** Franjas (en coordenadas del recorte) donde caería el ✓ de cada fila de una rejilla propuesta, con una fila extra por si asoma. */
export function ventanasDeFilas({ gridY, cellH, rows }, zoneY = 0) {
    if (!Number.isFinite(gridY) || !cellH) return null;
    const out = [];
    for (let r = 0; r <= (rows || 3); r++) {
        const cy = gridY - zoneY + r * cellH + CHECK_OFFSET.y * cellH;
        out.push([cy - cellH * 0.3, cy + cellH * 0.3]);
    }
    return out;
}

/** Valor más votado módulo `paso`, con tolerancia; null si no llegan `minimo` votos de acuerdo. */
function faseMasVotada(valores, paso, tolerancia, minimo) {
    let mejor = null, mejorN = 0;
    for (const v of valores) {
        const n = valores.filter((u) => { const d = Math.abs(((u - v) % paso + paso * 1.5) % paso - paso / 2); return d <= tolerancia; }).length;
        if (n > mejorN) { mejorN = n; mejor = v; }
    }
    if (mejorN < minimo) return null;
    const cerca = valores.filter((u) => Math.abs(((u - mejor) % paso + paso * 1.5) % paso - paso / 2) <= tolerancia)
        .map((u) => mejor + (((u - mejor) % paso + paso * 1.5) % paso - paso / 2));
    cerca.sort((a, b) => a - b);
    const med = cerca[Math.floor(cerca.length / 2)];
    return { fase: ((med % paso) + paso) % paso, n: mejorN };
}

/**
 * Dónde empiezan filas y columnas según las marcas. `picos` en coordenadas del recorte de la zona.
 * @returns {{ gridX, gridY, n }|null} esquinas de la primera columna/fila (coordenadas del recorte),
 *          o null con menos de 3 marcas de acuerdo en cada eje.
 */
export function faseDesdeChecks(picos, { cellW, cellH, minimo = 3 } = {}) {
    if (!picos?.length || !cellW || !cellH) return null;
    const lefts = picos.map((p) => p.x - CHECK_OFFSET.x * cellW);
    const tops = picos.map((p) => p.y - CHECK_OFFSET.y * cellH);
    const fx = faseMasVotada(lefts, cellW, cellW * 0.06, minimo);
    const fy = faseMasVotada(tops, cellH, cellH * 0.06, minimo);
    if (!fx || !fy) return null;
    return { gridX: fx.fase, gridY: fy.fase, n: Math.min(fx.n, fy.n) };
}
