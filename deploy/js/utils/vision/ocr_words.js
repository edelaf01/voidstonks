/**
 * Word boxes of a Tesseract result, whatever shape it comes in. tesseract.js changes how `data` nests with
 * the version and with what `output` asks for: sometimes `words` is at the root and sometimes it hangs from
 * blocks→paragraphs→lines.
 */
/**
 * Words AS Tesseract gives them ({ text, bbox, confidence }). Since tesseract.js 6 `data.words` does not
 * exist: `blocks: true` is required and the words are under blocks→paragraphs→lines.
 */
export function rawWords(data) {
    if (Array.isArray(data?.words)) return data.words;
    const out = [];
    const desde = (lines) => (lines || []).forEach((l) => (l.words || []).forEach((w) => out.push(w)));
    desde(data?.lines);
    if (!out.length) (data?.paragraphs || []).forEach((p) => desde(p.lines));
    if (!out.length) (data?.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => desde(p.lines)));
    return out;
}

export function collectWords(data) {
    const out = [];
    const push = (ws) => (ws || []).forEach((w) => {
        const b = w.bbox || w;
        if (typeof b?.x0 === "number") out.push({ text: w.text || "", x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
    });
    if (Array.isArray(data?.words)) push(data.words);
    if (!out.length) (data?.lines || []).forEach((l) => push(l.words));
    if (!out.length) (data?.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => push(l.words)));
    if (!out.length) (data?.blocks || []).forEach((b) => (b.paragraphs || [])
        .forEach((p) => (p.lines || []).forEach((l) => push(l.words))));
    return out;
}
