// measured theme name text colors and voting across cells to pick the binarization color
export const NAME_TEXT_COLORS = [
    { name: "White", r: 255, g: 255, b: 255 },
    { name: "Equinox", r: 158, g: 159, b: 167 },
    { name: "High Contrast Blue", r: 102, g: 176, b: 255 },
    { name: "Stalker", r: 153, g: 31, b: 35 },
    { name: "Vitruvian", r: 190, g: 169, b: 102 },
    { name: "Zephyr Harrier", r: 195, g: 107, b: 12 },
    { name: "Baruuk", r: 238, g: 193, b: 105 },
    { name: "Corpus", r: 35, g: 201, b: 245 },
    { name: "Dark Lotus", r: 140, g: 119, b: 147 },
    { name: "Grineer", r: 255, g: 189, b: 102 },
    { name: "Lotus", r: 36, g: 184, b: 242 },
    { name: "Nidus", r: 140, g: 38, b: 92 },
    { name: "Orokin", r: 46, g: 65, b: 55 },
    { name: "Pom-2", r: 130, g: 224, b: 151 },
    { name: "Tenno", r: 9, g: 78, b: 106 },
];

export function snapToThemeTextColor(r, g, b) {
    let best = null, bestD = 55 * 55;
    for (const t of NAME_TEXT_COLORS) {
        const dr = r - t.r, dg = g - t.g, db = b - t.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = t; }
    }
    return best ? [best.r, best.g, best.b] : [r, g, b];
}

const BG_TOL_SQ = 45 * 45;
const TX_TOL_SQ = 66 * 66;

const QKEY = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const UNQ = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];

export function rampCoreColor(bins, bg) {
    if (!bins?.length) return null;
    // cos >= 0.985 fits the 5 bit quantization drift without merging two different ramps
    const COS_MIN = 0.985;
    const groups = [];
    for (const { col, count } of bins) {
        const v = [col[0] - bg[0], col[1] - bg[1], col[2] - bg[2]];
        const m = Math.hypot(v[0], v[1], v[2]);
        if (!m) continue;
        const u = [v[0] / m, v[1] / m, v[2] / m];
        let g = groups.find(G => G.u[0] * u[0] + G.u[1] * u[1] + G.u[2] * u[2] >= COS_MIN);
        if (!g) { g = { u, pixels: 0, members: [] }; groups.push(g); }
        g.pixels += count;
        g.members.push({ col, count, m });
    }
    if (!groups.length) return null;
    let best = groups[0];
    for (const g of groups) if (g.pixels > best.pixels) best = g;

    let pick = null, pickM = -1, wide = null, wideMass = -1;
    for (const c of best.members) {
        let mass = 0;
        for (const o of best.members) {
            const dr = o.col[0] - c.col[0], dg = o.col[1] - c.col[1], db = o.col[2] - c.col[2];
            if (dr * dr + dg * dg + db * db < TX_TOL_SQ) mass += o.count;
        }
        if (mass > wideMass) { wideMass = mass; wide = c.col; }
        if (mass >= best.pixels * 0.5 && c.m > pickM) { pickM = c.m; pick = c.col; }
    }
    return pick || wide;
}

export function bandInkHistogram(imgData, max = 10) {
    const { data: px, width: cw, height: ch } = imgData;
    const bgHist = new Map();
    let bgKey = 0, bgCount = -1;
    for (let i = 0; i < px.length; i += 4) {
        const key = QKEY(px[i], px[i + 1], px[i + 2]);
        const c = (bgHist.get(key) || 0) + 1;
        bgHist.set(key, c);
        if (c > bgCount) { bgCount = c; bgKey = key; }
    }
    const [bgR, bgG, bgB] = UNQ(bgKey);
    const bgLum = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;

    const bandY0 = Math.floor(ch * 0.45);
    const txHist = new Map();
    for (let y = bandY0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = (y * cw + x) * 4;
            const dr = px[i] - bgR, dg = px[i + 1] - bgG, db = px[i + 2] - bgB;
            if (dr * dr + dg * dg + db * db <= BG_TOL_SQ) continue;
            if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < bgLum + 12) continue;
            const key = QKEY(px[i], px[i + 1], px[i + 2]);
            txHist.set(key, (txHist.get(key) || 0) + 1);
        }
    }
    return [...txHist.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([key, count]) => ({ col: UNQ(key), count }));
}

export function rankPageNameColors(histograms, max = 4) {
    const totals = new Map();
    histograms.forEach((hist, celda) => {
        for (const { col, count } of hist) {
            const key = col.join(",");
            let t = totals.get(key);
            if (!t) { t = { col, pixels: 0, cells: new Set() }; totals.set(key, t); }
            t.pixels += count;
            t.cells.add(celda);
        }
    });

    const groups = [];
    for (const t of [...totals.values()].sort((a, b) => b.pixels - a.pixels)) {
        let g = groups.find(G => {
            const dr = G.seed[0] - t.col[0], dg = G.seed[1] - t.col[1], db = G.seed[2] - t.col[2];
            return dr * dr + dg * dg + db * db < TX_TOL_SQ;
        });
        if (!g) { g = { seed: t.col, pixels: 0, cells: new Set(), members: [] }; groups.push(g); }
        g.pixels += t.pixels;
        for (const c of t.cells) g.cells.add(c);
        g.members.push(t);
    }

    groups.sort((a, b) => b.cells.size - a.cells.size || b.pixels - a.pixels);

    const out = [];
    for (const g of groups) {
        const top = Math.max(...g.members.map(m => m.pixels));
        let best = null, bestLum = -1;
        for (const m of g.members) {
            if (m.pixels < top * 0.15) continue;
            const lum = m.col[0] * 0.299 + m.col[1] * 0.587 + m.col[2] * 0.114;
            if (lum > bestLum) { bestLum = lum; best = m.col; }
        }
        if (!best || out.some(o => {
            const dr = o[0] - best[0], dg = o[1] - best[1], db = o[2] - best[2];
            return dr * dr + dg * dg + db * db < TX_TOL_SQ;
        })) continue;
        out.push(best);
        if (out.length >= max) break;
    }
    return out;
}
