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

export function detectInventoryGrid(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { width, height } = img;
    if (!img?.data || !width || !height) return null;
    // opts.trace = {} to get the exact failure reason (live diagnostics)
    const trace = o.trace || {};

    const prof = rowProfile(img, o);
    const bands = findBands(prof, height, o);
    trace.bands = bands.map(b => ({ y0: b.y0, y1: b.y1, mass: Math.round(b.mass) }));
    if (bands.length < 2) {
        trace.fail = `bandas de texto insuficientes (${bands.length} < 2) — ¿texto por debajo del umbral de brillo ${o.brightThresh}?`;
        return null;
    }

    const bandBlocks = bands.map(b => ({
        band: b,
        blocks: blocksInBand(img, b.y0, b.y1, o).filter(bl =>
            (bl.x1 - bl.x0) < width * 0.9
        ),
    })).filter(bb => bb.blocks.length >= 1);
    trace.bandBlocks = bandBlocks.map(bb => ({ y0: bb.band.y0, blocks: bb.blocks.length }));
    if (bandBlocks.length < 2) {
        trace.fail = `bandas con bloques válidos insuficientes (${bandBlocks.length} < 2) — ¿bloques de borde a borde (>90% del frame) o ruido?`;
        return null;
    }

    const hudLimit = height * 0.2;
    const chainItems = bandBlocks.filter(bb => bb.band.y0 >= hudLimit).map(bb => ({
        pos: bb.band.y0,
        mass: bb.blocks.reduce((s, bl) => s + bl.mass, 0),
        centers: bb.blocks.map(bl => bl.cx),
    }));
    const chain = bestArithmeticChain(chainItems, height * 0.12, height * 0.5);
    trace.chain = chain ? { pitch: Math.round(chain.pitch), members: chain.members } : null;
    // the 3 inventory rows are required: any pair of bands makes a "chain"
    if (!chain || chain.members.length < o.rows) {
        trace.fail = chain
            ? `cadena de solo ${chain.members.length} filas (<${o.rows}) — pitch sin corroborar`
            : "sin cadena de filas equiespaciadas (¿solo HUD/paneles, sin grid visible?)";
        return null;
    }
    let cellH = Math.round(chain.pitch);

    const base = chain.members[0];
    const last = chain.members[chain.members.length - 1];
    const foldY0 = Math.max(Math.ceil(hudLimit), base - cellH);
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

    const rowBands = [];
    const usedTops = [];
    for (let t = nameBase - Math.ceil((nameBase - hudLimit) / cellH) * cellH; t < height; t += cellH) {
        if (t < hudLimit - cellH * 0.2) continue;
        let bb = null;
        for (const cand2 of bandBlocks) {
            if (cand2.band.y0 >= hudLimit && Math.abs(cand2.band.y0 - t) <= cellH * 0.2 &&
                (!bb || Math.abs(cand2.band.y0 - t) < Math.abs(bb.band.y0 - t))) {
                bb = cand2;
            }
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
            const off = y * width * 4;
            for (let x = 0; x < width; x++) {
                const i = off + x * 4;
                const mx = Math.max(data[i], data[i + 1], data[i + 2]);
                if (mx > o.brightThresh) colProf[x]++;
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
        const occ = new Array(cols).fill(0);
        for (let k = 0; k < cols; k++) {
            const a = Math.max(0, Math.round(gridXf + k * cellW));
            const b = Math.min(width - 1, Math.round(gridXf + (k + 1) * cellW));
            for (let x = a; x <= b; x++) occ[k] += colProf[x];
        }
        const maxOcc = Math.max(...occ);
        const occThr2 = maxOcc * 0.15;
        let bs = 0, bl = 0, cs = -1;
        for (let k = 0; k <= cols; k++) {
            if (k < cols && occ[k] >= occThr2) {
                if (cs < 0) cs = k;
                if (k - cs + 1 > bl) { bl = k - cs + 1; bs = cs; }
            } else {
                cs = -1;
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

    const firstTop = usedTops[0];
    const gridY = Math.round(firstTop - cellH * o.nameBandOffset);

    const rows = rowBands.length;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    const confidence = Math.min(1, (chain.members.length + cols) / 10);

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
