/**
 * Las cajas de palabra de un resultado de Tesseract, venga como venga.
 *
 * tesseract.js cambia el anidamiento de `data` según la versión y según lo que se le pida
 * en `output`: a veces `words` está en la raíz y a veces cuelga de blocks→paragraphs→lines.
 * Quien lea posiciones tiene que cubrir las cuatro formas o se queda sin nada en silencio.
 */
/**
 * Las palabras TAL CUAL las da Tesseract ({ text, bbox, confidence }), vengan como vengan.
 *
 * A partir de tesseract.js 6, `data.words` no existe: hay que pedir `blocks: true` y bajar por
 * blocks→paragraphs→lines. Leer `data.words` a pelo devolvía undefined en silencio y con el
 * motor clásico TODAS las celdas del inventario salían NONE (medido en Chromium con la
 * captura de `arreglar_malcount`, 0/18 con una máscara perfecta).
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

/**
 * Tu fila de "Squad Relics": "" si dice "No Relic", null sin rótulo. El recorte entero daba la
 * reliquia del compañero. A 1440p tu fila cae a ~2,5 alturas del rótulo y tu nombre a ~4,3.
 */
export function filaPropiaDelEscuadron(palabras) {
    const rotulo = palabras.find((w) => /^SQUAD$/i.test(w.text));
    if (!rotulo) return null;
    const h = rotulo.y1 - rotulo.y0;
    const fila = palabras.filter((w) => {
        const yc = (w.y0 + w.y1) / 2;
        return w.x0 >= rotulo.x0 - h && yc > rotulo.y1 && yc < rotulo.y1 + 3.5 * h;
    }).map((w) => w.text);
    return /N[O0]\s*R[E3][L1I][I1L]C/i.test(fila.join(" ")) ? "" : fila;
}
