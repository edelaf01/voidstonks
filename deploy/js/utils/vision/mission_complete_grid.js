// detects reward cells, labels and quantity badges on the mission complete screen

import { readBadgeDigits } from "./badge_digit_ocr.js";

const CHECK_SIDE_FRAC = 0.0208;

const CHECK_SIDE_TOL = 0.30;

const CHECK_FILL_MIN = 0.28;
const CHECK_FILL_MAX = 0.52;

const ZONE = { x0: 0.42, y0: 0.12 };

const ACCENT_DIST = 0.28;

const ACCENT_MIN_LUMA = 60;

export function estimateAccentColor(img) {
    const { data, width, height } = img;
    const x0 = Math.floor(width * 0.30), x1 = Math.floor(width * 0.70);
    const y0 = Math.floor(height * 0.02), y1 = Math.floor(height * 0.10);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            if (mx > 110 && mx - mn > 40) { r += R; g += G; b += B; n++; }
        }
    }
    return n < 50 ? null : [r / n, g / n, b / n];
}

export function accentMask(img, accent, rect) {
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
            if (Math.sqrt(dr * dr + dg * dg + db * db) < ACCENT_DIST) mask[y * w + x] = 1;
        }
    }
    return { mask, w, h, ox, oy };
}

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
        out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
    return out;
}

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

export function detectRewardCells(img, opts = {}) {
    const trace = opts.trace || {};
    const { width, height } = img;

    const accent = opts.accent || estimateAccentColor(img);
    if (!accent) { trace.fail = "sin color de tema en el título"; return null; }
    trace.accent = accent.map(Math.round);

    const zx = Math.floor(width * ZONE.x0), zy = Math.floor(height * ZONE.y0);
    const zone = { x: zx, y: zy, w: width - zx, h: height - zy };

    const S = height * CHECK_SIDE_FRAC;
    const comps = connectedComponents(accentMask(img, accent, zone));
    const checks = comps.filter((c) => {
        if (Math.abs(c.w - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.h - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, S * 0.12)) return false;
        const fill = c.area / (c.w * c.h);
        return fill > CHECK_FILL_MIN && fill < CHECK_FILL_MAX;
    });
    trace.candidates = checks.length;
    if (checks.length < 4) { trace.fail = `solo ${checks.length} ✓ (<4)`; return null; }

    const sep = S * 0.5;
    const rowLanes = lanes(checks.map((c) => c.y), sep);
    const colLanes = lanes(checks.map((c) => c.x), sep);
    const { pitch: pitchY, positions: rows } = bestLattice(rowLanes, S, height);
    const { pitch: pitchX, positions: cols } = bestLattice(colLanes, S, width);
    if (!pitchX) { trace.fail = "sin retícula en X"; return null; }
    const pitch = (!pitchY || Math.abs(pitchY - pitchX) > pitchX * 0.15) ? pitchX : Math.round((pitchX + pitchY) / 2);

    const onGrid = checks.filter((c) =>
        rows.some((r) => Math.abs(c.y - r) <= sep) && cols.some((x) => Math.abs(c.x - x) <= sep));

    const inset = Math.round(S * 0.4);
    const sortedRows = [...rows].sort((a, b) => a - b);
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
    const unique = [...new Map(cells.map((c) => [`${c.row}:${c.col}`, c])).values()]
        .sort((a, b) => a.row - b.row || a.col - b.col);

    for (const cell of unique) {
        cell.named = classifyRewardCell(img, accent, cell).kind === "NAMED";
        cell.qty = cell.named ? readRewardQty(img, accent, cell) : 1;
    }

    trace.cols = sortedCols.length;
    trace.rows = sortedRows.length;
    trace.pitch = pitch;
    trace.cells = unique.length;

    const occluded = hasGap(unique, sortedCols.length);
    trace.occluded = occluded;

    return { zone, pitch, cells: unique, occluded, accent };
}

function nearestIndex(sorted, value) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < sorted.length; i++) {
        const d = Math.abs(sorted[i] - value);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// game fills cells in order, so a gap in the middle means a tooltip covers it
export function hasGap(cells, cols) {
    if (!cells.length || !cols) return false;
    const idx = cells.map((c) => c.row * cols + c.col).sort((a, b) => a - b);
    const last = idx[idx.length - 1];
    return idx.length < last + 1;
}

// starts at 0.66 because three line names start there
const NAME_BAND_TOP = 0.66;

const NAME_INK_MIN = 0.012;

export function classifyRewardCell(img, accent, cell) {
    const top = Math.round(cell.h * NAME_BAND_TOP);
    const { mask } = accentMask(img, accent, {
        x: cell.x, y: cell.y + top, w: cell.w, h: cell.h - top,
    });
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    const ink = mask.length ? n / mask.length : 0;
    return { kind: ink >= NAME_INK_MIN ? "NAMED" : "UNNAMED", ink };
}

const BADGE_W = 0.75;
const BADGE_H = 0.175;

export function readRewardBadge(img, accent, cell) {
    const { mask, w, h } = accentMask(img, accent, {
        x: cell.x, y: cell.y, w: Math.round(cell.w * BADGE_W), h: Math.round(cell.h * BADGE_H),
    });
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i] ? 0 : 255;
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
    }
    return readBadgeDigits({ data, width: w, height: h });
}

export function readRewardQty(img, accent, cell) {
    const n = Number.parseInt(readRewardBadge(img, accent, cell), 10);
    return Number.isFinite(n) && n >= 2 && n <= 20 ? n : 1;
}
