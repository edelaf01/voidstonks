/**
 * MISSION COMPLETE screen: first the rewards ZONE, then the cells that really hold something, and for each
 * cell whether it has a LABEL and what QUANTITY its badge shows. Pure over an ImageData-like
 * { data, width, height } (no DOM, testable offline with real captures).
 *
 * The signal is the ✓ the game paints in the corner of each reward: a square ring in the theme color, side
 * ~0.021·H, on an exact lattice. Not the cell rectangle: the gap between cells is too faint. Not
 * `detectInventoryGrid` either: here it merges the syndicates panel with the rewards one.
 */

import { WF_THEMES_VOTABLES } from "./wf_themes.js";
import { readBadgeDigits } from "./badge_digit_ocr.js";

/**
 * ✓ side as a fraction of the frame HEIGHT: the game scales the whole UI with height. The tolerance is wide
 * on purpose (stream rescaling warps it); the fill range is what tells the ✓ ring from solid letters.
 */
const CHECK_SIDE_FRAC = 0.0208;
const CHECK_SIDE_TOL = 0.30;
const CHECK_FILL_MIN = 0.28;
const CHECK_FILL_MAX = 0.52;
const GRUPOS_MAX = 4;   // ✓ groups tried before giving up

const ZONE = { x0: 0.42, y0: 0.12 };

/**
 * Chromaticity distance to the theme color for a "text" pixel. A list because they are tried in order until
 * one gives a lattice; today one is enough.
 */
const ACCENT_DIST = [0.36];

/** Below this luma a pixel is background, even if its hue matches the theme. */
const ACCENT_MIN_LUMA = 60;

/**
 * Theme color, measured on the screen TITLE: theme colored by definition and at a known spot, so it is the
 * pattern for everything else. Reading it from the image is what makes this work with any UI theme.
 *
 * @returns {[number,number,number]|null} mean RGB, or null when the strip has no text.
 */
export function estimateAccentColor(img, { todos = false, maxCandidatos = 4 } = {}) {
    const { data, width, height } = img;
    const x0 = Math.floor(width * 0.30), x1 = Math.floor(width * 0.70);
    const y0 = Math.floor(height * 0.02), y1 = Math.floor(height * 0.10);
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 8) return null;

    // LOCAL CONTRAST, not absolute color thresholds: a mission art tinting the screen dark red met "dark and
    // very saturated" and, being the MAJORITY of the strip, pulled the median to the tint. Text of any color
    // always stands out from what touches it, while the background tint varies smoothly
    const luma = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + y0) * width + (x + x0)) * 4;
            luma[y * w + x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
    }
    // summed area table: the mean of any window is 4 reads, so the radius costs nothing
    const suma = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            suma[(y + 1) * (w + 1) + x + 1] = luma[y * w + x]
                + suma[y * (w + 1) + x + 1] + suma[(y + 1) * (w + 1) + x] - suma[y * (w + 1) + x];
        }
    }
    const RADIO = 7;          // 15x15 window: wider than a stroke, narrower than a letter
    // how much a pixel must STAND OUT from its neighbourhood, in absolute value: lighter (the usual) or DARKER,
    // when the mission art is brighter than the text. The margin is RELATIVE to the strip contrast: a white
    // title on red gets 200 points, Tenno (luma 72) on its own tint gets 17
    const orden = Float32Array.from(luma).sort();
    const pct = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
    const MARGEN = Math.min(40, Math.max(12, (pct(0.99) - pct(0.5)) * 0.12));
    const rs = [], gs = [], bs = [], cs = [], xs = [];
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
            const total = suma[yb * (w + 1) + xb] - suma[ya * (w + 1) + xb]
                - suma[yb * (w + 1) + xa] + suma[ya * (w + 1) + xa];
            const media = total / ((yb - ya) * (xb - xa));
            const contraste = Math.abs(luma[y * w + x] - media);
            if (contraste <= MARGEN) continue;
            const i = ((y + y0) * width + (x + x0)) * 4;
            rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); cs.push(contraste); xs.push(x);
        }
    }
    if (rs.length < 50) return null;

    // of everything that stands out, the title is the only thing repeating an EXACT color: art edges have
    // contrast too, but each patch is a different color. Group by color (5 bits per channel), the largest
    // group wins, the median inside it
    const CUBO = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    // per group: pixel count and how WIDE it spreads across the strip. The title spans half the strip; an art
    // patch, however many pixels, fits in its own diameter
    const cuentas = new Map();
    for (let i = 0; i < rs.length; i++) {
        const k = CUBO(rs[i], gs[i], bs[i]);
        const g = cuentas.get(k) || { n: 0, xMin: Infinity, xMax: -Infinity };
        g.n++;
        if (xs[i] < g.xMin) g.xMin = xs[i];
        if (xs[i] > g.xMax) g.xMax = xs[i];
        cuentas.set(k, g);
    }
    // with contrast both ways the DARK side of each edge also enters: the flat background color repeated
    // thousands of times. So the background (the most repeated color of the strip) is found first and groups
    // close to it are left out
    const fondo = new Map();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + y0) * width + (x + x0)) * 4;
            const k = CUBO(data[i], data[i + 1], data[i + 2]);
            fondo.set(k, (fondo.get(k) || 0) + 1);
        }
    }
    let kFondo = 0, nFondo = -1;
    for (const [k, c] of fondo) if (c > nFondo) { nFondo = c; kFondo = k; }
    const canal = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    const [fR, fG, fB] = canal(kFondo);
    const esFondo = (k) => {
        const [r, g, b] = canal(k);
        return Math.abs(r - fR) + Math.abs(g - fG) + Math.abs(b - fB) < 60;
    };
    // several candidates: a gradient art has a family of background colors whose middle tones get ahead of the
    // title. Geometry decides
    const ANCHO_MIN = w * 0.2;
    const anchos = [...cuentas].filter(([k, g]) => !esFondo(k) && g.xMax - g.xMin >= ANCHO_MIN);
    const sueltos = [...cuentas].filter(([k]) => !esFondo(k));
    const finalistas = (anchos.length ? anchos : sueltos).sort((a, b) => b[1].n - a[1].n).slice(0, maxCandidatos);
    if (!finalistas.length) return null;

    const mediana = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };
    const colores = finalistas.map(([k]) => {
        const dentro = { r: [], g: [], b: [] };
        for (let i = 0; i < rs.length; i++) {
            if (CUBO(rs[i], gs[i], bs[i]) !== k) continue;
            dentro.r.push(rs[i]); dentro.g.push(gs[i]); dentro.b.push(bs[i]);
        }
        // median inside the group: absorbs the antialiased edge without shifting the hue
        return [mediana(dentro.r), mediana(dentro.g), mediana(dentro.b)];
    });
    // catalog rescue: dark text on a dark background leaves the title group tiny and out of the finalists (Tenno)
    if (todos) {
        for (const t of temasPresentes(rs, gs, bs)) {
            if (colores.some((c) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]) < 60)) continue;
            colores.push(t);
        }
    }
    return todos ? colores : colores[0];
}

/** Known themes really present among the pixels that stand out, most to least. */
function temasPresentes(rs, gs, bs) {
    const votos = new Map();
    for (let i = 0; i < rs.length; i++) {
        let mejor = -1, dMin = 60;
        for (let t = 0; t < WF_THEMES_VOTABLES.length; t++) {
            const { r, g, b } = WF_THEMES_VOTABLES[t];
            const d = Math.abs(rs[i] - r) + Math.abs(gs[i] - g) + Math.abs(bs[i] - b);
            if (d < dMin) { dMin = d; mejor = t; }
        }
        if (mejor >= 0) votos.set(mejor, (votos.get(mejor) || 0) + 1);
    }
    return [...votos].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([t]) => [WF_THEMES_VOTABLES[t].r, WF_THEMES_VOTABLES[t].g, WF_THEMES_VOTABLES[t].b]);
}


/**
 * Mask of theme colored pixels inside a rect. Compares CHROMATICITY (color normalized by its own luma), not
 * RGB distance, so the antialiased edge counts like the lit part of the stroke.
 *
 * The rect is CLIPPED to the frame first: a rect past the right edge would wrap into the next row and
 * silently return ink from other pixels. The real size comes back in `w`/`h`.
 * @returns {{mask: Uint8Array, w: number, h: number, ox: number, oy: number}}
 */
export function accentMask(img, accent, rect, dist = ACCENT_DIST[0]) {
    const { data, width, height } = img;
    const ox = Math.max(0, rect.x), oy = Math.max(0, rect.y);
    const w = Math.max(0, Math.min(rect.x + rect.w, width) - ox);
    const h = Math.max(0, Math.min(rect.y + rect.h, height) - oy);
    const accLum = (accent[0] + accent[1] + accent[2]) / 3 || 1;
    const ar = accent[0] / accLum, ag = accent[1] / accLum, ab = accent[2] / accLum;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + oy) * width + (x + ox)) * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const lum = (R + G + B) / 3;
            if (lum <= ACCENT_MIN_LUMA) continue;
            const dr = R / lum - ar, dg = G / lum - ag, db = B / lum - ab;
            if (Math.sqrt(dr * dr + dg * dg + db * db) < dist) mask[y * w + x] = 1;
        }
    }
    return { mask, w, h, ox, oy };
}

/**
 * Connected components (4-neighbourhood) of a mask, with box and area. Explicit stack: recursion overflows
 * on large tinted background patches.
 */
export function connectedComponents({ mask, w, h }) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        let sp = 0;
        stack[sp++] = start;
        seen[start] = 1;
        let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
        while (sp > 0) {
            const p = stack[--sp];
            const px = p % w, py = (p - px) / w;
            area++;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
            if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
            if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
            if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
            if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
        }
        const cw = maxX - minX + 1, ch = maxY - minY + 1;
        // density of the central 40%: a ✓ is a RING and has almost nothing there, whatever the stroke width
        const cx0 = minX + Math.round(cw * 0.3), cx1 = maxX - Math.round(cw * 0.3);
        const cy0 = minY + Math.round(ch * 0.3), cy1 = maxY - Math.round(ch * 0.3);
        let dentro = 0, celdas = 0;
        for (let yy = cy0; yy <= cy1; yy++) {
            for (let xx = cx0; xx <= cx1; xx++) { celdas++; if (mask[yy * w + xx]) dentro++; }
        }
        out.push({ x: minX, y: minY, w: cw, h: ch, area, centro: celdas ? dentro / celdas : 1 });
    }
    return out;
}

/** Groups coordinates into lanes more than `sep` apart, with their member count. */
export function lanes(values, sep) {
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const out = [];
    let cur = [sorted[0]];
    for (const v of sorted.slice(1)) {
        if (v - cur[cur.length - 1] <= sep) cur.push(v);
        else { out.push(cur); cur = [v]; }
    }
    out.push(cur);
    return out.map((g) => ({ pos: Math.round(median(g)), members: g.length }));
}

function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Lattice that best explains the lanes: every distance between two lanes is tried as the step, scored by ✓
 * explained MINUS the empty positions it leaves inside the span. The gap penalty is what keeps the HALF step,
 * which explains the same lanes plus any ghost in between, from winning.
 * @returns {{pitch: number|null, positions: number[]}}
 */
export function bestLattice(laneList, minPitch, span) {
    if (laneList.length < 2) return { pitch: null, positions: laneList.map((l) => l.pos) };
    const pos = laneList.map((l) => l.pos);
    const cands = new Set();
    for (const a of pos) for (const b of pos) {
        const d = Math.abs(b - a);
        if (d >= minPitch * 2 && d <= span) cands.add(d);
    }
    const tol = Math.max(2, minPitch * 0.4);
    let best = { score: -Infinity, pitch: null, positions: [] };
    for (const pitch of [...cands].sort((a, b) => a - b)) {
        for (const origin of pos) {
            const on = laneList.filter((l) => {
                const k = (l.pos - origin) / pitch;
                return Math.abs(l.pos - origin - Math.round(k) * pitch) <= tol;
            });
            if (on.length < 2) continue;
            const lo = Math.min(...on.map((l) => l.pos));
            const hi = Math.max(...on.map((l) => l.pos));
            const slots = Math.round((hi - lo) / pitch) + 1;
            const hits = on.reduce((s, l) => s + l.members, 0);
            const score = hits - 1.5 * (slots - on.length);
            if (score > best.score || (score === best.score && pitch > best.pitch)) {
                best = { score, pitch, positions: on.map((l) => l.pos) };
            }
        }
    }
    return best.pitch ? { pitch: best.pitch, positions: best.positions } : { pitch: null, positions: pos };
}

/**
 * Narrows the rewards screen and returns the OCCUPIED cells.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img  full frame
 * @param {{trace?: object, accent?: number[]}} [opts]
 * @returns {{zone, pitch, cells, occluded, accent}|null}
 *   `cells` are {x, y, w, h, col, row, named, qty} in frame pixels, ready to crop. `occluded` warns that
 *   something covers the panel (see `hasGap`).
 */
export function detectRewardCells(img, opts = {}) {
    const trace = opts.trace || {};
    const candidatos = opts.accent ? [opts.accent] : (estimateAccentColor(img, { todos: true }) || []);
    if (!candidatos.length) { trace.fail = "sin color de tema en el título"; return null; }
    // the best, not the first: a wrong color lets one stray cell through and that answer hid the good one of four
    let mejor = null, primerFallo = null;
    for (const color of candidatos) {
        const parcial = {};
        const res = _conAcento(img, color, parcial);
        if (res && (!mejor || res.cells.length > mejor.res.cells.length)) mejor = { res, parcial };
        primerFallo ||= parcial.fail;
    }
    if (!mejor) { trace.fail = primerFallo || "sin color de tema en el título"; return null; }
    Object.assign(trace, mejor.parcial);
    return mejor.res;
}

/** Block of consecutive rows (gap <= 1.6 steps) with the most ✓; the rest are ghosts. */
function compactRows(rows, pitch, checks, sep) {
    const orden = [...rows].sort((a, b) => a - b);
    if (orden.length < 2) return orden;
    const bloques = [[orden[0]]];
    for (let i = 1; i < orden.length; i++) {
        if (orden[i] - orden[i - 1] <= pitch * 1.6) bloques.at(-1).push(orden[i]);
        else bloques.push([orden[i]]);
    }
    const peso = (b) => checks.filter((c) => b.some((r) => Math.abs(c.y - r) <= sep)).length;
    return bloques.reduce((a, b) => (peso(b) > peso(a) ? b : a));
}

/** One try with a given color; null when that color gives no lattice. */
function _conAcento(img, accent, trace) {
    for (const dist of ACCENT_DIST) {
        const parcial = {};
        const res = _conTolerancia(img, accent, dist, parcial);
        if (res) { Object.assign(trace, parcial); return res; }
        trace.fail ||= parcial.fail;
    }
    return null;
}

function _conTolerancia(img, accent, dist, trace) {
    const { width, height } = img;
    trace.accent = accent.map(Math.round);
    trace.dist = dist;

    const zx = Math.floor(width * ZONE.x0), zy = Math.floor(height * ZONE.y0);
    const zone = { x: zx, y: zy, w: width - zx, h: height - zy };

    // the ✓ inside the zone. Not described by thresholds (size, fill and squareness change with resolution and
    // JPEG eats them): groups of components ALIKE TO EACH OTHER, which is what a ✓ is, N copies of one glyph
    const comps = connectedComponents(accentMask(img, accent, zone, dist));

    // on a clean capture the ✓ is recognized by shape; the grouping below only kicks in when that finds
    // nothing, as soon as the image is recompressed: the glyph warps but STILL repeats the same
    const porForma = comps.filter((c) => {
        const S = height * CHECK_SIDE_FRAC;
        if (Math.abs(c.w - S) >= S * CHECK_SIDE_TOL || Math.abs(c.h - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, S * 0.12)) return false;
        const fill = c.area / (c.w * c.h);
        return fill > CHECK_FILL_MIN && fill < CHECK_FILL_MAX;
    });
    if (porForma.length >= 4) {
        const parcial = {};
        const res = _conGrupo(img, accent, zone, porForma, parcial, height * CHECK_SIDE_FRAC, dist);
        if (res) { Object.assign(trace, parcial); return res; }
    }

    let mejor = null;
    for (const grupo of gruposSemejantes(comps, height)) {
        const parcial = {};
        const res = _conGrupo(img, accent, zone, grupo, parcial, median(grupo.map((c) => (c.w + c.h) / 2)), dist);
        if (res && (!mejor || res.cells.length > mejor.res.cells.length)) mejor = { res, parcial };
    }
    if (!mejor) { trace.fail ||= `solo ${porForma.length} ✓ (<4)`; return null; }
    Object.assign(trace, mejor.parcial);
    return mejor.res;
}

/**
 * Groups of same size components, largest first. The size comes from the data, not from a fraction of the
 * height, so the capture resolution does not matter.
 */
function gruposSemejantes(comps, height) {
    const posibles = comps.filter((c) => c.w >= 5 && c.h >= 5
        && c.w <= height * 0.06 && c.h <= height * 0.06
        && c.w / c.h > 0.6 && c.w / c.h < 1.7);
    // besides size, the glyph FOOTPRINT: how much of its box it fills and the density of its central 40%. The ✓
    // of one screen repeat it exactly; letters vary a lot
    const relleno = (c) => c.area / (c.w * c.h);
    const usados = new Set();
    const grupos = [];
    for (const semilla of posibles.sort((a, b) => b.area - a.area)) {
        if (usados.has(semilla)) continue;
        const g = posibles.filter((c) => !usados.has(c)
            && Math.abs(c.w - semilla.w) <= semilla.w * 0.25
            && Math.abs(c.h - semilla.h) <= semilla.h * 0.25
            && Math.abs(relleno(c) - relleno(semilla)) <= 0.08
            && Math.abs(c.centro - semilla.centro) <= 0.12);
        if (g.length < 4) continue;
        for (const c of g) usados.add(c);
        grupos.push(g);
    }
    return grupos.sort((a, b) => b.length - a.length).slice(0, GRUPOS_MAX);
}

/**
 * Is the panel scrolled with a reward row cut at the top? The first ✓ row always falls in the same place, so
 * seeing it lower means something is missing above. A scroll of one EXACT row is not caught: it is
 * indistinguishable from a full panel.
 */
const PRIMERA_FILA_FRAC = 0.243;

function filaCortadaArriba(cells, pitch, height) {
    const yPrimera = Math.min(...cells.map((c) => c.y));
    return yPrimera > height * PRIMERA_FILA_FRAC + pitch * 0.25;
}

/** The lattice a group of candidate ✓ explains; null when it explains none. */
function _conGrupo(img, accent, zone, checks, trace, S, dist) {
    const { width, height } = img;
    trace.candidates = checks.length;

    // CELLS: the lattice explaining those ✓. Whatever falls off it is dropped: the search icon, the IMPORTANCE
    // letters and the ✓ of the "N OWNED" tooltip floating over the panel
    const sep = S * 0.5;
    const rowLanes = lanes(checks.map((c) => c.y), sep);
    const colLanes = lanes(checks.map((c) => c.x), sep);
    const { pitch: pitchY, positions: rows } = bestLattice(rowLanes, S, height);
    const { pitch: pitchX, positions: cols } = bestLattice(colLanes, S, width);
    if (!pitchX) { trace.fail = "sin retícula en X"; return null; }
    // cells are square; a very different vertical step means the row lattice leaned on ghosts, so the column
    // one rules (more lanes)
    const pitch = (!pitchY || Math.abs(pitchY - pitchX) > pitchX * 0.15) ? pitchX : Math.round((pitchX + pitchY) / 2);

    // a stray ✓ in the bottom HUD opened a ghost row mid screen, and with it an invented fifth cell
    const filas = compactRows(rows, pitch, checks, sep);
    const onGrid = checks.filter((c) =>
        filas.some((r) => Math.abs(c.y - r) <= sep) && cols.some((x) => Math.abs(c.x - x) <= sep));

    // each ✓ to its cell; the ✓ sits in the top left corner, slightly inset
    const inset = Math.round(S * 0.4);
    // an empty column can be covered by the tooltip; an empty row cannot, and it shifts the row index of the
    // cells that do exist
    const conCelda = filas.filter((r) => onGrid.some((c) => Math.abs(c.y - r) <= sep));
    const sortedRows = [...(conCelda.length ? conCelda : filas)].sort((a, b) => a - b);
    const sortedCols = [...cols].sort((a, b) => a - b);
    const cells = onGrid.map((c) => {
        const row = nearestIndex(sortedRows, c.y);
        const col = nearestIndex(sortedCols, c.x);
        return {
            x: zone.x + sortedCols[col] - inset,
            y: zone.y + sortedRows[row] - inset,
            w: pitch, h: pitch, col, row,
        };
    });
    // two ✓ in the same lane can be one (ring split by antialiasing)
    const unique = [...new Map(cells.map((c) => [`${c.row}:${c.col}`, c])).values()]
        .sort((a, b) => a.row - b.row || a.col - b.col);

    // each cell comes out described (label and badge quantity) here: pixel work on the SAME image and theme
    // color already at hand
    for (const cell of unique) {
        cell.named = classifyRewardCell(img, accent, cell, dist).kind === "NAMED";
        cell.qty = cell.named ? readRewardQty(img, accent, cell, dist) : 1;
    }

    trace.cols = sortedCols.length;
    trace.rows = sortedRows.length;
    trace.pitch = pitch;
    trace.cells = unique.length;

    const cortada = filaCortadaArriba(unique, pitch, height);
    const occluded = hasGap(unique, sortedCols.length) || cortada;
    trace.occluded = occluded;
    trace.cut = cortada;

    return { zone, pitch, cells: unique, occluded, accent, dist };
}

function nearestIndex(sorted, value) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < sorted.length; i++) {
        const d = Math.abs(sorted[i] - value);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/**
 * Is a cell missing BEFORE the last occupied one? The game fills the panel in order and leaves the gaps at
 * the end, so a gap in the middle cannot be an empty cell: something covers it (a tooltip).
 */
export function hasGap(cells, cols) {
    if (!cells.length || !cols) return false;
    const idx = cells.map((c) => c.row * cols + c.col).sort((a, b) => a - b);
    const last = idx[idx.length - 1];
    return idx.length < last + 1;
}

/**
 * Bottom strip of the cell where the game prints the LABEL. Starts at 0.66 because three line names
 * ("Revenant Prime Neuroptics Blueprint") start there.
 */
const NAME_BAND_TOP = 0.66;

/**
 * Theme colored ink in that strip from which the cell has a label. Cells with a name and without one are
 * far apart, so there is nothing to tune.
 */
const NAME_INK_MIN = 0.012;

/**
 * Is the name printed UNDER the icon? MOD cards print it INSIDE the card, in white, which the theme mask
 * does not see. Telling them apart before Tesseract saves an OCR per cell and keeps the card art from
 * faking a catalog match.
 *
 * It returns "has a label" and not "is a mod": a hovered label turns red and stops matching the theme too,
 * but those frames are dropped whole by `occluded` before getting here.
 * @returns {{kind: "NAMED"|"UNNAMED", ink: number}}
 */
export function classifyRewardCell(img, accent, cell, dist) {
    const top = Math.round(cell.h * NAME_BAND_TOP);
    const { mask } = accentMask(img, accent, {
        x: cell.x, y: cell.y + top, w: cell.w, h: cell.h - top,
    }, dist);
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    // empty mask = the cell is fully off the frame; without the guard it would give NaN
    const ink = mask.length ? n / mask.length : 0;
    return { kind: ink >= NAME_INK_MIN ? "NAMED" : "UNNAMED", ink };
}

/**
 * Quantity badge crop: top left corner of the cell. The height has a narrow window on both sides: below
 * 0.16·cell the crop CUTS the digits, above 0.21 the digit falls under the 40% of the crop height
 * `segmentDigits` needs.
 */
const BADGE_W = 0.75;
const BADGE_H = 0.175;

/**
 * Quantity badge digits of a cell, or "" with no number (a single unit reward shows only the ✓). The ✓ and
 * the thousands comma drop on their own: the ring looks like no digit and the comma does not reach 40% of
 * the height.
 */
export function readRewardBadge(img, accent, cell, dist) {
    const { mask, w, h } = accentMask(img, accent, {
        x: cell.x, y: cell.y, w: Math.round(cell.w * BADGE_W), h: Math.round(cell.h * BADGE_H),
    }, dist);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i] ? 0 : 255; // BLACK digits on white: what readBadgeDigits expects
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
    }
    return readBadgeDigits({ data, width: w, height: h });
}

/**
 * Units the badge of a cell shows, as a number. An endless fissure gives the SAME part several times.
 * Capped at 20: above that it is a bad badge read, and when in doubt counting 1 beats inflating the
 * inventory.
 */
export function readRewardQty(img, accent, cell, dist) {
    const n = Number.parseInt(readRewardBadge(img, accent, cell, dist), 10);
    return Number.isFinite(n) && n >= 2 && n <= 20 ? n : 1;
}
