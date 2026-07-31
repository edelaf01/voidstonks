/**
 * Autodetección de la rejilla del inventario (sin calibración manual).
 *
 * Lógica 100% pura sobre un objeto tipo ImageData ({ data, width, height }):
 * sin DOM ni canvas, para poder testearla offline en Node.
 *
 * Señal usada: los NOMBRES de los ítems son texto muy brillante (blanco/crema
 * o color del tema) impreso en una banda fija de cada card (~0.58–0.92 del
 * alto de celda). Eso produce:
 *   - 3 bandas horizontales de píxeles brillantes con pitch = cellH (filas)
 *   - dentro de cada banda, bloques de texto centrados por celda con
 *     pitch = cellW (columnas)
 * Los badges de cantidad (top-left de la celda) también brillan pero son
 * minúsculos comparados con los nombres: se filtran por masa total de banda.
 *
 * El resultado usa el MISMO formato que la calibración manual guardada
 * (gridZone + cellW/cellH/cols/rows), así buildAutoGrid y detectRowPhase
 * (ajuste fino de fase vertical) siguen funcionando sin cambios.
 *
 * SEÑAL: densidad de BORDES por |Δluma| entre muestras vecinas, NO un umbral
 * absoluto de brillo. Un umbral absoluto (p.ej. "canal máx > 185 = texto")
 * asume fondo oscuro; con los temas de fondo claros de Warframe (magenta,
 * cian…) el fondo entero supera el umbral y el texto deja de producir
 * transiciones → la detección colapsa y cae a la calibración manual. |Δluma|
 * es invariante al color/brillo del fondo Y al color del texto: un trazo de
 * letra crea un borde tanto si es claro-sobre-oscuro como oscuro-sobre-claro
 * (blanco, dorado, o incluso el teal oscuro del tema "Tenno" sobre magenta).
 * El fondo plano y los reflejos sólidos del arte casi no tienen bordes.
 */

/** Luma perceptual (0..255). Base de la señal de bordes, independiente del tema. */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Luma de una scanline suavizada con un box filter de radio `radius`.
 * El suavizado promedia el ruido por-píxel (aleatorio → se cancela) sin borrar
 * los bordes de trazo (coherentes en varios px). Sin él, el ruido de captura
 * dispararía |Δluma| como si fuera texto. Devuelve Float32Array(width).
 */
export function smoothedLumaRow(data, off, width, radius) {
    const raw = new Float32Array(width);
    for (let x = 0; x < width; x++) {
        const i = off + x * 4;
        raw[x] = luma(data[i], data[i + 1], data[i + 2]);
    }
    if (radius <= 0) return raw;
    const out = new Float32Array(width);
    let sum = 0;
    for (let x = 0; x <= radius && x < width; x++) sum += raw[x];
    let count = Math.min(radius, width - 1) + 1;
    for (let x = 0; x < width; x++) {
        out[x] = sum / count;
        const add = x + radius + 1, rem = x - radius;
        if (add < width) { sum += raw[add]; count++; }
        if (rem >= 0) { sum -= raw[rem]; count--; }
    }
    return out;
}

const DEFAULTS = {
    edgeDelta: 26,       // |Δluma| entre muestras vecinas para contar un borde de trazo (independiente del tema)
    edgeSmooth: 0,       // radio del box filter anti-ruido; 0 = sin suavizar (los bordes de trazo ya son robustos). Subir solo con ruido de captura extremo
    // --- Señal de COLOR DE NOMBRE (fallback cuando la de bordes colapsa) ---
    // Con fondo CLARO texturizado (nebulosa/estrellas) el ruido mete bordes por
    // todas partes y la señal |Δluma| se satura (todo el frame supera edgeDelta →
    // una sola banda gigante → sin cadena). Y con arte metálico muy contrastado la
    // fase puede engancharse al arte (más bordes que el texto). La señal de color
    // resuelve ambos: los NOMBRES se renderizan en UN color consistente (el del
    // tema); contamos píxeles cercanos a ESE color. El arte metálico es de OTRO
    // color (no puntúa) y los brillos del fondo texturizado son dispersos (no
    // forman banda). Se prueba como fallback y se elige el color cuya cadena de
    // filas tenga las BANDAS MÁS FINAS (el nombre es una franja fina; el arte, un
    // bloque alto), de modo que el anclaje caiga en el nombre y no en el arte.
    bgDistSq: 70 * 70,     // dist² mínima al color de fondo para considerar un píxel "tinta" (candidato a color de nombre)
    mergeColSq: 45 * 45,   // funde colores candidatos más cercanos que esto (antialias/compresión del mismo color)
    nameTolSq: 80 * 80,    // dist² para marcar un píxel como del color de nombre (excluye el arte metálico, a >110)
    maxInkCands: 4,        // nº máximo de colores candidatos a probar como "color de nombre"
    strideX: 2,          // muestreo horizontal para el perfil de filas
    minBandH: 6,         // px: banda más baja que esto = ruido
    maxBandHFrac: 0.25,  // banda más alta que 25% de la imagen = fondo/arte, no texto
    mergeGapY: 12,       // px: une las 2 líneas de un nombre (hueco real medido: 9px a 1440p)
    bandMassFloor: 0.22, // masa mínima relativa a la banda más fuerte (filtra badges/HUD)
    nameBandOffset: 0.75, // top de celda ≈ top de banda de nombre − 0.75·cellH (el nombre empieza al ~75% de la celda)
    nameBaselineOffset: 0.92, // top de celda ≈ BASELINE de nombre (y1) − 0.92·cellH (la baseline de texto está al ~92% del alto de celda, permitiendo que el crop de badge al top 0% atrape el icono x1/x2 perfecto y la zona de nombre 22% no interfiera)
    rows: 3,             // el inventario de Warframe siempre muestra 3 filas
    minCols: 3,
    maxCols: 12,
};

/**
 * Perfil de "texto" por fila: nº de BORDES (|Δluma| grande) por scanline.
 * El texto tiene decenas de bordes por línea (cada trazo de letra entra y sale);
 * un brillo del arte metálico de las cards es un bloque continuo con ~2. Contar
 * bordes por |Δluma| (en vez de píxeles sobre un umbral absoluto de brillo) hace
 * que los nombres dominen los perfiles y el arte/reflejos apenas puntúe, y
 * funciona con cualquier tema de fondo/letra (no asume fondo oscuro).
 */
export function rowProfile(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const prof = new Float32Array(height);
    // Señal de COLOR: si hay máscara de color de nombre, el perfil de fila es el
    // nº de píxeles del color del nombre por scanline (no bordes). Los nombres
    // forman bandas densas; el arte (otro color) y el ruido de fondo (disperso) no.
    if (o.inkMask) {
        const mask = o.inkMask;
        for (let y = 0; y < height; y++) {
            let cnt = 0;
            const rowOff = y * width;
            for (let x = 0; x < width; x += o.strideX) cnt += mask[rowOff + x];
            prof[y] = cnt;
        }
        return prof;
    }
    for (let y = 0; y < height; y++) {
        let cnt = 0;
        let inEdge = false;
        const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
        let prevL = sm[0];
        for (let x = o.strideX; x < width; x += o.strideX) {
            const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
            if (edge && !inEdge) cnt++;
            inEdge = edge;
            prevL = sm[x];
        }
        prof[y] = cnt;
    }
    return prof;
}

/**
 * Detecta bandas horizontales de texto en el perfil de filas.
 * Devuelve [{ y0, y1, mass }] ordenadas por y.
 */
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

    // Une renglones del mismo nombre (nombres a 2 líneas)
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

    // Filtra bandas débiles (badges de cantidad, restos de HUD) frente a la más fuerte
    const maxMass = Math.max(...bands.map(b => b.mass));
    return bands.filter(b => b.mass >= maxMass * o.bandMassFloor);
}

/**
 * Bloques de texto (x-runs) dentro de una banda [y0..y1].
 * Devuelve [{ x0, x1, cx, mass }].
 */
export function blocksInBand(img, y0, y1, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width } = img;
    const col = new Float32Array(width);
    // Señal de COLOR: nº de píxeles del color del nombre por columna en la banda.
    if (o.inkMask) {
        const mask = o.inkMask;
        for (let y = y0; y <= y1; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) col[x] += mask[rowOff + x];
        }
    } else {
    // Igual que rowProfile: BORDES por |Δluma|, no píxeles sobre umbral. Un
    // reflejo sólido del arte solo puntúa en sus dos bordes (≈nada); el texto
    // puntúa en cada trazo de letra. Independiente del tema de fondo/letra.
    for (let y = y0; y <= y1; y++) {
        const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
        let inEdge = false;
        let prevL = sm[0];
        for (let x = 1; x < width; x++) {
            const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
            if (edge && !inEdge) col[x]++;
            inEdge = edge;
            prevL = sm[x];
        }
    }
    }

    const bandH = y1 - y0 + 1;
    const gap = Math.max(6, Math.round(bandH * 1.2)); // espacio entre palabras < gap entre celdas
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

    // Ruido de 1-2 px no es un nombre
    return blocks.filter(b => b.x1 - b.x0 >= 4);
}

/**
 * Busca el mejor subconjunto de posiciones en progresión aritmética:
 * las FILAS reales del grid son bandas equiespaciadas, mientras que el HUD
 * (título, buscador) y los paneles laterales crean bandas a alturas sueltas.
 * items = [{ pos, mass }]. Devuelve { pitch, members: [pos...], score } o null.
 */
export function bestArithmeticChain(items, minPitch, maxPitch, tol = 0.12) {
    const pts = [...items].sort((a, b) => a.pos - b.pos);
    if (pts.length < 2) return null;

    // Alineación de columnas entre dos bandas: nº de centros de bloque de A
    // con un centro de B a menos de tolX. Las filas reales del grid comparten
    // columnas; el HUD (título, iconos, buscador) no se alinea con nada.
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
            // Camina la progresión SIN huecos: las filas del inventario son
            // consecutivas (se llena de arriba a abajo), un salto = no es el grid.
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

            // Poda extremos con paso inconsistente: una banda del HUD pegada al
            // grid (fila de iconos, buscador) puede engancharse a la cadena con
            // un paso ~8% distinto; las filas reales solo varían ~±4% (nombres
            // a 1 vs 2 líneas mueven el top de banda).
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

            // Prioridad: cadenas de ≥3 filas primero; entre ellas manda la MASA
            // (las bandas de nombres pesan ~10× más que las de badges de
            // cantidad, que forman una cadena paralela al mismo pitch y pueden
            // incluso ser más largas si una fila cortada muestra solo badges);
            // después alineación de columnas y por último longitud.
            const cand = { len: members.length, alignment, mass, members: members.map(m => m.pos) };
            const q = c => [c.len >= 3 ? 1 : 0, c.mass, c.alignment, c.len];
            const gt = (a, b) => {
                const qa = q(a), qb = q(b);
                for (let s = 0; s < qa.length; s++) {
                    if (qa[s] !== qb[s]) return qa[s] > qb[s];
                }
                return false;
            };
            if (!best || gt(cand, best)) {
                const steps = [];
                for (let s = 1; s < members.length; s++) steps.push(members[s].pos - members[s - 1].pos);
                cand.pitch = steps.reduce((a, b) => a + b, 0) / steps.length;
                best = cand;
            }
        }
    }
    return best;
}

/**
 * Estima el paso fundamental de una lista de diferencias que son múltiplos
 * (aprox.) de un mismo pitch (celdas vacías ⇒ diffs de 2·Q, 3·Q…).
 * Devuelve { pitch, support } o null.
 */
export function estimatePitch(diffs, tol = 0.12) {
    const ds = diffs.filter(d => d > 0).sort((a, b) => a - b);
    if (!ds.length) return null;
    let best = null;
    // Candidatos: cada diff dividida por 1..3 (por si la mínima ya es un múltiplo)
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

/**
 * Colores dominantes del frame para la señal de color de nombre.
 * Devuelve { bg:[r,g,b], cands:[[r,g,b]…] }: el FONDO (moda de color global) y los
 * colores "tinta" candidatos (modas de los píxeles lejos del fondo, fusionando los
 * cercanos). Uno de los candidatos es el color del NOMBRE; otro suele ser el ARTE
 * metálico. detectInventoryGrid los prueba y se queda con el que da bandas finas.
 */
export function colorInkCandidates(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const key = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const unq = k => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    const hist = new Map();
    for (let y = 0; y < height; y += o.strideX) {
        const rowOff = y * width * 4;
        for (let x = 0; x < width; x += o.strideX) {
            const i = rowOff + x * 4;
            const kk = key(data[i], data[i + 1], data[i + 2]);
            hist.set(kk, (hist.get(kk) || 0) + 1);
        }
    }
    let bgKey = 0, bgC = -1;
    for (const [k, c] of hist) if (c > bgC) { bgC = c; bgKey = k; }
    const bg = unq(bgKey);
    const entries = [...hist.entries()]
        .map(([k, c]) => ({ c, col: unq(k) }))
        .filter(e => {
            const dr = e.col[0] - bg[0], dg = e.col[1] - bg[1], db = e.col[2] - bg[2];
            return dr * dr + dg * dg + db * db > o.bgDistSq;
        })
        .sort((a, b) => b.c - a.c);
    const cands = [];
    for (const e of entries) {
        if (cands.some(c => {
            const dr = c[0] - e.col[0], dg = c[1] - e.col[1], db = c[2] - e.col[2];
            return dr * dr + dg * dg + db * db < o.mergeColSq;
        })) continue;
        cands.push(e.col);
        if (cands.length >= o.maxInkCands) break;
    }
    return { bg, cands };
}

/** Máscara Uint8Array(width·height): 1 donde el píxel está a <√nameTolSq del color. */
function colorInkMask(img, col, tolSq) {
    const { data, width, height } = img;
    const mask = new Uint8Array(width * height);
    const [cr, cg, cb] = col;
    for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
        const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb;
        if (dr * dr + dg * dg + db * db <= tolSq) mask[p] = 1;
    }
    return mask;
}

/**
 * Detección completa. img = { data, width, height } (ImageData-like).
 * Devuelve calibData compatible con buildAutoGrid o null si la señal no da
 * confianza suficiente (⇒ el caller cae a la calibración manual guardada).
 *
 * Estrategia de DOS señales:
 *   1) BORDES (|Δluma|): rápida y probada; primaria. Funciona en la mayoría de
 *      temas (fondo oscuro/claro, texto de cualquier color) y es la que valida el
 *      banco de capturas reales.
 *   2) COLOR DE NOMBRE (fallback): cuando (1) colapsa —fondo claro texturizado que
 *      satura los bordes, o arte metálico que roba el anclaje— se prueba contando
 *      píxeles del color del nombre. Se ensaya cada color candidato del frame y se
 *      elige el que produce las bandas de fila más FINAS (el nombre, no el arte).
 */
export function detectInventoryGrid(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    if (!img?.data || !img.width || !img.height) return null;

    // (1) Señal de bordes (primaria).
    const edgeRes = detectInventoryGridCore(img, opts);
    if (edgeRes) return edgeRes;

    // (2) Fallback por color de nombre. Prueba cada color candidato; se queda con
    // el grid válido cuya banda de fila sea la más fina (texto, no arte metálico).
    const outerTrace = opts.trace || {};
    const { bg, cands } = colorInkCandidates(img, o);
    outerTrace.colorFallback = { bg, cands, tried: [] };
    let best = null;
    for (const col of cands) {
        const mask = colorInkMask(img, col, o.nameTolSq);
        const subTrace = {};
        const res = detectInventoryGridCore(img, { ...opts, inkMask: mask, trace: subTrace });
        outerTrace.colorFallback.tried.push({
            col, ok: !!res,
            nameBandFrac: res ? +res.nameBandFrac.toFixed(3) : null,
            fail: res ? null : subTrace.fail,
        });
        if (!res) continue;
        if (!best || res.nameBandFrac < best.nameBandFrac) { best = res; best._nameColor = col; }
    }
    if (best) {
        best.colorAnchored = true;
        // Color del NOMBRE a nivel de PÁGINA (el que ancló la rejilla). Se pasa a la
        // binarización por celda para no re-detectarlo por-celda (frágil con arte/
        // compresión): en temas de fondo texturizado el texto blanco se perdía en
        // celdas concretas porque la moda de la franja inferior elegía otro color.
        best.nameColor = best._nameColor;
        delete best._nameColor;
        return best;
    }
    outerTrace.fail = outerTrace.fail || "sin señal de bordes ni de color de nombre";
    return null;
}

function detectInventoryGridCore(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { width, height } = img;
    if (!img?.data || !width || !height) return null;
    // opts.trace = {} para recibir el motivo exacto de un fallo (diagnóstico en vivo)
    const trace = o.trace || {};

    const prof = rowProfile(img, o);
    const bands = findBands(prof, height, o);
    trace.bands = bands.map(b => ({ y0: b.y0, y1: b.y1, mass: Math.round(b.mass) }));
    if (bands.length < 2) {
        trace.fail = `bandas de texto insuficientes (${bands.length} < 2) — ¿contraste de bordes por debajo de edgeDelta ${o.edgeDelta}?`;
        return null;
    }

    // Bloques de texto por banda; una banda de nombres real tiene ≥1 bloque
    // "tamaño nombre" (ni una línea de HUD a todo lo ancho, ni un punto suelto)
    // Nombres anchos y a 2 líneas pueden FUSIONAR celdas vecinas en un solo
    // bloque (el hueco entre celdas es menor que el alto de banda): el filtro
    // de ancho debe tolerarlo — solo descarta líneas de borde a borde.
    const bandBlocks = bands.map(b => ({
        band: b,
        blocks: blocksInBand(img, b.y0, b.y1, o).filter(bl =>
            (bl.x1 - bl.x0) < width * 0.9
        ),
    })).filter(bb => bb.blocks.length >= 1);
    trace.bandBlocks = bandBlocks.map(bb => ({ y0: bb.band.y0, blocks: bb.blocks.length }));
    if (bandBlocks.length < 2) {
        trace.fail = `bandas con bloques válidos insuficientes (${bandBlocks.length} < 2) — ¿bloques de borde a borde (>90% del frame) o ruido?`;
        return null;
    }

    // --- Pitch vertical (cellH): cadena aritmética de bandas ---
    // El HUD (título INVENTORY/SELL, buscador…) y los paneles laterales (SELL
    // ITEMS, TOTAL…) crean bandas a alturas arbitrarias: solo las filas reales
    // forman una progresión equiespaciada. Nos quedamos con esa cadena.
    // Las bandas del ~20% superior son SIEMPRE HUD (título, pestañas, buscador:
    // ≤17% en todas las capturas reales; el grid nunca empieza antes del 23%)
    // y pueden engancharse a la cadena con paso casualmente consistente.
    const hudLimit = height * 0.2;
    // Ancla de fila = BASE de la banda (y1), no el top (y0). Los nombres de los
    // ítems están anclados ABAJO en la card: un nombre a 2 líneas crece hacia
    // ARRIBA, así que su top (y0) salta ~una altura de línea entre filas de 1 y 2
    // líneas (±15% del pitch a 1440p) y rompe la cadena aritmética; su base (y1)
    // se mantiene en la misma baseline y las filas quedan equidistantes. El top real
    // del nombre lo re-deriva el fold de abajo.
    // El filtro de HUD es por BASELINE (y1), no por top (y0): al FINAL de la lista la
    // 1ª fila se scrollea hacia arriba y su top y0 cae dentro de la franja HUD (<0.2·h)
    // aunque su baseline y1 esté bien abajo (fila real); filtrar por y0 la descartaba
    // ("solo 2 filas"). El HUD real (título/pestañas/buscador) tiene y1 ≤ ~0.16·h.
    const chainItems = bandBlocks.filter(bb => bb.band.y1 >= hudLimit).map(bb => ({
        pos: bb.band.y1,
        mass: bb.blocks.reduce((s, bl) => s + bl.mass, 0),
        centers: bb.blocks.map(bl => bl.cx),
    }));
    const chain = bestArithmeticChain(chainItems, height * 0.12, height * 0.5);
    trace.chain = chain ? { pitch: Math.round(chain.pitch), members: chain.members } : null;
    // Se exigen las 3 filas del inventario: con 2 bandas cualquier par forma
    // "cadena" y el pitch no está corroborado (2 pasos consistentes sí lo están).
    if (!chain || chain.members.length < o.rows) {
        trace.fail = chain
            ? `cadena de solo ${chain.members.length} filas (<${o.rows}) — pitch sin corroborar`
            : "sin cadena de filas equiespaciadas (¿solo HUD/paneles, sin grid visible?)";
        return null;
    }
    let cellH = Math.round(chain.pitch);

    // --- Re-anclaje de filas: ¿la cadena son NOMBRES o BADGES/otros? ---
    // Los badges de cantidad forman una cadena paralela al mismo pitch (una por
    // fila, desfasada ~0.6·cellH de los nombres). El pitch de la cadena vale
    // igual, pero la fase debe anclarse en los nombres: se pliega el perfil de
    // filas módulo cellH dentro del rango del grid y se busca el ARCO más
    // pesado (los nombres concentran mucha más masa que badges o restos).
    // La cadena se ancló en la BASE de banda (y1) para un pitch robusto, pero el
    // fold necesita el TOP del nombre (y0) como referencia de fase. Recuperamos el
    // y0 de la banda de cada extremo de la cadena.
    const y1ToTop = new Map(bandBlocks.map(bb => [bb.band.y1, bb.band.y0]));
    const base = y1ToTop.get(chain.members[0]) ?? chain.members[0];
    const last = y1ToTop.get(chain.members[chain.members.length - 1]) ?? chain.members[chain.members.length - 1];
    const foldY0 = Math.max(Math.ceil(hudLimit), base - cellH);
    const foldY1 = Math.min(height - 1, last + cellH);
    const fold = new Float32Array(cellH);
    for (let y = foldY0; y <= foldY1; y++) {
        fold[((y - base) % cellH + cellH) % cellH] += prof[y];
    }
    const arcLen = Math.max(2, Math.round(cellH * 0.35));
    let arcSum = 0;
    for (let i = 0; i < arcLen; i++) arcSum += fold[i];
    let bestArc = 0, bestArcSum = arcSum;
    for (let s = 1; s < cellH; s++) {
        arcSum += fold[(s + arcLen - 1) % cellH] - fold[s - 1];
        if (arcSum > bestArcSum) { bestArcSum = arcSum; bestArc = s; }
    }
    // Top de banda de nombres en fase: base + bestArc (mod cellH), representado
    // lo más cerca posible de base
    const nameBase = base + (bestArc <= cellH / 2 ? bestArc : bestArc - cellH);

    // Filas del grid. Se matchea cada slot k por DOBLE criterio (dinámico, no asume
    // resolución): una banda cae en la fila k si su TOP (y0) coincide con el slot de
    // top (nameBase + k·cellH) O su BASE (y1) con el slot de baseline (baseY1 + k·cellH).
    //   - y1/baseline: robusto cuando el arte del ítem se fusiona con el nombre por
    //     ARRIBA (banda alta, p.ej. la fila central de armas) y desplaza el top y0.
    //   - y0/top: robusto cuando una fila ASOMA cortada por abajo (final de lista) y
    //     su baseline y1 queda fuera del frame.
    // usedTops guarda el y0 real del nombre para el resto del pipeline.
    const baseY1 = chain.members[0];
    const rowBands = [];
    const usedTops = [];
    const tol = cellH * 0.2;
    const kMin = Math.floor((hudLimit - baseY1) / cellH) - 1;
    const kMax = Math.ceil((height - baseY1) / cellH) + 1;
    for (let k = kMin; k <= kMax; k++) {
        const topSlot = nameBase + k * cellH;
        const baseSlot = baseY1 + k * cellH;
        if (baseSlot < hudLimit && topSlot < hudLimit) continue;
        let bb = null, bbErr = Infinity;
        for (const cand2 of bandBlocks) {
            if (cand2.band.y1 < hudLimit) continue;
            const err = Math.min(Math.abs(cand2.band.y0 - topSlot), Math.abs(cand2.band.y1 - baseSlot));
            if (err <= tol && err < bbErr) { bb = cand2; bbErr = err; }
        }
        if (bb && !rowBands.includes(bb)) { rowBands.push(bb); usedTops.push(bb.band.y0); }
    }
    // --- Guardia de MEDIO PITCH: badges intercalados a ~cellH/2 de los nombres ---
    // Si los badges caen casi equidistantes entre dos filas de nombres, la
    // cadena badge→nombre→badge tiene pasos casi iguales y cuela un pitch de
    // cellH/2 (síntoma: filas alternas leyendo arte, badges siempre vacíos).
    // Las filas alternas tendrían masas muy asimétricas (nombres ≫ badges):
    // en ese caso el pitch real es el doble y nos quedamos con las pesadas.
    if (rowBands.length >= 5) {
        const bandMass = bb => bb.blocks.reduce((s, bl) => s + bl.mass, 0);
        let even = 0, odd = 0;
        for (const bb of rowBands) {
            const k = Math.round((bb.band.y0 - rowBands[0].band.y0) / cellH);
            if (k % 2 === 0) even += bandMass(bb);
            else odd += bandMass(bb);
        }
        if (Math.min(even, odd) < Math.max(even, odd) * 0.6) {
            const keepParity = even >= odd ? 0 : 1;
            const kept = rowBands.filter(bb =>
                Math.round((bb.band.y0 - rowBands[0].band.y0) / cellH) % 2 === keepParity
            );
            trace.halfPitchFixed = { cellHBefore: cellH, kept: kept.map(bb => bb.band.y0) };
            cellH *= 2;
            rowBands.length = 0;
            rowBands.push(...kept);
            usedTops.length = 0;
            usedTops.push(...kept.map(bb => bb.band.y0));
        }
    }

    trace.rowBands = usedTops;
    if (rowBands.length < o.rows) {
        trace.fail = `solo ${rowBands.length} filas de nombres tras re-anclar (<${o.rows})`;
        return null;
    }

    // --- Pitch horizontal (cellW) por AUTOCORRELACIÓN del perfil de columnas ---
    // Los nombres largos fusionan bloques de celdas vecinas (el hueco entre
    // celdas puede ser menor que un espacio entre palabras a 2 líneas), así que
    // los centros de bloque NO son fiables. La periodicidad del perfil sumado
    // sobre las filas de la cadena sí lo es, y no depende de ningún umbral de
    // separación.
    const colProf = new Float32Array(width);
    const { data } = img;
    for (const bb of rowBands) {
        for (let y = bb.band.y0; y <= bb.band.y1; y++) {
            if (o.inkMask) {
                const rowOff = y * width;
                for (let x = 0; x < width; x++) colProf[x] += o.inkMask[rowOff + x];
                continue;
            }
            const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
            let inEdge = false;
            let prevL = sm[0];
            for (let x = 1; x < width; x++) {
                const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
                if (edge && !inEdge) colProf[x]++;
                inEdge = edge;
                prevL = sm[x];
            }
        }
    }

    const minQ = Math.max(8, Math.floor(cellH * 0.5));
    const maxQ = Math.min(width >> 1, Math.ceil(cellH * 1.8));
    let bestQ = 0, bestR = -1;
    for (let q = minQ; q <= maxQ; q++) {
        let r = 0;
        for (let x = 0; x + q < width; x++) r += colProf[x] * colProf[x + q];
        if (r > bestR) { bestR = r; bestQ = q; }
    }
    if (!bestQ || bestR <= 0) {
        trace.fail = "sin periodicidad horizontal en las filas detectadas";
        return null;
    }
    const cellW = bestQ;

    // --- Fase horizontal: las FRONTERAS entre celdas son valles sin texto ---
    // Busca el desfase b que minimiza el perfil en x = b + k·cellW dentro del
    // rango ocupado por texto; ahí están los bordes de celda.
    let xMin = -1, xMax = -1;
    let maxP = 0;
    for (let x = 0; x < width; x++) if (colProf[x] > maxP) maxP = colProf[x];
    const occThr = Math.max(1, maxP * 0.05);
    for (let x = 0; x < width; x++) {
        if (colProf[x] >= occThr) { if (xMin < 0) xMin = x; xMax = x; }
    }
    if (xMin < 0 || xMax - xMin < cellW) {
        trace.fail = "rango horizontal ocupado demasiado estrecho";
        return null;
    }

    // Se evalúa cada CLASE DE RESIDUO r (mod cellW): los bordes de celda están
    // en x ≡ r*, la clase con menos texto. Solo se muestrea dentro del rango
    // ocupado [xMin, xMax] para no premiar fases con bordes en el vacío.
    const mod = (a, m) => ((a % m) + m) % m;
    const win = Math.max(2, Math.round(cellW * 0.03));
    const avgByR = new Float32Array(cellW).fill(Infinity);
    let bestValley = Infinity;
    for (let r = 0; r < cellW; r++) {
        let s = 0, n = 0;
        for (let x = xMin + mod(r - xMin, cellW); x <= xMax; x += cellW) {
            for (let dx = -win; dx <= win; dx++) {
                const xx = x + dx;
                if (xx >= xMin && xx <= xMax) { s += colProf[xx]; n++; }
            }
        }
        if (!n) continue;
        avgByR[r] = s / n;
        if (avgByR[r] < bestValley) bestValley = avgByR[r];
    }
    // El valle puede ser ancho (nombres cortos ⇒ mucho hueco entre celdas): el
    // borde real es su CENTRO, no cualquier punto del fondo. Se toma el centro
    // de la racha circular más larga de residuos ~al nivel del mínimo.
    const tau = bestValley * 1.2 + 0.5;
    let runStart = -1, runLen = 0, bestStart = 0, bestLen = 0;
    for (let r = 0; r < cellW * 2; r++) {
        if (avgByR[r % cellW] <= tau) {
            if (runStart < 0) runStart = r;
            runLen = r - runStart + 1;
            if (runLen > bestLen && runLen <= cellW) { bestLen = runLen; bestStart = runStart; }
        } else {
            runStart = -1;
        }
    }
    const bestR2 = mod(bestStart + Math.floor(bestLen / 2), cellW);

    // Bordes de celda: e ≡ r* (mod cellW). El izquierdo es el mayor borde
    // ≤ xMin; el derecho, el menor borde ≥ xMax.
    let gridXf = xMin - mod(xMin - bestR2, cellW);
    let rightEdge = gridXf;
    while (rightEdge < xMax) rightEdge += cellW;
    let cols = Math.round((rightEdge - gridXf) / cellW);

    // --- AÍSLA la zona del grid: recorte por ocupación de celda ---
    // Texto ajeno a la misma altura que una fila (contador de platino, panel
    // lateral) estira xMin/xMax y cuela columnas fantasma. Las columnas reales
    // tienen nombres en (casi) todas las filas: nos quedamos con la racha
    // contigua de celdas más larga con ocupación significativa.
    if (cols >= 2) {
        // Ocupación de cada columna = en CUÁNTAS FILAS tiene texto significativo.
        // maxRow[ri] normaliza por fila (el arte de una fila no infla otras). Una
        // columna cuenta como "ocupada en la fila ri" si su masa en esa fila supera
        // el 12% del máximo de la fila. Así el panel de venta / starfield (texto en
        // pocas filas) no sostiene columnas fantasma frente al grid (texto en todas).
        // Perfil de columna POR FILA (no la suma global): así se puede exigir
        // presencia en VARIAS filas. Sumando la masa total, una columna con mucho
        // texto en UNA sola fila (panel lateral "SELECT ITEMS…") puntúa igual que
        // una del grid con nombres en las tres, y las columnas fantasma sobrevivían.
        const perRow = rowBands.map((bb) => {
            const prof = new Float32Array(width);
            for (let y = bb.band.y0; y <= bb.band.y1; y++) {
                if (o.inkMask) {
                    const rowOff = y * width;
                    for (let x = 0; x < width; x++) prof[x] += o.inkMask[rowOff + x];
                    continue;
                }
                const sm = smoothedLumaRow(data, y * width * 4, width, o.edgeSmooth);
                let inEdge = false, prevL = sm[0];
                for (let x = 1; x < width; x++) {
                    const edge = Math.abs(sm[x] - prevL) > o.edgeDelta;
                    if (edge && !inEdge) prof[x]++;
                    inEdge = edge;
                    prevL = sm[x];
                }
            }
            return prof;
        });

        // occ[k] = en cuántas filas la columna k tiene texto significativo
        // (>12% del máximo de ESA fila, para que el arte de una fila no infle otras).
        const occ = new Array(cols).fill(0);
        for (const prof of perRow) {
            const massK = [];
            for (let k = 0; k < cols; k++) {
                const a = Math.max(0, Math.round(gridXf + k * cellW));
                const b = Math.min(width - 1, Math.round(gridXf + (k + 1) * cellW));
                let s = 0;
                for (let x = a; x <= b; x++) s += prof[x];
                massK.push(s);
            }
            const rowMax = Math.max(...massK);
            if (rowMax <= 0) continue;
            for (let k = 0; k < cols; k++) if (massK[k] >= rowMax * 0.12) occ[k]++;
        }
        trace.occCols = [...occ];
        // Racha contigua de columnas con texto en alguna fila: una columna del grid
        // puede estar vacía en TODAS las filas visibles (inventario a medio llenar),
        // así que la ocupación por sí sola no distingue "columna del grid vacía" de
        // "texto ajeno". Lo que sí las separa es la CONTIGÜIDAD: dentro del grid los
        // huecos quedan rodeados de columnas ocupadas, mientras que el panel lateral
        // está separado del grid por al menos una columna vacía.
        let bs = 0, bl = 0, cs = -1;
        for (let k = 0; k <= cols; k++) {
            if (k < cols && occ[k] >= 1) {
                if (cs < 0) cs = k;
                if (k - cs + 1 > bl) { bl = k - cs + 1; bs = cs; }
            } else {
                cs = -1;
            }
        }
        // Si la racha sigue siendo mayor que un grid plausible, se recortan por los
        // EXTREMOS las columnas flojas (ocupación muy por debajo del máximo): el
        // panel lateral pegado al grid aparece en una fila suelta, mientras que las
        // columnas reales del grid aparecen en (casi) todas. El interior nunca se
        // toca: ahí los huecos son legítimos.
        // Solo se recorta cuando la racha excede lo que el ancho ocupado por columnas
        // FUERTES (presentes en todas las filas) justifica: si hay 6 columnas al
        // máximo y la racha mide 8, las 2 flojas de los extremos son el panel lateral.
        // Si el grid está a medio llenar (varias columnas flojas repartidas), no hay
        // bloque fuerte dominante y no se toca nada.
        const maxOcc = Math.max(...occ);
        if (maxOcc >= 3) {
            let strongFirst = -1, strongLast = -1;
            for (let k = bs; k < bs + bl; k++) {
                if (occ[k] >= maxOcc) { if (strongFirst < 0) strongFirst = k; strongLast = k; }
            }
            // El bloque fuerte debe ser CONTIGUO y cubrir casi toda su extensión para
            // considerarlo "el grid" (evita recortar por un pico aislado).
            if (strongFirst >= 0) {
                let strongCount = 0;
                for (let k = strongFirst; k <= strongLast; k++) if (occ[k] >= maxOcc) strongCount++;
                const span = strongLast - strongFirst + 1;
                if (strongCount === span && span >= o.minCols) {
                    bs = strongFirst;
                    bl = span;
                }
            }
        }
        if (bl >= 1 && bl < cols) {
            trace.trimmedCols = { before: cols, kept: bl, from: bs };
            gridXf += bs * cellW;
            cols = bl;
        }
    }
    // <3 columnas visibles no da confianza; >12 es imposible en Warframe ⇒ señal rota
    if (cols < o.minCols || cols > o.maxCols) {
        trace.fail = `columnas fuera de rango: ${cols}`;
        return null;
    }
    const gridX = Math.max(0, Math.round(gridXf));

    // --- Fase vertical: top de celda desde la BASELINE (y1) de la primera fila ---
    // Se ancla por la BASE del nombre (y1), NO por el top (y0): cuando el arte
    // metálico del ítem tiene mucho borde (temas vistosos) se FUSIONA con el nombre
    // en una sola banda alta cuyo y0 es el top del ARTE (no del nombre) → anclar por
    // y0 dejaba la celda ~0.6·cellH demasiado arriba y el recorte de nombre caía
    // sobre el arte. El y1 (baseline del texto) es inmune a esa fusión (el arte funde
    // por arriba). Fallback a y0 si por algún motivo no hay y1. (detectRowPhase afina
    // el resto, pero ahora parte de un anclaje correcto.)
    const firstBand = rowBands[0].band;
    const gridY = firstBand.y1
        ? Math.round(firstBand.y1 - cellH * o.nameBaselineOffset)
        : Math.round(usedTops[0] - cellH * o.nameBandOffset);

    // Una banda por fila real detectada (puede haber una 4ª fila asomando);
    // las celdas que caigan fuera del frame las filtra _applyRowPhase después.
    const rows = rowBands.length;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    // Confianza: filas corroboradas y columnas encontradas
    const confidence = Math.min(1, (chain.members.length + cols) / 10);

    // Grosor RELATIVO de las bandas de fila (mediana). Sirve para desempatar entre
    // colores candidatos en la señal de color: el NOMBRE es una franja fina
    // (~0.12–0.24·cellH); el ARTE metálico, un bloque alto (~0.45·cellH). Al elegir
    // el color con la banda más fina, el anclaje cae en el nombre y no en el arte.
    const bandHs = rowBands.map(bb => bb.band.y1 - bb.band.y0 + 1).sort((a, b) => a - b);
    const nameBandFrac = bandHs.length ? bandHs[bandHs.length >> 1] / cellH : 1;

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
        nameBandFrac,
    };
}

/**
 * Guarda de plausibilidad para una calibración de rejilla GUARDADA (manual) que se
 * va a usar como fallback cuando el auto-grid no da señal este frame. La calibración
 * manual deriva las columnas de un simple ratio de aspecto de la caja arrastrada
 * (live_calibration.saveGrid), así que una caja mal dibujada (p.ej. toda la pantalla)
 * produce una rejilla basura —celdas enormes, columnas equivocadas, la zona invade el
 * panel de venta de la derecha— y recorta ítems/badges partidos. Preferimos NO escanear
 * a escanear con una rejilla basura.
 *
 * Una rejilla de inventario real ocupa ~11% del ancho por celda y ~20% del alto por
 * fila, y su zona no llega al panel lateral (~65% del ancho). Se rechaza si la zona
 * abarca casi todo el frame o si las celdas son desproporcionadamente grandes.
 *
 * @returns {boolean} true si la calibración es implausible y NO debe usarse.
 */
export function isImplausibleFallbackGrid(calib, frameW, frameH) {
    if (!calib || !frameW || !frameH) return true;
    const zone = calib.gridZone;
    if (!zone || !zone.w || !zone.h) return true;
    if (zone.w > frameW * 0.85) return true; // zona invade el panel de venta / todo el ancho
    if (calib.cellW && calib.cellW > frameW * 0.16) return true; // celdas demasiado anchas (pocas columnas)
    if (calib.cellH && calib.cellH > frameH * 0.28) return true; // filas demasiado altas
    return false;
}

const REWARD_DEFAULTS = {
    ...DEFAULTS,
    // Las cards de recompensa NO están donde el frame de cámara "dice" que deberían
    // (18.5%-44% de altura) cuando la foto viene de una webcam apuntando a un monitor
    // externo en vez de la propia pantalla del móvil: el juego solo ocupa una fracción
    // del encuadre (bisel, pared, techo alrededor). Se busca la banda en TODO el alto
    // del frame, no en un recorte fijo — la señal (texto brillante en banda ancha) es
    // la misma que detecta nombres de inventario, solo que aquí buscamos LA banda más
    // fuerte de todo el frame en vez de una cadena de 3 filas equiespaciadas.
    minCardW: 0.08,   // una card de recompensa nunca es más angosta que ~8% del ancho de SU banda
    maxCards: 4,
    minCards: 1,
};

/**
 * Localiza la banda de nombres de recompensa (2-4 cards horizontales) en CUALQUIER
 * posición del frame, sin asumir que el juego ocupa el encuadre completo de cámara.
 * Reutiliza la misma señal que detectInventoryGrid (bordes |Δluma|, con fallback a
 * color de tinta dominante) pero busca la banda de mayor masa en vez de una cadena
 * arithmetic de filas — las cards de recompensa son una fila ÚNICA, no una rejilla.
 *
 * Devuelve { x, y, w, h, cardCount, cardBoxes } en PÍXELES del frame de entrada, o
 * null si no se encontró ninguna banda plausible (frame no es la pantalla de rewards,
 * o está demasiado borroso/oscuro para que el texto produzca señal).
 */
export function detectRewardBand(img, opts = {}) {
    const o = { ...REWARD_DEFAULTS, ...opts };
    if (!img?.data || !img.width || !img.height) return null;

    const tryBands = (bandOpts) => {
        const prof = rowProfile(img, bandOpts);
        return findBands(prof, img.height, bandOpts);
    };

    const pickBest = (bands, bandOpts) => {
        let best = null;
        for (const band of bands) {
            const blocks = blocksInBand(img, band.y0, band.y1, bandOpts)
                .filter(b => (b.x1 - b.x0) >= img.width * o.minCardW);
            if (blocks.length < o.minCards || blocks.length > o.maxCards) continue;
            // La banda real de recompensas es la de mayor masa total de texto entre
            // las que producen un nº plausible de bloques (2-4): el HUD (título,
            // contador "2", nombres de squad bajo las cards) también produce bandas,
            // pero su masa de texto es muchísimo menor que 2-4 nombres de ítem juntos.
            if (!best || band.mass > best.band.mass) best = { band, blocks };
        }
        return best;
    };

    // (1) Señal de bordes (primaria) sobre todo el frame.
    let bands = tryBands(o);
    let result = pickBest(bands, o);

    // (2) Fallback color de tinta dominante — mismo motivo que detectInventoryGrid:
    // fondo claro texturizado satura los bordes y la banda de nombres deja de
    // sobresalir del ruido.
    if (!result) {
        const { cands } = colorInkCandidates(img, o);
        for (const col of cands) {
            const mask = colorInkMask(img, col, o.nameTolSq);
            const colorOpts = { ...o, inkMask: mask };
            const cBands = tryBands(colorOpts);
            const cResult = pickBest(cBands, colorOpts);
            if (cResult && (!result || cResult.band.mass > result.band.mass)) result = cResult;
        }
    }

    if (!result) return null;

    const { band, blocks } = result;
    const x0 = Math.min(...blocks.map(b => b.x0));
    const x1 = Math.max(...blocks.map(b => b.x1));
    // Margen alrededor del bounding box ajustado de los NOMBRES: el recorte real de
    // recompensas (prepareRewardOCRCanvas) necesita ver también el badge Owned/Crafted
    // encima y algo de aire a los lados — los nombres solos son más angostos que la card.
    const padX = (x1 - x0) * 0.15;
    const padYTop = (band.y1 - band.y0) * 3.0;
    const padYBottom = (band.y1 - band.y0) * 1.2;

    const x = Math.max(0, x0 - padX);
    const w = Math.min(img.width - x, (x1 - x0) + padX * 2);
    const y = Math.max(0, band.y0 - padYTop);
    const h = Math.min(img.height - y, (band.y1 - band.y0) + padYTop + padYBottom);

    return { x, y, w, h, cardCount: blocks.length, cardBoxes: blocks };
}
