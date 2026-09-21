/**
 * Inventory grid autodetection, no manual calibration. Pure over an ImageData-like { data, width, height }
 * (no DOM, testable in Node).
 *
 * Item NAMES are text on a fixed band of each card: 3 horizontal bands with pitch cellH (rows) and, inside
 * each, text blocks with pitch cellW (columns). Quantity badges are tiny next to them and drop by band mass.
 * The result has the same format as the saved manual calibration (gridZone + cellW/cellH/cols/rows).
 *
 * The signal is edge density by |Δluma| between neighbour samples, not an absolute brightness threshold:
 * light Warframe themes push the whole background over any threshold, while a letter stroke makes an edge
 * both light on dark and dark on light.
 */

import { filasConNombre } from "./grid_alignment.js";

/** Perceptual luma (0..255), base of the edge signal. */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Luma of a scanline smoothed with a box filter of `radius`: averages per-pixel noise without erasing
 * stroke edges. Returns Float32Array(width).
 */
export function smoothedLumaRow(data, off, width, radius) {
    const raw = new Float32Array(width);
    for (let x = 0; x < width; x++) {
        const i = off + x * 4;
        raw[x] = luma(data[i], data[i + 1], data[i + 2]);
    }
    if (radius <= 0) return raw;
    const out = new Float32Array(width);
    let sum = 0;
    for (let x = 0; x <= radius && x < width; x++) sum += raw[x];
    let count = Math.min(radius, width - 1) + 1;
    for (let x = 0; x < width; x++) {
        out[x] = sum / count;
        const add = x + radius + 1, rem = x - radius;
        if (add < width) { sum += raw[add]; count++; }
        if (rem >= 0) { sum -= raw[rem]; count--; }
    }
    return out;
}

const DEFAULTS = {
    edgeDelta: 26,       // |Δluma| between neighbour samples that counts as a stroke edge
    edgeSmooth: 0,       // anti-noise box filter radius; 0 = no smoothing
    bgDistSq: 70 * 70,     // min dist² to the background color for an "ink" pixel
    mergeColSq: 45 * 45,   // merges candidate colors closer than this (antialias/compression)
    nameTolSq: 80 * 80,    // dist² to the name color (metallic art sits beyond 110)
    maxInkCands: 4,        // max name color candidates to try
    strideX: 2,          // horizontal sampling for the row profile
    minBandH: 6,         // px: lower bands are noise
    maxBandHFrac: 0.25,  // taller than 25% of the image = background/art, not text
    mergeGapYFrac: 0.0085, // of the height: joins the 2 lines of a name; in fixed px it loosens when rescaling
    bandMassFloor: 0.22, // min mass relative to the strongest band (drops badges/HUD)
    nameBandOffset: 0.75, // cell top ≈ name band top − 0.75·cellH
    nameBaselineOffset: 0.92, // cell top ≈ name BASELINE (y1) − 0.92·cellH
    rows: 3,             // Warframe's inventory always shows 3 rows
    minCols: 3,
    maxCols: 12,
};

/**
 * Row "text" profile: number of EDGES (large |Δluma|) per scanline. Text has dozens per line, a metallic
 * art highlight is a solid block with ~2.
 */
export function rowProfile(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const prof = new Float32Array(height);
    // color signal: with a name color mask the row profile counts name color pixels, not edges
    if (o.inkMask) {
        const mask = o.inkMask;
        for (let y = 0; y < height; y++) {
            let cnt = 0;
            const rowOff = y * width;
            for (let x = 0; x < width; x += o.strideX) cnt += mask[rowOff + x];
            prof[y] = cnt;
        }
        return prof;
    }
    for (let y = 0; y < height; y++) {
        let cnt = 0;
        let inEdge = false;
        const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
        let prevL = sm[0];
        for (let x = o.strideX; x < width; x += o.strideX) {
            const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
            if (edge && !inEdge) cnt++;
            inEdge = edge;
            prevL = sm[x];
        }
        prof[y] = cnt;
    }
    return prof;
}

/**
 * Horizontal text bands in the row profile: [{ y0, y1, mass }] sorted by y.
 */
export function findBands(prof, height, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    let maxV = 0;
    for (let y = 0; y < height; y++) if (prof[y] > maxV) maxV = prof[y];
    if (maxV < 4) return [];
    const thr = Math.max(3, maxV * 0.10);

    const runs = [];
    let start = -1;
    for (let y = 0; y <= height; y++) {
        const on = y < height && prof[y] >= thr;
        if (on && start < 0) start = y;
        else if (!on && start >= 0) {
            runs.push({ y0: start, y1: y - 1 });
            start = -1;
        }
    }

    // joins lines of the same name (2 line names)
    const merged = [];
    for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && r.y0 - last.y1 <= Math.max(4, Math.round(height * o.mergeGapYFrac))) last.y1 = r.y1;
        else merged.push({ ...r });
    }

    const bands = [];
    for (const b of merged) {
        const h = b.y1 - b.y0 + 1;
        if (h < o.minBandH || h > height * o.maxBandHFrac) continue;
        let mass = 0;
        for (let y = b.y0; y <= b.y1; y++) mass += prof[y];
        bands.push({ y0: b.y0, y1: b.y1, mass });
    }
    if (!bands.length) return bands;

    // drops weak bands (quantity badges, HUD leftovers) against the strongest
    const maxMass = Math.max(...bands.map(b => b.mass));
    return bands.filter(b => b.mass >= maxMass * o.bandMassFloor);
}

/**
 * Text blocks (x-runs) inside a band [y0..y1]: [{ x0, x1, cx, mass }].
 */
export function blocksInBand(img, y0, y1, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width } = img;
    const col = new Float32Array(width);
    // color signal: name color pixels per column in the band
    if (o.inkMask) {
        const mask = o.inkMask;
        for (let y = y0; y <= y1; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) col[x] += mask[rowOff + x];
        }
    } else {
    // like rowProfile: EDGES by |Δluma|, not pixels over a threshold
    for (let y = y0; y <= y1; y++) {
        const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
        let inEdge = false;
        let prevL = sm[0];
        for (let x = 1; x < width; x++) {
            const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
            if (edge && !inEdge) col[x]++;
            inEdge = edge;
            prevL = sm[x];
        }
    }
    }

    const bandH = y1 - y0 + 1;
    // blockGap: merge gap forced by the caller. The default comes from the band HEIGHT, which blows up when art
    // merges with the name and then also merges the grid with the side panel
    const gap = o.blockGap ?? Math.max(6, Math.round(bandH * 1.2)); // a space between words < the gap between cells
    const blocks = [];
    let start = -1, lastOn = -1, mass = 0;
    for (let x = 0; x <= width; x++) {
        const on = x < width && col[x] > 0;
        if (on) {
            if (start < 0) { start = x; mass = 0; }
            lastOn = x;
            mass += col[x];
        } else if (start >= 0 && x - lastOn > gap) {
            blocks.push({ x0: start, x1: lastOn, cx: (start + lastOn) / 2, mass });
            start = -1;
        }
    }
    if (start >= 0) blocks.push({ x0: start, x1: lastOn, cx: (start + lastOn) / 2, mass });

    return blocks.filter(b => b.x1 - b.x0 >= 4);
}

/**
 * Best subset of positions in arithmetic progression: the real grid ROWS are evenly spaced bands, the HUD
 * and side panels make bands at loose heights. items = [{ pos, mass }]; returns { pitch, members: [pos...],
 * score } or null.
 */
export function bestArithmeticChain(items, minPitch, maxPitch, tol = 0.12) {
    const pts = [...items].sort((a, b) => a.pos - b.pos);
    if (pts.length < 2) return null;

    // column alignment between two bands: block centers of A with a center of B within tolX. Real rows share
    // columns; the HUD lines up with nothing
    const align = (ca, cb, tolX) => {
        let n = 0;
        for (const a of ca) if (cb.some(b => Math.abs(a - b) <= tolX)) n++;
        return n;
    };

    let best = null;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            const P = pts[j].pos - pts[i].pos;
            if (P < minPitch || P > maxPitch) continue;
            // walks the progression WITHOUT gaps: inventory rows are consecutive
            const members = [pts[i], pts[j]];
            let expected = pts[j].pos + P;
            for (;;) {
                let next = null;
                for (const p of pts) {
                    if (Math.abs(p.pos - expected) <= P * tol &&
                        (!next || Math.abs(p.pos - expected) < Math.abs(next.pos - expected))) {
                        next = p;
                    }
                }
                if (!next) break;
                members.push(next);
                expected = next.pos + P;
            }

            // prunes ends with an inconsistent step: a HUD band next to the grid can join the chain with a ~8% different
            // step; real rows vary ~±4%
            while (members.length >= 3) {
                const steps = [];
                for (let s = 1; s < members.length; s++) steps.push(members[s].pos - members[s - 1].pos);
                const sorted = [...steps].sort((a, b) => a - b);
                const med = sorted[Math.floor(sorted.length / 2)];
                const devFirst = Math.abs(steps[0] - med) / med;
                const devLast = Math.abs(steps[steps.length - 1] - med) / med;
                if (devFirst > 0.06 && devFirst >= devLast) members.shift();
                else if (devLast > 0.06) members.pop();
                else break;
            }

            let alignment = 0, mass = 0;
            for (let s = 0; s < members.length; s++) {
                mass += members[s].mass || 1;
                if (s > 0 && members[s].centers && members[s - 1].centers) {
                    alignment += align(members[s - 1].centers, members[s].centers, P * 0.15);
                }
            }

            // chains of ≥3 rows first; then MASS (name bands weigh ~10× the quantity badge bands, which form a parallel
            // chain at the same pitch); then column alignment and length
            const cand = { len: members.length, alignment, mass, members: members.map(m => m.pos) };
            const q = c => [c.len >= 3 ? 1 : 0, c.mass, c.alignment, c.len];
            const gt = (a, b) => {
                const qa = q(a), qb = q(b);
                for (let s = 0; s < qa.length; s++) {
                    if (qa[s] !== qb[s]) return qa[s] > qb[s];
                }
                return false;
            };
            if (!best || gt(cand, best)) {
                const steps = [];
                for (let s = 1; s < members.length; s++) steps.push(members[s].pos - members[s - 1].pos);
                cand.pitch = steps.reduce((a, b) => a + b, 0) / steps.length;
                best = cand;
            }
        }
    }
    return best;
}

/**
 * Fundamental step of a list of diffs that are (roughly) multiples of one pitch (empty cells give 2·Q,
 * 3·Q...). Returns { pitch, support } or null.
 */
export function estimatePitch(diffs, tol = 0.12) {
    const ds = diffs.filter(d => d > 0).sort((a, b) => a - b);
    if (!ds.length) return null;
    let best = null;
    // candidates: each diff divided by 1..3 (the smallest may already be a multiple)
    const cands = new Set();
    for (const d of ds) for (let k = 1; k <= 3; k++) cands.add(d / k);
    for (const q of cands) {
        if (q <= 0) continue;
        let support = 0, sum = 0, n = 0;
        for (const d of ds) {
            const k = Math.round(d / q);
            if (k >= 1 && Math.abs(d - k * q) <= q * tol) {
                support++;
                sum += d / k;
                n++;
            }
        }
        if (support && (!best || support > best.support ||
            (support === best.support && q > best.pitch * (1 + tol)))) {
            best = { pitch: sum / n, support };
        }
    }
    return best;
}

/**
 * Dominant frame colors for the name color signal: { bg:[r,g,b], cands:[[r,g,b]…] }, the BACKGROUND
 * (global color mode) and candidate "ink" colors. One is the NAME color, another is usually the metallic
 * ART; detectInventoryGrid keeps the one giving thin bands.
 */
export function colorInkCandidates(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const key = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const unq = k => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    const hist = new Map();
    for (let y = 0; y < height; y += o.strideX) {
        const rowOff = y * width * 4;
        for (let x = 0; x < width; x += o.strideX) {
            const i = rowOff + x * 4;
            const kk = key(data[i], data[i + 1], data[i + 2]);
            hist.set(kk, (hist.get(kk) || 0) + 1);
        }
    }
    let bgKey = 0, bgC = -1;
    for (const [k, c] of hist) if (c > bgC) { bgC = c; bgKey = k; }
    const bg = unq(bgKey);
    const entries = [...hist.entries()]
        .map(([k, c]) => ({ c, col: unq(k) }))
        .filter(e => {
            const dr = e.col[0] - bg[0], dg = e.col[1] - bg[1], db = e.col[2] - bg[2];
            return dr * dr + dg * dg + db * db > o.bgDistSq;
        })
        .sort((a, b) => b.c - a.c);
    const cands = [];
    for (const e of entries) {
        if (cands.some(c => {
            const dr = c[0] - e.col[0], dg = c[1] - e.col[1], db = c[2] - e.col[2];
            return dr * dr + dg * dg + db * db < o.mergeColSq;
        })) continue;
        cands.push(e.col);
        if (cands.length >= o.maxInkCands) break;
    }
    return { bg, cands };
}

/** Uint8Array(width·height) mask: 1 where the pixel is within √tolSq of the color. */
function colorInkMask(img, col, tolSq) {
    const { data, width, height } = img;
    const mask = new Uint8Array(width * height);
    const [cr, cg, cb] = col;
    for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
        const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb;
        if (dr * dr + dg * dg + db * db <= tolSq) mask[p] = 1;
    }
    return mask;
}

/**
 * Full detection. img = { data, width, height } (ImageData-like). Returns calibData for buildAutoGrid, or
 * null without enough confidence (the caller falls back to the saved manual calibration).
 *
 * Two signals:
 *   1) EDGES (|Δluma|): primary, works on most themes.
 *   2) NAME COLOR (fallback): when (1) collapses (a light textured background floods the edges, or metallic
 *      art steals the anchor), each candidate color is tried and the THINNEST row bands win.
 */
export function detectInventoryGrid(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    if (!img?.data || !img.width || !img.height) return null;

    const edgeRes = detectInventoryGridCore(img, opts);
    if (edgeRes) return edgeRes;

    // name color fallback: keeps the valid grid whose row band is the thinnest (text, not metallic art)
    const outerTrace = opts.trace || {};
    const { bg, cands } = colorInkCandidates(img, o);
    outerTrace.colorFallback = { bg, cands, tried: [] };
    let best = null;
    for (const col of cands) {
        const mask = colorInkMask(img, col, o.nameTolSq);
        const subTrace = {};
        const res = detectInventoryGridCore(img, { ...opts, inkMask: mask, trace: subTrace });
        outerTrace.colorFallback.tried.push({
            col, ok: !!res,
            nameBandFrac: res ? +res.nameBandFrac.toFixed(3) : null,
            fail: res ? null : subTrace.fail,
        });
        if (!res) continue;
        if (!best || res.nameBandFrac < best.nameBandFrac) { best = res; best._nameColor = col; }
    }
    if (best) {
        best.colorAnchored = true;
        // PAGE level name color (the one that anchored the grid), passed to the per-cell binarization: detecting it
        // per cell lost white text on textured themes
        best.nameColor = best._nameColor;
        delete best._nameColor;
        return best;
    }
    outerTrace.fail = outerTrace.fail || "sin señal de bordes ni de color de nombre";
    return null;
}

function detectInventoryGridCore(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { width, height } = img;
    if (!img?.data || !width || !height) return null;
    // opts.trace = {} to get the exact failure reason (live diagnostics)
    const trace = o.trace || {};

    const prof = rowProfile(img, o);
    const bands = findBands(prof, height, o);
    trace.bands = bands.map(b => ({ y0: b.y0, y1: b.y1, mass: Math.round(b.mass) }));
    if (bands.length < 2) {
        trace.fail = `bandas de texto insuficientes (${bands.length} < 2) — ¿contraste de bordes por debajo de edgeDelta ${o.edgeDelta}?`;
        return null;
    }

    // text blocks per band; a real name band has ≥1 "name sized" block. Wide 2 line names can MERGE neighbour
    // cells into one block, so the width filter only drops edge to edge lines
    const narrowEnough = bl => (bl.x1 - bl.x0) < width * 0.9;
    const bandBlocks = bands.map(b => ({ band: b, blocks: blocksInBand(img, b.y0, b.y1, o).filter(narrowEnough) }))
        .filter(bb => bb.blocks.length >= 1);

    // DISCARDED bands that can still be a real row: at the end of the list the last row sits next to
    // "TOTAL"/"SELL ITEMS" and the merge gap (from the band height) joins the names and the panel into ONE edge
    // to edge block. They are split again with a small gap.
    // They do NOT join the chain WHILE there are clean bands; with none left (art merges the name in EVERY row,
    // the normal case in a page CROP) these count, and there is no HUD either.
    const rescuedBands = [];
    for (const b of bands) {
        if (bandBlocks.some(bb => bb.band === b)) continue;
        const retry = blocksInBand(img, b.y0, b.y1, { ...o, blockGap: Math.max(6, Math.round((b.y1 - b.y0 + 1) * 0.12)) });
        const estrechos = retry.filter(narrowEnough);
        // edge to edge even with the small gap is still a row: two merged names
        if (estrechos.length >= 3) rescuedBands.push({ band: b, blocks: estrechos });
        else if (retry.some(bl => bl.x1 - bl.x0 >= width * 0.6)) rescuedBands.push({ band: b, blocks: retry });
    }
    trace.rescuedBands = rescuedBands.map(bb => bb.band.y0);
    trace.bandBlocks = bandBlocks.map(bb => ({ y0: bb.band.y0, blocks: bb.blocks.length }));

    // with two clean ones SKIPPED the chain came out at double step; the HUD title is not a row
    if (bandBlocks.filter(bb => bb.band.y1 >= height * 0.2).length < o.rows) bandBlocks.push(...rescuedBands);
    if (bandBlocks.length < 2) {
        trace.fail = `bandas con bloques válidos insuficientes (${bandBlocks.length} < 2) — ¿bloques de borde a borde (>90% del frame) o ruido?`;
        return null;
    }

    const hudLimit = height * 0.2;
    const toItem = bb => ({
        pos: bb.band.y1,
        mass: bb.blocks.reduce((s, bl) => s + bl.mass, 0),
        centers: bb.blocks.map(bl => bl.cx),
    });
    const chainItems = bandBlocks.filter(bb => bb.band.y1 >= hudLimit).map(toItem);
    const chain = bestArithmeticChain(chainItems, height * 0.12, height * 0.5);

    if (chain && chain.members.length >= 2) {
        const pitch = chain.pitch;
        const first = chain.members[0];
        const firstCenters = bandBlocks.find(bb => bb.band.y1 === first)?.blocks.map(bl => bl.cx) || [];
        const tolY = pitch * 0.12;
        const tolX = pitch * 0.15;
        let bestPrev = null, bestErr = Infinity;
        for (const bb of bandBlocks) {
            if (bb.band.y1 >= hudLimit) continue;   // already in the chain
            const err = Math.abs(bb.band.y1 - (first - pitch));
            if (err > tolY || err >= bestErr) continue;
            const centers = bb.blocks.map(bl => bl.cx);
            const aligned = centers.filter(a => firstCenters.some(b => Math.abs(a - b) <= tolX)).length;
            // at least 2 matching columns (or all, if the row has 1 cell): one can be chance
            if (aligned >= Math.min(2, centers.length)) { bestPrev = bb; bestErr = err; }
        }
        if (bestPrev) {
            chain.members.unshift(bestPrev.band.y1);
            chainItems.push(toItem(bestPrev));
            trace.clippedTopRow = { y1: bestPrev.band.y1, y0: bestPrev.band.y0 };
        }
    }

    trace.chain = chain ? { pitch: Math.round(chain.pitch), members: chain.members } : null;
    // the 3 inventory rows are required: any pair of bands makes a "chain"
    if (!chain || chain.members.length < o.rows) {
        trace.fail = chain
            ? `cadena de solo ${chain.members.length} filas (<${o.rows}) — pitch sin corroborar`
            : "sin cadena de filas equiespaciadas (¿solo HUD/paneles, sin grid visible?)";
        return null;
    }
    let cellH = Math.round(chain.pitch);

    // row re-anchoring: are the chain NAMES or BADGES? Quantity badges form a parallel chain at the same pitch,
    // ~0.6·cellH off. The pitch holds, but the phase must anchor on names: fold the row profile modulo cellH and
    // take the heaviest ARC. The chain anchored on y1; the fold needs the name TOP (y0)
    const y1ToTop = new Map(bandBlocks.map(bb => [bb.band.y1, bb.band.y0]));
    const base = y1ToTop.get(chain.members[0]) ?? chain.members[0];
    const last = y1ToTop.get(chain.members[chain.members.length - 1]) ?? chain.members[chain.members.length - 1];
    // the fold starts at the top of the highest name in the chain, not at hudLimit: a readmitted cut row lives
    // above hudLimit
    const foldY0 = Math.max(0, Math.min(Math.ceil(hudLimit), base), base - cellH);
    const foldY1 = Math.min(height - 1, last + cellH);
    const fold = new Float32Array(cellH);
    for (let y = foldY0; y <= foldY1; y++) {
        fold[((y - base) % cellH + cellH) % cellH] += prof[y];
    }
    const arcLen = Math.max(2, Math.round(cellH * 0.35));
    let arcSum = 0;
    for (let i = 0; i < arcLen; i++) arcSum += fold[i];
    let bestArc = 0, bestArcSum = arcSum;
    for (let s = 1; s < cellH; s++) {
        arcSum += fold[(s + arcLen - 1) % cellH] - fold[s - 1];
        if (arcSum > bestArcSum) { bestArcSum = arcSum; bestArc = s; }
    }
    // name band top in phase: base + bestArc (mod cellH), as close to base as possible
    const nameBase = base + (bestArc <= cellH / 2 ? bestArc : bestArc - cellH);

    // grid rows: a band falls in row k if its TOP (y0) matches the top slot (nameBase + k·cellH) OR its BASE
    // (y1) the baseline slot (baseY1 + k·cellH).
    //   - y1: holds when item art merges with the name from ABOVE and moves y0.
    //   - y0: holds when a row PEEKS cut at the bottom and its y1 is off the frame.
    // usedTops keeps the real name y0 for the rest of the pipeline
    const baseY1 = chain.members[0];
    const rowBands = [];
    const usedTops = [];
    const tol = cellH * 0.2;
    // effective HUD ceiling: a readmitted cut row has its baseline BELOW hudLimit and these two filters would
    // drop it again
    const rowFloor = Math.min(hudLimit, chain.members[0]);
    const kMin = Math.floor((rowFloor - baseY1) / cellH) - 1;
    const kMax = Math.ceil((height - baseY1) / cellH) + 1;
    for (let k = kMin; k <= kMax; k++) {
        const topSlot = nameBase + k * cellH;
        const baseSlot = baseY1 + k * cellH;
        if (baseSlot < rowFloor && topSlot < rowFloor) continue;
        let bb = null, bbErr = Infinity;
        // rescued bands go LAST: a clean band for this slot wins
        for (const cand2 of [...bandBlocks, ...rescuedBands]) {
            if (cand2.band.y1 < rowFloor) continue;
            const err = Math.min(Math.abs(cand2.band.y0 - topSlot), Math.abs(cand2.band.y1 - baseSlot));
            if (err <= tol && err < bbErr) { bb = cand2; bbErr = err; }
        }
        if (bb && !rowBands.includes(bb)) { rowBands.push(bb); usedTops.push(bb.band.y0); }
    }
    // HALF PITCH guard: badges almost halfway between name rows let a cellH/2 pitch through. Alternate rows then
    // have very uneven masses (names ≫ badges): the real pitch is double and the heavy ones stay
    if (rowBands.length >= 5) {
        const bandMass = bb => bb.blocks.reduce((s, bl) => s + bl.mass, 0);
        let even = 0, odd = 0;
        for (const bb of rowBands) {
            const k = Math.round((bb.band.y0 - rowBands[0].band.y0) / cellH);
            if (k % 2 === 0) even += bandMass(bb);
            else odd += bandMass(bb);
        }
        if (Math.min(even, odd) < Math.max(even, odd) * 0.6) {
            const keepParity = even >= odd ? 0 : 1;
            const kept = rowBands.filter(bb =>
                Math.round((bb.band.y0 - rowBands[0].band.y0) / cellH) % 2 === keepParity
            );
            trace.halfPitchFixed = { cellHBefore: cellH, kept: kept.map(bb => bb.band.y0) };
            cellH *= 2;
            rowBands.length = 0;
            rowBands.push(...kept);
            usedTops.length = 0;
            usedTops.push(...kept.map(bb => bb.band.y0));
        }
    }

    trace.rowBands = usedTops;
    if (rowBands.length < o.rows) {
        trace.fail = `solo ${rowBands.length} filas de nombres tras re-anclar (<${o.rows})`;
        return null;
    }

    // horizontal pitch (cellW) by AUTOCORRELATION of the column profile: long names merge neighbour cell
    // blocks, so block centers are NOT reliable; the profile periodicity is
    const colProf = new Float32Array(width);
    const { data } = img;
    for (const bb of rowBands) {
        for (let y = bb.band.y0; y <= bb.band.y1; y++) {
            if (o.inkMask) {
                const rowOff = y * width;
                for (let x = 0; x < width; x++) colProf[x] += o.inkMask[rowOff + x];
                continue;
            }
            const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
            let inEdge = false;
            let prevL = sm[0];
            for (let x = 1; x < width; x++) {
                const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
                if (edge && !inEdge) colProf[x]++;
                inEdge = edge;
                prevL = sm[x];
            }
        }
    }

    const minQ = Math.max(8, Math.floor(cellH * 0.5));
    const maxQ = Math.min(width >> 1, Math.ceil(cellH * 1.8));
    let bestQ = 0, bestR = -1;
    for (let q = minQ; q <= maxQ; q++) {
        let r = 0;
        for (let x = 0; x + q < width; x++) r += colProf[x] * colProf[x + q];
        if (r > bestR) { bestR = r; bestQ = q; }
    }
    if (!bestQ || bestR <= 0) {
        trace.fail = "sin periodicidad horizontal en las filas detectadas";
        return null;
    }
    const cellW = bestQ;

    // horizontal phase: cell BORDERS are valleys without text. Looks for the offset b minimizing the profile at
    // x = b + k·cellW within the text range
    let xMin = -1, xMax = -1;
    let maxP = 0;
    for (let x = 0; x < width; x++) if (colProf[x] > maxP) maxP = colProf[x];
    const occThr = Math.max(1, maxP * 0.05);
    for (let x = 0; x < width; x++) {
        if (colProf[x] >= occThr) { if (xMin < 0) xMin = x; xMax = x; }
    }
    if (xMin < 0 || xMax - xMin < cellW) {
        trace.fail = "rango horizontal ocupado demasiado estrecho";
        return null;
    }

    // each RESIDUE CLASS r (mod cellW) is scored: borders sit at the class with least text. Sampled only inside
    // [xMin, xMax] so phases with borders in empty space do not win
    const mod = (a, m) => ((a % m) + m) % m;
    const win = Math.max(2, Math.round(cellW * 0.03));
    const avgByR = new Float32Array(cellW).fill(Infinity);
    let bestValley = Infinity;
    for (let r = 0; r < cellW; r++) {
        let s = 0, n = 0;
        for (let x = xMin + mod(r - xMin, cellW); x <= xMax; x += cellW) {
            for (let dx = -win; dx <= win; dx++) {
                const xx = x + dx;
                if (xx >= xMin && xx <= xMax) { s += colProf[xx]; n++; }
            }
        }
        if (!n) continue;
        avgByR[r] = s / n;
        if (avgByR[r] < bestValley) bestValley = avgByR[r];
    }
    // the valley can be wide (short names): the real border is its CENTER, the center of the longest circular
    // run of residues near the minimum
    const tau = bestValley * 1.2 + 0.5;
    let runStart = -1, runLen = 0, bestStart = 0, bestLen = 0;
    for (let r = 0; r < cellW * 2; r++) {
        if (avgByR[r % cellW] <= tau) {
            if (runStart < 0) runStart = r;
            runLen = r - runStart + 1;
            if (runLen > bestLen && runLen <= cellW) { bestLen = runLen; bestStart = runStart; }
        } else {
            runStart = -1;
        }
    }
    const bestR2 = mod(bestStart + Math.floor(bestLen / 2), cellW);

    // cell borders: e ≡ r* (mod cellW). Left = largest border ≤ xMin; right = smallest border ≥ xMax
    let gridXf = xMin - mod(xMin - bestR2, cellW);
    let rightEdge = gridXf;
    while (rightEdge < xMax) rightEdge += cellW;
    let cols = Math.round((rightEdge - gridXf) / cellW);

    // ISOLATE the grid zone by cell occupancy: foreign text at row height (plat counter, side panel) stretches
    // xMin/xMax. Real columns have names in (almost) every row: keep the longest contiguous run of occupied
    // cells
    if (cols >= 2) {
        const perRow = rowBands.map((bb) => {
            const prof = new Float32Array(width);
            for (let y = bb.band.y0; y <= bb.band.y1; y++) {
                if (o.inkMask) {
                    const rowOff = y * width;
                    for (let x = 0; x < width; x++) prof[x] += o.inkMask[rowOff + x];
                    continue;
                }
                const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
                let inEdge = false, prevL = sm[0];
                for (let x = 1; x < width; x++) {
                    const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
                    if (edge && !inEdge) prof[x]++;
                    inEdge = edge;
                    prevL = sm[x];
                }
            }
            return prof;
        });

        // occ[k] = rows where column k has text
        const occ = new Array(cols).fill(0);
        for (const prof of perRow) {
            const massK = [];
            for (let k = 0; k < cols; k++) {
                const a = Math.max(0, Math.round(gridXf + k * cellW));
                const b = Math.min(width - 1, Math.round(gridXf + (k + 1) * cellW));
                let s = 0;
                for (let x = a; x <= b; x++) s += prof[x];
                massK.push(s);
            }
            const rowMax = Math.max(...massK);
            if (rowMax <= 0) continue;
            for (let k = 0; k < cols; k++) if (massK[k] >= rowMax * 0.12) occ[k]++;
        }
        trace.occCols = [...occ];
        // contiguous run of columns with text in some row: a grid column can be empty in EVERY visible row, so
        // occupancy alone cannot tell it from foreign text. CONTIGUITY does: grid gaps are surrounded by occupied
        // columns, the side panel is separated by at least one empty column
        let bs = 0, bl = 0, cs = -1;
        for (let k = 0; k <= cols; k++) {
            if (k < cols && occ[k] >= 1) {
                if (cs < 0) cs = k;
                if (k - cs + 1 > bl) { bl = k - cs + 1; bs = cs; }
            } else {
                cs = -1;
            }
        }
        // if the run is still wider than a plausible grid, weak columns are trimmed from the ENDS: the side panel
        // shows in a single row, real columns in (almost) all. The inside is not touched, and with no dominant
        // strong block nothing is trimmed. "Strong" = three rows in four, not ALL: the last row of the list is
        // half full
        const maxOcc = Math.max(...occ);
        if (maxOcc >= 3) {
            const strongOcc = Math.ceil(maxOcc * 0.75);
            let strongFirst = -1, strongLast = -1;
            for (let k = bs; k < bs + bl; k++) {
                if (occ[k] >= strongOcc) { if (strongFirst < 0) strongFirst = k; strongLast = k; }
            }
            if (strongFirst >= 0) {
                let strongCount = 0;
                for (let k = strongFirst; k <= strongLast; k++) if (occ[k] >= strongOcc) strongCount++;
                const span = strongLast - strongFirst + 1;
                if (strongCount === span && span >= o.minCols) {
                    bs = strongFirst;
                    bl = span;
                }
            }
        }
        if (bl >= 1 && bl < cols) {
            trace.trimmedCols = { before: cols, kept: bl, from: bs };
            gridXf += bs * cellW;
            cols = bl;
        }
    }
    // <3 visible columns gives no confidence; >12 is impossible in Warframe
    if (cols < o.minCols || cols > o.maxCols) {
        trace.fail = `columnas fuera de rango: ${cols}`;
        return null;
    }
    const gridX = Math.max(0, Math.round(gridXf));

    const firstBand = rowBands[0].band;
    const gridY = firstBand.y1
        ? Math.round(firstBand.y1 - cellH * o.nameBaselineOffset)
        : Math.round(usedTops[0] - cellH * o.nameBandOffset);

    // plus the ones peeking at the bottom with few items (see filasConNombre)
    let rows = filasConNombre(findBands(prof, height, { ...o, bandMassFloor: 0 }),
        { gridX, gridY, cellW, cellH, cols, rows: rowBands.length, height, bloques: b => blocksInBand(img, b.y0, b.y1, o) });

    // row cut at the TOP (scroll clamped): its real top is NEGATIVE. Clipping the zone to y=0 would move the
    // phase of every row, so a whole cellH is skipped and that row is lost. The card starts ~0.1·cellH below
    // the cell top: if only that margin is missing, it stays
    const suelo = -cellH * 0.15;
    let gridYTop = gridY;
    if (cellH > 0) {
        while (gridYTop < suelo) gridYTop += cellH;
    } else {
        gridYTop = Math.max(0, gridYTop);
    }

    // only the rows the phase shift left out above or under the header are taken off. Rows are never invented
    // from the available height (a ghost row on normal scrolls), and never fewer than the real ones are
    // returned for a cut row: rows is CACHED by frame size, not by scroll
    if (cellH > 0) {
        const dropped = Math.ceil(Math.max(0, suelo - gridY) / cellH);
        rows = Math.max(rows - dropped, Math.min(rowBands.length, o.rows));
    }
    if (rows < 1) {
        trace.fail = "todas las filas quedan fuera del frame tras alinear la fase";
        return null;
    }

    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - gridYTop);

    const confidence = Math.min(1, (chain.members.length + cols) / 10);

    // RELATIVE thickness of the row bands (median), the tie breaker between candidate colors: the NAME is a thin
    // strip (~0.12-0.24·cellH), metallic ART a tall block (~0.45·cellH)
    const bandHs = rowBands.map(bb => bb.band.y1 - bb.band.y0 + 1).sort((a, b) => a - b);
    const nameBandFrac = bandHs.length ? bandHs[bandHs.length >> 1] / cellH : 1;

    return {
        gridZone: { x: gridX, y: gridYTop, w: gridW, h: gridH },
        gridX,
        gridY: gridYTop,
        gridW,
        gridH,
        cellW,
        cellH,
        gapX: 0,
        gapY: 0,
        cols,
        rows,
        auto: true,
        confidence,
        nameBandFrac,
    };
}

const REWARD_DEFAULTS = {
    ...DEFAULTS,
    // with a webcam aimed at an external monitor the game fills only part of the frame: the band is searched
    // over the WHOLE frame height, not a fixed crop
    minCardW: 0.08,   // a reward card is never narrower than ~8% of ITS band width
    maxCards: 4,
    minCards: 2,      // with 1 block a lone reward cannot be told from the title bar
};

/**
 * Finds the reward name band (2-4 horizontal cards) ANYWHERE in the frame. Same signal as
 * detectInventoryGrid (|Δluma| edges, dominant ink color fallback), but takes the heaviest band instead of
 * an arithmetic chain: reward cards are ONE row.
 *
 * Returns { x, y, w, h, cardCount, cardBoxes } in input frame PIXELS, or null when no plausible band shows
 * up.
 */
export function detectRewardBand(img, opts = {}) {
    const o = { ...REWARD_DEFAULTS, ...opts };
    if (!img?.data || !img.width || !img.height) return null;

    const tryBands = (bandOpts) => {
        const prof = rowProfile(img, bandOpts);
        return findBands(prof, img.height, bandOpts);
    };

    const pickBest = (bands, bandOpts) => {
        let best = null;
        for (const band of bands) {
            const blocks = blocksInBand(img, band.y0, band.y1, bandOpts)
                .filter(b => (b.x1 - b.x0) >= img.width * o.minCardW);
            if (blocks.length < o.minCards || blocks.length > o.maxCards) continue;
            // the real reward band has the most text mass among those giving 2-4 blocks: the HUD (title, "2" counter,
            // squad names under the cards) also makes bands, with far less mass
            if (!best || band.mass > best.band.mass) best = { band, blocks };
        }
        return best;
    };

    let bands = tryBands(o);
    let result = pickBest(bands, o);

    // dominant ink color fallback: a light textured background floods the edges
    if (!result) {
        const { cands } = colorInkCandidates(img, o);
        for (const col of cands) {
            const mask = colorInkMask(img, col, o.nameTolSq);
            const colorOpts = { ...o, inkMask: mask };
            const cBands = tryBands(colorOpts);
            const cResult = pickBest(cBands, colorOpts);
            if (cResult && (!result || cResult.band.mass > result.band.mass)) result = cResult;
        }
    }

    if (!result) return null;

    const { band, blocks } = result;
    const x0 = Math.min(...blocks.map(b => b.x0));
    const x1 = Math.max(...blocks.map(b => b.x1));
    // margin around the NAMES box: the reward crop (prepareRewardOCRCanvas) also needs the Owned/Crafted badge
    // above and some air at the sides
    const padX = (x1 - x0) * 0.15;
    const padYTop = (band.y1 - band.y0) * 3.0;
    const padYBottom = (band.y1 - band.y0) * 1.2;

    const x = Math.max(0, x0 - padX);
    const w = Math.min(img.width - x, (x1 - x0) + padX * 2);
    const y = Math.max(0, band.y0 - padYTop);
    const h = Math.min(img.height - y, (band.y1 - band.y0) + padYTop + padYBottom);

    return { x, y, w, h, cardCount: blocks.length, cardBoxes: blocks };
}
