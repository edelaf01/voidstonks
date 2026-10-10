// splits OCR words into riven cards by X gaps, filters art noise and rebuilds text lines
export function wordsToCards(data, canvasWidth) {
    let words = [];
    const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
    if (Array.isArray(data?.words)) pushAll(data.words);
    if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
    if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
    if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

    if (globalThis._rivenWordDump) {
        const dump = words.filter(w => w && w.text && w.bbox)
            .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
            .join("  ");
        console.log(`[RIVEN WORDS] ${dump}`);
    }

    const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

    const toText = (ws) => {
        const heights = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
        const medH = heights[Math.floor(heights.length / 2)] || 20;
        const lines = [];
        for (const w of ws.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
            const cy = (w.bbox.y0 + w.bbox.y1) / 2;
            let line = lines.find(L => Math.abs(L.cy - cy) < medH * 0.6);
            if (!line) { line = { cy, ws: [] }; lines.push(line); }
            line.ws.push(w);
            line.cy = (line.cy * (line.ws.length - 1) + cy) / line.ws.length;
        }
        lines.sort((a, b) => a.cy - b.cy);
        return lines.map(L => L.ws.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(" ")).join("\n");
    };

    const gapThresh = Math.max(canvasWidth * 0.03, 40);
    // splits by edge gaps not centers because wrapped line centers would split a card in two
    const clusterByX = (ws) => {
        const items = ws.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const groups = [[]];
        let maxX1 = null;
        for (const w of items) {
            if (maxX1 !== null && w.bbox.x0 - maxX1 > gapThresh) groups.push([]);
            groups[groups.length - 1].push(w);
            maxX1 = maxX1 === null ? w.bbox.x1 : Math.max(maxX1, w.bbox.x1);
        }
        return groups;
    };

    const ANCHOR_CONF = 70;
    const INSIDE_CONF = 28;
    const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
    console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
    if (anchors.length >= 3) {
        const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
        if (anchorGroups.length >= 2) {
            const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
            const cards = anchorGroups.map(g => {
                const x0 = Math.min(...g.map(t => t.bbox.x0)), x1 = Math.max(...g.map(t => t.bbox.x1));
                const mx = (x1 - x0) * 0.06;
                const ws = inside.filter(w => {
                    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
                    return cx >= x0 - mx && cx <= x1 + mx;
                });
                return toText(ws);
            });
            console.log(`[OCR DIAG] spatial cards=${cards.length} (anchorGroups=${anchorGroups.length})`);
            return cards;
        }
    }

    const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
    console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
    if (usable.length < 3) return null;
    const realGroups = clusterByX(usable).filter(g => g.length >= 3);
    console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
    if (realGroups.length < 2) return null;
    return realGroups.map(toText);
}
