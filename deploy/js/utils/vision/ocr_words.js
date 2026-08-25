/**
 * Las cajas de palabra de un resultado de Tesseract, venga como venga.
 *
 * tesseract.js cambia el anidamiento de `data` según la versión y según lo que se le pida
 * en `output`: a veces `words` está en la raíz y a veces cuelga de blocks→paragraphs→lines.
 * Quien lea posiciones tiene que cubrir las cuatro formas o se queda sin nada en silencio.
 */
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
