// Colores REALES del texto de los NOMBRES por tema (a intensidad plena), medidos
// por el usuario. OJO: NO son el acento brillante de la UI (WF_THEMES); el juego
// renderiza el nombre más apagado (p.ej. Stalker acento=(255,61,51) pero el nombre
// es (153,31,35)). cropThemeBinarized AJUSTA (snap) el color de texto auto-detectado
// al de esta tabla cuando está cerca, para binarizar por el color exacto del tema.
export const NAME_TEXT_COLORS = [
    { name: "White", r: 255, g: 255, b: 255 }, // conquera/legacy/lunar renewal/deadlock/fortuna/high-contrast usan blanco
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

// Ajusta un color RGB al color de nombre de tema más cercano si cae dentro de
// tolerancia (dist² < 55²); si no, lo deja igual (tema no catalogado).
export function snapToThemeTextColor(r, g, b) {
    let best = null, bestD = 55 * 55;
    for (const t of NAME_TEXT_COLORS) {
        const dr = r - t.r, dg = g - t.g, db = b - t.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = t; }
    }
    return best ? [best.r, best.g, best.b] : [r, g, b];
}

// Mismas tolerancias que cropThemeBinarized: los candidatos tienen que ser colores
// que esa función vaya a poder aislar, no otros.
const BG_TOL_SQ = 45 * 45;
const TX_TOL_SQ = 66 * 66;

// Color cuantizado a 5 bits por canal: el antialias del texto reparte el mismo trazo
// entre decenas de tonos casi idénticos y sin cuantizar no hay moda que valga.
const QKEY = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const UNQ = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];

/**
 * Histograma de colores de TINTA de la banda de nombre de UNA celda: los colores que
 * cropThemeBinarized podría llegar a aislar ahí, con cuántos píxeles tiene cada uno.
 * MIDE, no decide: quién gana lo resuelve rankPageNameColors con el resto de celdas.
 *
 * Los filtros son los mismos que aplica la binarización (lejos del fondo, y con la
 * separación de brillo sobre el fondo que exige la tinta). Un color que la
 * binarización va a tirar no puede ser el color del nombre, así que enumerarlo solo
 * gasta una pasada de OCR — y era por dónde se colaban los grises/rojos oscuros del
 * arte que luego ganaban la elección.
 *
 * @param imgData  ImageData del recorte (el de la banda de nombre, ya a escala de OCR)
 * @returns [{ col: [r,g,b], count }] de más a menos píxeles, sin agrupar
 */
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

    // Solo la franja inferior: el nombre siempre va abajo y el arte invade por arriba.
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

/**
 * Colores candidatos a texto del nombre para TODA una página, ordenados por el VOTO
 * de sus celdas. ENUMERA, no decide: el que vale lo confirma el OCR contra el catálogo.
 *
 * Por qué votando entre celdas y no por celda: dentro de UNA celda el arte y el nombre
 * ocupan casi los mismos píxeles de la banda (1.02% contra 1.90% en captura de
 * escritorio; 1.10% contra 1.00% en cuanto el stream de vídeo reescala el frame), así
 * que el ganador cambia de celda en celda y de pasada en pasada. Entre celdas no hay
 * empate posible: el color del NOMBRE es el mismo en las 18, y cada arte trae el suyo.
 *
 * Dentro del grupo ganador se devuelve el miembro MÁS BRILLANTE, no el más frecuente.
 * Los dos aíslan el nombre, pero el brillante es el núcleo del trazo y el frecuente
 * puede ser el borde suavizado: binarizar por el borde deja el núcleo fuera de la bola
 * de tolerancia y salen letras HUECAS, que el OCR lee a medias. Visto en vivo con
 * rgb(195,107,12) —borde del naranja rgb(248,128,0)—: 3 de 18 celdas ilegibles.
 *
 * @param histograms  un bandInkHistogram por celda de la página
 */
export function rankPageNameColors(histograms, max = 4) {
    // Un solo recuento global primero: agrupar sobre la marcha hace que el resultado
    // dependa del orden en que llegan las celdas (el representante de un grupo cambia y
    // con él a qué grupo cae el siguiente color), y entonces la misma página vota
    // distinto en cada pasada — justo lo que este módulo existe para evitar.
    const totals = new Map(); // "r,g,b" -> { col, pixels, cells:Set }
    histograms.forEach((hist, celda) => {
        for (const { col, count } of hist) {
            const key = col.join(",");
            let t = totals.get(key);
            if (!t) { t = { col, pixels: 0, cells: new Set() }; totals.set(key, t); }
            t.pixels += count;
            t.cells.add(celda);
        }
    });

    // Los grupos se siembran con los colores más frecuentes de la página: los tonos
    // que el antialias reparte alrededor de un trazo caen dentro de la tolerancia de
    // tinta de su núcleo, así que binarizar por cualquiera de ellos da la misma máscara.
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

    // En cuántas celdas aparece manda sobre cuántos píxeles suma: el arte de un ítem
    // puede tener más píxeles que el nombre, pero solo está en su celda.
    groups.sort((a, b) => b.cells.size - a.cells.size || b.pixels - a.pixels);

    const out = [];
    for (const g of groups) {
        const top = Math.max(...g.members.map(m => m.pixels));
        let best = null, bestLum = -1;
        for (const m of g.members) {
            // Un puñado de píxeles no define el núcleo del trazo: sin este corte, un
            // reflejo del arte a 3 píxeles se llevaría el grupo entero.
            if (m.pixels < top * 0.15) continue;
            const lum = m.col[0] * 0.299 + m.col[1] * 0.587 + m.col[2] * 0.114;
            if (lum > bestLum) { bestLum = lum; best = m.col; }
        }
        // Dos grupos distintos pueden acabar en el mismo representante (sus núcleos caen
        // en el mismo tono aunque sus semillas no se tocaran): producen la MISMA máscara,
        // así que ofrecer los dos solo gasta una pasada de OCR.
        if (!best || out.some(o => {
            const dr = o[0] - best[0], dg = o[1] - best[1], db = o[2] - best[2];
            return dr * dr + dg * dg + db * db < TX_TOL_SQ;
        })) continue;
        out.push(best);
        if (out.length >= max) break;
    }
    return out;
}
