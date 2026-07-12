const DEFAULTS = {
    brightThresh: 185,
    strideX: 2,          // horizontal sampling for the row profile
    minBandH: 6,         // px: lower bands are noise
    maxBandHFrac: 0.25,  // taller than 25% of the image = background/art, not text
    mergeGapY: 5,
    bandMassFloor: 0.22, // min mass relative to the strongest band (drops badges/HUD)
    nameBandOffset: 0.60,
    rows: 3,             // Warframe's inventory always shows 3 rows
    minCols: 3,
    maxCols: 12,
};

export function rowProfile(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const prof = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let cnt = 0;
        const off = y * width * 4;
        for (let x = 0; x < width; x += o.strideX) {
            const i = off + x * 4;
            const mx = Math.max(data[i], data[i + 1], data[i + 2]);
            if (mx > o.brightThresh) cnt++;
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
        if (last && r.y0 - last.y1 <= o.mergeGapY) last.y1 = r.y1;
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
    for (let y = y0; y <= y1; y++) {
        const off = y * width * 4;
        for (let x = 0; x < width; x++) {
            const i = off + x * 4;
            const mx = Math.max(data[i], data[i + 1], data[i + 2]);
            if (mx > o.brightThresh) col[x]++;
        }
    }

    const bandH = y1 - y0 + 1;
    const gap = Math.max(6, Math.round(bandH * 1.2)); // a space between words < the gap between cells
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

export function detectInventoryGrid(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { width, height } = img;
    if (!img?.data || !width || !height) return null;

    const prof = rowProfile(img, o);
    const bands = findBands(prof, height, o);
    if (bands.length < 2) return null;

    const bandBlocks = bands.map(b => ({
        band: b,
        blocks: blocksInBand(img, b.y0, b.y1, o).filter(bl =>
            (bl.x1 - bl.x0) < width * 0.35
        ),
    })).filter(bb => bb.blocks.length >= 1);
    if (bandBlocks.length < 2) return null;

    const tops = bandBlocks.map(bb => bb.band.y0).sort((a, b) => a - b);
    const vDiffs = [];
    for (let i = 1; i < tops.length; i++) vDiffs.push(tops[i] - tops[i - 1]);
    const vPitch = estimatePitch(vDiffs);
    if (!vPitch) return null;
    const cellH = Math.round(vPitch.pitch);
    if (cellH < height * 0.12 || cellH > height * 0.5) return null;

    const hDiffs = [];
    for (const bb of bandBlocks) {
        const cs = bb.blocks.map(b => b.cx).sort((a, b) => a - b);
        for (let i = 1; i < cs.length; i++) hDiffs.push(cs[i] - cs[i - 1]);
    }
    const hPitch = estimatePitch(hDiffs);
    if (!hPitch) return null;
    const cellW = Math.round(hPitch.pitch);
    if (cellW < cellH * 0.5 || cellW > cellH * 1.8) return null;

    const centers = bandBlocks.flatMap(bb => bb.blocks.map(b => b.cx)).sort((a, b) => a - b);
    const ref = centers[0];
    const lefts = [];
    let minCi = Infinity, maxCi = -Infinity;
    for (const cx of centers) {
        const ci = Math.round((cx - ref) / cellW);
        minCi = Math.min(minCi, ci);
        maxCi = Math.max(maxCi, ci);
        lefts.push(cx - ci * cellW - cellW / 2);
    }
    lefts.sort((a, b) => a - b);
    const gridXfloat = lefts[Math.floor(lefts.length / 2)] + minCi * cellW;
    const cols = maxCi - minCi + 1;
    // <3 visible columns gives no confidence; >12 is impossible in Warframe
    if (cols < o.minCols || cols > o.maxCols) return null;
    const gridX = Math.max(0, Math.round(gridXfloat));

    const firstTop = tops[0];
    const gridY = Math.round(firstTop - cellH * o.nameBandOffset);

    const rows = o.rows;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    const confidence = Math.min(1, (vPitch.support + hPitch.support) / 8);

    return {
        gridZone: { x: gridX, y: Math.max(0, gridY), w: gridW, h: gridH },
        gridX,
        gridY: Math.max(0, gridY),
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
    };
}
