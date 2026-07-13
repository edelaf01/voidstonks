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
    const chainItems = bandBlocks.filter(bb => bb.band.y0 >= hudLimit).map(bb => ({
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
    let cellH = Math.round(chain.pitch);

    // --- Re-anclaje de filas: ¿la cadena son NOMBRES o BADGES/otros? ---
    // Los badges de cantidad forman una cadena paralela al mismo pitch (una por
    // fila, desfasada ~0.6·cellH de los nombres). El pitch de la cadena vale
    // igual, pero la fase debe anclarse en los nombres: se pliega el perfil de
    // filas módulo cellH dentro del rango del grid y se busca el ARCO más
    // pesado (los nombres concentran mucha más masa que badges o restos).
    const base = chain.members[0];
    const last = chain.members[chain.members.length - 1];
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

    // Filas = bandas cualificadas que caen en los slots nameBase + k·cellH
    const rowBands = [];
    const usedTops = [];
    for (let t = nameBase - Math.ceil((nameBase - hudLimit) / cellH) * cellH; t < height; t += cellH) {
        if (t < hudLimit - cellH * 0.2) continue;
        let bb = null;
        for (const cand2 of bandBlocks) {
            if (cand2.band.y0 >= hudLimit && Math.abs(cand2.band.y0 - t) <= cellH * 0.2 &&
                (!bb || Math.abs(cand2.band.y0 - t) < Math.abs(bb.band.y0 - t))) {
                bb = cand2;
            }
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
            const off = y * width * 4;
            for (let x = 0; x < width; x++) {
                const i = off + x * 4;
                const mx = Math.max(data[i], data[i + 1], data[i + 2]);
                if (mx > o.brightThresh) colProf[x]++;
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
        const occ = new Array(cols).fill(0);
        for (let k = 0; k < cols; k++) {
            const a = Math.max(0, Math.round(gridXf + k * cellW));
            const b = Math.min(width - 1, Math.round(gridXf + (k + 1) * cellW));
            for (let x = a; x <= b; x++) occ[k] += colProf[x];
        }
        const maxOcc = Math.max(...occ);
        const occThr2 = maxOcc * 0.15;
        let bs = 0, bl = 0, cs = -1;
        for (let k = 0; k <= cols; k++) {
            if (k < cols && occ[k] >= occThr2) {
                if (cs < 0) cs = k;
                if (k - cs + 1 > bl) { bl = k - cs + 1; bs = cs; }
            } else {
                cs = -1;
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

    // --- Fase vertical: top de celda desde la PRIMERA banda de la cadena ---
    // (no la primera banda global, que puede ser el título del HUD;
    // detectRowPhase/_applyRowPhase afina el desfase real después)
    const firstTop = usedTops[0];
    const gridY = Math.round(firstTop - cellH * o.nameBandOffset);

    // Una banda por fila real detectada (puede haber una 4ª fila asomando);
    // las celdas que caigan fuera del frame las filtra _applyRowPhase después.
    const rows = rowBands.length;
    const gridW = Math.min(cols * cellW, width - gridX);
    const gridH = Math.min(rows * cellH, height - Math.max(0, gridY));

    // Confianza: filas corroboradas y columnas encontradas
    const confidence = Math.min(1, (chain.members.length + cols) / 10);

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
