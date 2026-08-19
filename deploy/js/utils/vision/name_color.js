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

/**
 * Colores que podrían ser el texto del nombre en la banda inferior de un recorte de
 * celda ya escalado, de más a menos frecuentes y sin repetir tono. ENUMERA, no decide.
 *
 * Quedarse con el más frecuente —que es lo que hace cropThemeBinarized cuando nadie le
 * pasa un color— es un empate a suerte en la pestaña de RELIQUIAS: el arte marrón y el
 * nombre naranja ocupan casi los mismos píxeles de la banda (1.02% contra 1.90% en
 * captura de escritorio; 1.10% contra 1.00% en cuanto el stream de vídeo reescala el
 * frame). Ahí el ganador cambia de celda en celda y de frame en frame, y el mismo
 * inventario se lee distinto en cada pasada.
 *
 * max=5 porque con el frame de reliquias comprimido el color del nombre caía al 4º
 * puesto por número de píxeles: cortar antes lo dejaría fuera de la lista.
 *
 * @param imgData  ImageData del recorte (el de la banda de nombre, ya a escala de OCR)
 */
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

    // Solo la franja inferior: el nombre siempre va abajo y el arte invade por arriba.
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
        // Dos colores más cercanos entre sí que la tolerancia de tinta producen la
        // MISMA máscara: ofrecer los dos solo gasta una pasada de OCR.
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
