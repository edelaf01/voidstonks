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
 */

const DEFAULTS = {
    brightThresh: 185,   // canal máximo, igual que detectRowPhase (cubre texto blanco y de tema)
    strideX: 2,          // muestreo horizontal para el perfil de filas
    minBandH: 6,         // px: banda más baja que esto = ruido
    maxBandHFrac: 0.25,  // banda más alta que 25% de la imagen = fondo/arte, no texto
    mergeGapY: 5,        // px: une las 2 líneas de un nombre partido en dos renglones
    bandMassFloor: 0.22, // masa mínima relativa a la banda más fuerte (filtra badges/HUD)
    nameBandOffset: 0.60, // top de celda ≈ top de banda de nombre − 0.60·cellH (fase fina la ajusta detectRowPhase)
    rows: 3,             // el inventario de Warframe siempre muestra 3 filas
    minCols: 3,
    maxCols: 12,
};

/** Perfil de brillo por fila: nº de píxeles "de texto" en cada scanline. */
export function rowProfile(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { data, width, height } = img;
    const prof = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let cnt = 0;
        const off = y * width * 4;
        for (let x = 0; x < width; x += o.strideX) {
            const i = off + x * 4;
            const mx = Math.max(data[i], data[i + 1], data[i + 2]);
            if (mx > o.brightThresh) cnt++;
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
    for (let y = y0; y <= y1; y++) {
        const off = y * width * 4;
        for (let x = 0; x < width; x++) {
            const i = off + x * 4;
            const mx = Math.max(data[i], data[i + 1], data[i + 2]);
            if (mx > o.brightThresh) col[x]++;
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

            // Prioridad: nº de filas > alineación de columnas > masa
            const cand = { len: members.length, alignment, mass, members: members.map(m => m.pos) };
            if (!best ||
                cand.len > best.len ||
                (cand.len === best.len && cand.alignment > best.alignment) ||
                (cand.len === best.len && cand.alignment === best.alignment && cand.mass > best.mass)) {
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
 * Detección completa. img = { data, width, height } (ImageData-like).
 * Devuelve calibData compatible con buildAutoGrid o null si la señal no da
 * confianza suficiente (⇒ el caller cae a la calibración manual guardada).
 */
export function detectInventoryGrid(img, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { width, height } = img;
    if (!img?.data || !width || !height) return null;
    // opts.trace = {} para recibir el motivo exacto de un fallo (diagnóstico en vivo)
    const trace = o.trace || {};

    const prof = rowProfile(img, o);
    const bands = findBands(prof, height, o);
    trace.bands = bands.map(b => ({ y0: b.y0, y1: b.y1, mass: Math.round(b.mass) }));
    if (bands.length < 2) {
        trace.fail = `bandas de texto insuficientes (${bands.length} < 2) — ¿texto por debajo del umbral de brillo ${o.brightThresh}?`;
        return null;
    }

    // Bloques de texto por banda; una banda de nombres real tiene ≥1 bloque
    // "tamaño nombre" (ni una línea de HUD a todo lo ancho, ni un punto suelto)
    const bandBlocks = bands.map(b => ({
        band: b,
        blocks: blocksInBand(img, b.y0, b.y1, o).filter(bl =>
            (bl.x1 - bl.x0) < width * 0.35
        ),
    })).filter(bb => bb.blocks.length >= 1);
    trace.bandBlocks = bandBlocks.map(bb => ({ y0: bb.band.y0, blocks: bb.blocks.length }));
    if (bandBlocks.length < 2) {
        trace.fail = `bandas con bloques válidos insuficientes (${bandBlocks.length} < 2) — ¿bloques demasiado anchos (>35% del frame) o ruido?`;
        return null;
    }

    // --- Pitch vertical (cellH): cadena aritmética de bandas ---
    // El HUD (título INVENTORY/SELL, buscador…) y los paneles laterales (SELL
    // ITEMS, TOTAL…) crean bandas a alturas arbitrarias: solo las filas reales
    // forman una progresión equiespaciada. Nos quedamos con esa cadena.
    const chainItems = bandBlocks.map(bb => ({
        pos: bb.band.y0,
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
    const cellH = Math.round(chain.pitch);
    const chainSet = new Set(chain.members);
    const rowBands = bandBlocks.filter(bb => chainSet.has(bb.band.y0));

    // --- Pitch horizontal (cellW): SOLO con bloques de las bandas de la cadena ---
    const hDiffs = [];
    for (const bb of rowBands) {
        const cs = bb.blocks.map(b => b.cx).sort((a, b) => a - b);
        for (let i = 1; i < cs.length; i++) hDiffs.push(cs[i] - cs[i - 1]);
    }
    const hPitch = estimatePitch(hDiffs);
    if (!hPitch) {
        trace.fail = "sin pitch horizontal (¿una sola columna con ítems?)";
        return null;
    }
    const cellW = Math.round(hPitch.pitch);
    // Aspecto de celda plausible del inventario de Warframe
    if (cellW < cellH * 0.5 || cellW > cellH * 1.8) {
        trace.fail = `aspecto de celda implausible: cellW ${cellW} vs cellH ${cellH}`;
        return null;
    }

    // --- Fase horizontal: asigna índice de columna a cada centro de bloque ---
    const centers = rowBands.flatMap(bb => bb.blocks.map(b => b.cx)).sort((a, b) => a - b);
    const ref = centers[0];
    const lefts = [];
    let minCi = Infinity, maxCi = -Infinity;
    for (const cx of centers) {
        const ci = Math.round((cx - ref) / cellW);
        minCi = Math.min(minCi, ci);
        maxCi = Math.max(maxCi, ci);
        lefts.push(cx - ci * cellW - cellW / 2);
    }
    lefts.sort((a, b) => a - b);
    const gridXfloat = lefts[Math.floor(lefts.length / 2)] + minCi * cellW;
    const cols = maxCi - minCi + 1;
    // <3 columnas visibles no da confianza; >12 es imposible en Warframe ⇒ señal rota
    if (cols < o.minCols || cols > o.maxCols) {
        trace.fail = `columnas fuera de rango: ${cols}`;
        return null;
    }
    const gridX = Math.max(0, Math.round(gridXfloat));

    // --- Fase vertical: top de celda desde la PRIMERA banda de la cadena ---
    // (no la primera banda global, que puede ser el título del HUD;
    // detectRowPhase/_applyRowPhase afina el desfase real después)
    const firstTop = chain.members[0];
    const gridY = Math.round(firstTop - cellH * o.nameBandOffset);

    const rows = o.rows;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    // Confianza: cuántas evidencias respaldan los dos pitches
    const confidence = Math.min(1, (chain.members.length + hPitch.support) / 8);

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
    };
}
