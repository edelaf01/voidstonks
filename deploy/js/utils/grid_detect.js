const DEFAULTS = {
    brightThresh: 185,
    strideX: 2,
    minBandH: 6,
    maxBandHFrac: 0.25,
    mergeGapY: 5,
    bandMassFloor: 0.22,
    nameBandOffset: 0.60,
    rows: 3,
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

    const maxMass = Math.max(...bands.map(b => b.mass));
    return bands.filter(b => b.mass >= maxMass * o.bandMassFloor);
}

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
    const gap = Math.max(6, Math.round(bandH * 1.2));
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

export function bestArithmeticChain(items, minPitch, maxPitch, tol = 0.12) {
    const pts = [...items].sort((a, b) => a.pos - b.pos);
    if (pts.length < 2) return null;

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

            const cand = { len: members.length, alignment, mass, members: members.map(m => m.pos) };
            if (!best ||
                cand.len > best.len ||
                (cand.len === best.len && cand.alignment > best.alignment) ||
                (cand.len === best.len && cand.alignment === best.alignment && cand.mass > best.mass)) {
                const steps = [];
                for (let s = 1; s < members.length; s++) steps.push(members[s].pos - members[s - 1].pos);
                cand.pitch = steps.reduce((a, b) => a + b, 0) / steps.length;
                best = cand;
            }
        }
    }
    return best;
}

export function estimatePitch(diffs, tol = 0.12) {
    const ds = diffs.filter(d => d > 0).sort((a, b) => a - b);
    if (!ds.length) return null;
    let best = null;
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
            (bl.x1 - bl.x0) < width * 0.35
        ),
    })).filter(bb => bb.blocks.length >= 1);
    trace.bandBlocks = bandBlocks.map(bb => ({ y0: bb.band.y0, blocks: bb.blocks.length }));
    if (bandBlocks.length < 2) {
        trace.fail = `bandas con bloques válidos insuficientes (${bandBlocks.length} < 2) — ¿bloques demasiado anchos (>35% del frame) o ruido?`;
        return null;
    }

    const chainItems = bandBlocks.map(bb => ({
        pos: bb.band.y0,
        mass: bb.blocks.reduce((s, bl) => s + bl.mass, 0),
        centers: bb.blocks.map(bl => bl.cx),
    }));
    const chain = bestArithmeticChain(chainItems, height * 0.12, height * 0.5);
    trace.chain = chain ? { pitch: Math.round(chain.pitch), members: chain.members } : null;
    if (!chain || chain.members.length < o.rows) {
        trace.fail = chain
            ? `cadena de solo ${chain.members.length} filas (<${o.rows}) — pitch sin corroborar`
            : "sin cadena de filas equiespaciadas (¿solo HUD/paneles, sin grid visible?)";
        return null;
    }
    const cellH = Math.round(chain.pitch);
    const chainSet = new Set(chain.members);
    const rowBands = bandBlocks.filter(bb => chainSet.has(bb.band.y0));

    const hDiffs = [];
    for (const bb of rowBands) {
        const cs = bb.blocks.map(b => b.cx).sort((a, b) => a - b);
        for (let i = 1; i < cs.length; i++) hDiffs.push(cs[i] - cs[i - 1]);
    }
    const hPitch = estimatePitch(hDiffs);
    if (!hPitch) {
        trace.fail = "sin pitch horizontal (¿una sola columna con ítems?)";
        return null;
    }
    const cellW = Math.round(hPitch.pitch);
    if (cellW < cellH * 0.5 || cellW > cellH * 1.8) {
        trace.fail = `aspecto de celda implausible: cellW ${cellW} vs cellH ${cellH}`;
        return null;
    }

    const centers = rowBands.flatMap(bb => bb.blocks.map(b => b.cx)).sort((a, b) => a - b);
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
    if (cols < o.minCols || cols > o.maxCols) {
        trace.fail = `columnas fuera de rango: ${cols}`;
        return null;
    }
    const gridX = Math.max(0, Math.round(gridXfloat));

    const firstTop = chain.members[0];
    const gridY = Math.round(firstTop - cellH * o.nameBandOffset);

    const rows = o.rows;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    const confidence = Math.min(1, (chain.members.length + hPitch.support) / 8);

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
