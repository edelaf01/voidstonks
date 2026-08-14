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

export function nameColorCandidates(imgData, max = 5) {
    const { data: px, width: cw, height: ch } = imgData;
    const QKEY = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const UNQ = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];

    const bgHist = new Map();
    let bgKey = 0, bgCount = -1;
    for (let i = 0; i < px.length; i += 4) {
        const key = QKEY(px[i], px[i + 1], px[i + 2]);
        const c = (bgHist.get(key) || 0) + 1;
        bgHist.set(key, c);
        if (c > bgCount) { bgCount = c; bgKey = key; }
    }
    const [bgR, bgG, bgB] = UNQ(bgKey);

    const bandY0 = Math.floor(ch * 0.45);
    const txHist = new Map();
    for (let y = bandY0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const i = (y * cw + x) * 4;
            const dr = px[i] - bgR, dg = px[i + 1] - bgG, db = px[i + 2] - bgB;
            if (dr * dr + dg * dg + db * db <= BG_TOL_SQ) continue;
            const key = QKEY(px[i], px[i + 1], px[i + 2]);
            txHist.set(key, (txHist.get(key) || 0) + 1);
        }
    }

    const out = [];
    for (const [key] of [...txHist.entries()].sort((a, b) => b[1] - a[1])) {
        const col = snapToThemeTextColor(...UNQ(key));
        const dup = out.some(o => {
            const dr = o[0] - col[0], dg = o[1] - col[1], db = o[2] - col[2];
            return dr * dr + dg * dg + db * db < TX_TOL_SQ;
        });
        if (dup) continue;
        out.push(col);
        if (out.length >= max) break;
    }
    return out;
}
