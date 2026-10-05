// locates inventory grid rows and columns using the cells' ✓ marks as phase anchor

export const PLANTILLA_CHECK = "110013567641001111028cca9cc92011013aa5322249b41103b810122101ac4008b200111005cea01b511000005dedc34b21431116dfd5a56a14ca327efd51977a14cda7ded511965c215ceeec5111a62c5015dec41113b318a2115b5111199002b8201211118b30003aa4112249b40000028bbabbb930000011126897200000";
export const CHECK_CELDA_REF = 296;
export const CHECK_ESCALA_REF = 2;
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

export function reduceMax(imageData, f, { y0 = 0, y1 = imageData.height } = {}) {
    const { width, data } = imageData;
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(imageData.height, Math.ceil(y1));
    const w = Math.floor(width / f), h = Math.max(0, Math.floor((y1 - y0) / f));
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const ya = y0 + Math.floor(y * f), yb = Math.max(ya + 1, y0 + Math.floor((y + 1) * f));
        for (let x = 0; x < w; x++) {
            const xa = Math.floor(x * f), xb = Math.max(xa + 1, Math.floor((x + 1) * f));
            let s = 0;
            for (let yy = ya; yy < yb; yy++) {
                let i = (yy * width + xa) * 4;
                for (let xx = xa; xx < xb; xx++, i += 4) s += Math.max(data[i], data[i + 1], data[i + 2]);
            }
            out[y * w + x] = s / ((yb - ya) * (xb - xa));
        }
    }
    return { data: out, w, h };
}

export function picosCheck(reducida, { umbral = CHECK_UMBRAL, separacion = 12, paso = 2 } = {}) {
    const { data, w, h } = reducida;
    const n = LADO * LADO;
    const score = (x, y) => {
        let s = 0, s2 = 0;
        for (let j = 0; j < LADO; j++) { let i = (y + j) * w + x; for (let k = 0; k < LADO; k++, i++) { s += data[i]; s2 += data[i] * data[i]; } }
        const mu = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mu * mu));
        if (sd < 4) return 0;
        let c = 0;
        for (let j = 0; j < LADO; j++) { let i = (y + j) * w + x; for (let k = 0; k < LADO; k++, i++) c += (data[i] - mu) * plantilla[j * LADO + k]; }
        return c / (n * sd);
    };
    // sweep every paso px (the ✓ is 16, cannot slip through) and refine to 1 px around peaks
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

export function buscaChecks(imageData, cellH, { ventanasY = null } = {}) {
    const f = CHECK_ESCALA_REF * cellH / CHECK_CELDA_REF;
    if (!(f >= 1)) return [];
    const franjas = ventanasY
        ? ventanasY.map(([a, b]) => [a - LADO / 2 * f, b + LADO / 2 * f]).filter(([a, b]) => b > 0 && a < imageData.height)
        : [[0, imageData.height]];
    const picos = [];
    for (const [y0, y1] of franjas) {
        const red = reduceMax(imageData, f, { y0, y1 });
        const desde = Math.max(0, Math.floor(y0));
        for (const p of picosCheck(red, { separacion: Math.round(LADO * 0.75) })) picos.push({ x: p.x * f, y: p.y * f + desde, score: p.score });
    }
    return picos.sort((a, b) => b.score - a.score);
}

export function ventanasDeFilas({ gridY, cellH, rows }, zoneY = 0) {
    if (!Number.isFinite(gridY) || !cellH) return null;
    const out = [];
    for (let r = 0; r <= (rows || 3); r++) {
        const cy = gridY - zoneY + r * cellH + CHECK_OFFSET.y * cellH;
        out.push([cy - cellH * 0.3, cy + cellH * 0.3]);
    }
    return out;
}

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

export function faseDesdeChecks(picos, { cellW, cellH, minimo = 3 } = {}) {
    if (!picos?.length || !cellW || !cellH) return null;
    const lefts = picos.map((p) => p.x - CHECK_OFFSET.x * cellW);
    const tops = picos.map((p) => p.y - CHECK_OFFSET.y * cellH);
    const fx = faseMasVotada(lefts, cellW, cellW * 0.06, minimo);
    const fy = faseMasVotada(tops, cellH, cellH * 0.06, minimo);
    if (!fx || !fy) return null;
    return { gridX: fx.fase, gridY: fy.fase, n: Math.min(fx.n, fy.n) };
}
