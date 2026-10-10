// Separa las palabras del OCR en cartas por su posición X (hueco grande = frontera entre cartas).
// Filtra por confianza para tirar el "garbage" que genera el arte de fondo. Reconstruye el texto
// de cada carta agrupando por líneas (Y) y ordenando por X. Devuelve null si solo hay una carta.
export function wordsToCards(data, canvasWidth) {
    let words = [];
    const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
    if (Array.isArray(data?.words)) pushAll(data.words);
    if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
    if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
    if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

    // Volcado de palabras para depurar inclusión/agrupado en vivo: globalThis._rivenWordDump = true
    if (globalThis._rivenWordDump) {
        const dump = words.filter(w => w && w.text && w.bbox)
            .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
            .join("  ");
        console.log(`[RIVEN WORDS] ${dump}`);
    }

    // Palabra "de contenido" (>=3 alfanuméricos o con dígito): tira el ruido suelto del arte.
    const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

    // Reconstruye el texto de una carta: agrupa por línea (centro-Y, tolerancia = mediana de
    // altura) para que el valor ("+92.4%") y su nombre ("Status Chance") queden en la MISMA línea,
    // y ordena cada línea por X.
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

    // Umbral para huecos entre BORDES (no centros): el hueco de borde real entre dos cartas
    // lado a lado es ~4-6% del ancho del recorte (con el 7% de antes, calibrado para centros
    // de palabra, nunca se separaban) y las continuaciones de línea de una misma carta dejan
    // ~1%, así que 3% da margen por ambos lados; si se partiera mal, el texto completo en
    // processRivenCard lo rescata.
    const gapThresh = Math.max(canvasWidth * 0.03, 40);
    // Por hueco entre BORDES (x0 del siguiente menos el x1 máximo), no entre centros: el texto
    // envuelto de UNA carta ("Croni-", "(x2 for", "Cold") queda pegado al borde derecho del
    // bloque pero sus centros caen lejos, y por centros formaba anclas fantasma que partían
    // una carta en dos "columnas" que no parseaban.
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

    // --- Paso PRINCIPAL: anclas espaciales. El arte hace que Tesseract escupa ~100 tokens basura
    // de confianza baja dispersos en X; el texto real es de confianza ALTA (≳84) y va agrupado por
    // carta. Se ancla en los de confianza alta para ubicar la CAJA de cada carta y dentro se admiten
    // los de ≥28: recupera el curse tenue (~35) y descarta la basura dispersa. Validado offline.
    const ANCHOR_CONF = 70; // entre la basura (≤~67) y el texto real (≳84)
    const INSIDE_CONF = 28; // tokens tenues pero reales dentro de la caja (p.ej. la línea del curse)
    const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
    console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
    if (anchors.length >= 3) {
        const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
        if (anchorGroups.length >= 2) {
            const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
            const cards = anchorGroups.map(g => {
                // Las cartas se separan por X (van lado a lado); incluimos los tokens cuyo CENTRO-X
                // cae en la columna de la carta, sin filtrar por Y, para captar el nombre del arma
                // (arriba) y la línea del curse (abajo). El parser ignora el ruido que no es stat.
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

    // --- FALLBACK: corte por confianza plana (>=50) + hueco en X (comportamiento original) ---
    const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
    console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
    if (usable.length < 3) return null;
    const realGroups = clusterByX(usable).filter(g => g.length >= 3);
    console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
    if (realGroups.length < 2) return null; // una sola carta -> deja el flujo normal
    return realGroups.map(toText);
}
