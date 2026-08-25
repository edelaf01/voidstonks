/**
 * Acotado de la pantalla MISSION COMPLETE: primero la ZONA de recompensas, luego las
 * CASILLAS que de verdad tienen algo dentro, y de cada casilla si lleva ROTULO y qué
 * CANTIDAD marca su badge.
 *
 * Lógica 100% pura sobre un objeto tipo ImageData ({ data, width, height }): sin DOM ni
 * canvas, para poder medirla offline con capturas reales.
 *
 * SEÑAL: el ✓ que el juego pinta en la esquina de cada recompensa. Es un anillo del color
 * del tema, cuadrado, de lado ~0.021·H, y cae en una retícula exacta. Medido sobre capturas
 * reales: 13/13 aciertos a 1439, 1200, 1080, 900, 768 y 720 px de alto, con el paso y el
 * origen escalando de forma proporcional.
 *
 * Se eligió el ✓ y no el rectángulo de la celda porque el hueco entre celdas es una caída de
 * luma de 27 a 23 (sobre 255): periódica, sí, pero tan tenue que la autocorrelación en Y se
 * la come el contenido (r=0.21 frente al 0.54 de X). El ✓ no depende de eso.
 *
 * Tampoco vale `detectInventoryGrid`: sobre esta pantalla devuelve cols=7 / cellW=256 con
 * confianza 1, fundiendo el panel de sindicatos con el de recompensas. Plausible y falso.
 */

import { readBadgeDigits } from "./badge_digit_ocr.js";

/**
 * Lado del ✓ como fracción de la ALTURA del frame. Medido: 30 px de lado en una captura de
 * 1439 px de alto. Se expresa en fracción porque el juego escala toda la UI con la altura.
 */
const CHECK_SIDE_FRAC = 0.0208;

/** Tolerancia del lado del ✓. Amplia a propósito: el reescalado del stream lo deforma. */
const CHECK_SIDE_TOL = 0.30;

/**
 * El ✓ es un ANILLO, no un disco: entre el 28 % y el 52 % del cuadro que lo contiene está
 * pintado. Es lo que lo separa de las letras (macizas) del mismo color y tamaño parecido.
 */
const CHECK_FILL_MIN = 0.28;
const CHECK_FILL_MAX = 0.52;

/**
 * Zona gruesa donde vive el panel de recompensas. No es una fracción "afinada" sino la
 * geometría fija del juego: sindicatos a la izquierda, recompensas a la derecha, título
 * arriba. Acotar antes de buscar quita de un plumazo los candidatos del panel izquierdo,
 * del título y de la barra IMPORTANCE/SEARCH.
 */
const ZONE = { x0: 0.42, y0: 0.12 };

/** Distancia máxima en cromaticidad al color del tema para dar un píxel por "texto". */
const ACCENT_DIST = 0.28;

/** Por debajo de esta luma un píxel es fondo, aunque su tono case con el del tema. */
const ACCENT_MIN_LUMA = 60;

/**
 * Color del tema, medido en el TÍTULO de la pantalla.
 *
 * El título es del color del tema por definición y está en una posición conocida, así que
 * sirve de patrón para todo lo demás. Leerlo de la imagen (en vez de fijar un naranja) es lo
 * que hace que esto funcione con cualquier tema de la UI.
 *
 * @returns {[number,number,number]|null} RGB medio, o null si la franja no tiene texto.
 */
export function estimateAccentColor(img) {
    const { data, width, height } = img;
    const x0 = Math.floor(width * 0.30), x1 = Math.floor(width * 0.70);
    const y0 = Math.floor(height * 0.02), y1 = Math.floor(height * 0.10);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            // Brillante y saturado: el texto del título. El fondo del menú no cumple ambas.
            if (mx > 110 && mx - mn > 40) { r += R; g += G; b += B; n++; }
        }
    }
    return n < 50 ? null : [r / n, g / n, b / n];
}

/**
 * Máscara de píxeles del color del tema dentro de un rectángulo.
 *
 * Compara CROMATICIDAD (color normalizado por su propia luma), no distancia RGB: así el
 * mismo trazo cuenta esté en la parte iluminada del texto o en el borde antialiasado, que
 * es más oscuro pero del mismo tono.
 *
 * El rect se RECORTA al frame antes de empezar: sin eso, un rect que se sale por la derecha
 * envuelve a la fila siguiente y devuelve tinta de píxeles que no son los que se pidieron,
 * en silencio. Pasa con la última columna de casillas cuando la retícula queda pegada al
 * borde. Se recorta una vez y fuera del bucle, así que no cuesta nada por píxel; quien
 * necesite el tamaño real lo tiene en el `w`/`h` devueltos.
 *
 * @returns {{mask: Uint8Array, w: number, h: number, ox: number, oy: number}}
 */
export function accentMask(img, accent, rect) {
    const { data, width, height } = img;
    const ox = Math.max(0, rect.x), oy = Math.max(0, rect.y);
    const w = Math.max(0, Math.min(rect.x + rect.w, width) - ox);
    const h = Math.max(0, Math.min(rect.y + rect.h, height) - oy);
    const accLum = (accent[0] + accent[1] + accent[2]) / 3 || 1;
    const ar = accent[0] / accLum, ag = accent[1] / accLum, ab = accent[2] / accLum;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + oy) * width + (x + ox)) * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const lum = (R + G + B) / 3;
            if (lum <= ACCENT_MIN_LUMA) continue;
            const dr = R / lum - ar, dg = G / lum - ag, db = B / lum - ab;
            if (Math.sqrt(dr * dr + dg * dg + db * db) < ACCENT_DIST) mask[y * w + x] = 1;
        }
    }
    return { mask, w, h, ox, oy };
}

/**
 * Componentes conexos (4-vecindad) de una máscara, con su caja y su área.
 * Pila explícita: una recursión se desborda con manchas grandes de fondo tintado.
 */
export function connectedComponents({ mask, w, h }) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        let sp = 0;
        stack[sp++] = start;
        seen[start] = 1;
        let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
        while (sp > 0) {
            const p = stack[--sp];
            const px = p % w, py = (p - px) / w;
            area++;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
            if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
            if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
            if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
            if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
        }
        out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
    return out;
}

/** Agrupa coordenadas en carriles separados más de `sep`, con su nº de miembros. */
export function lanes(values, sep) {
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const out = [];
    let cur = [sorted[0]];
    for (const v of sorted.slice(1)) {
        if (v - cur[cur.length - 1] <= sep) cur.push(v);
        else { out.push(cur); cur = [v]; }
    }
    out.push(cur);
    return out.map((g) => ({ pos: Math.round(median(g)), members: g.length }));
}

function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Retícula que mejor explica los carriles: se prueba como paso cada distancia entre dos
 * carriles y se puntúa por ✓ explicados MENOS las posiciones que deja vacías dentro del tramo.
 *
 * El castigo por hueco es lo que evita que gane el paso MITAD, que explica exactamente los
 * mismos carriles y de propina cualquier fantasma que caiga entre medias.
 *
 * Antes esto derivaba el paso de la mediana de los huecos consecutivos y se rompía en cuanto
 * había dos fantasmas: a 720 px los carriles [151, 181, 198, 301, 421] daban mediana 66 y la
 * detección se quedaba en una sola fila. Con la puntuación sale 120, que es el paso real.
 *
 * @returns {{pitch: number|null, positions: number[]}}
 */
export function bestLattice(laneList, minPitch, span) {
    if (laneList.length < 2) return { pitch: null, positions: laneList.map((l) => l.pos) };
    const pos = laneList.map((l) => l.pos);
    const cands = new Set();
    for (const a of pos) for (const b of pos) {
        const d = Math.abs(b - a);
        if (d >= minPitch * 2 && d <= span) cands.add(d);
    }
    const tol = Math.max(2, minPitch * 0.4);
    let best = { score: -Infinity, pitch: null, positions: [] };
    for (const pitch of [...cands].sort((a, b) => a - b)) {
        for (const origin of pos) {
            const on = laneList.filter((l) => {
                const k = (l.pos - origin) / pitch;
                return Math.abs(l.pos - origin - Math.round(k) * pitch) <= tol;
            });
            if (on.length < 2) continue;
            const lo = Math.min(...on.map((l) => l.pos));
            const hi = Math.max(...on.map((l) => l.pos));
            const slots = Math.round((hi - lo) / pitch) + 1;
            const hits = on.reduce((s, l) => s + l.members, 0);
            const score = hits - 1.5 * (slots - on.length);
            if (score > best.score || (score === best.score && pitch > best.pitch)) {
                best = { score, pitch, positions: on.map((l) => l.pos) };
            }
        }
    }
    return best.pitch ? { pitch: best.pitch, positions: best.positions } : { pitch: null, positions: pos };
}

/**
 * Acota la pantalla de recompensas y devuelve las casillas OCUPADAS.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img  frame completo
 * @param {{trace?: object, accent?: number[]}} [opts]
 * @returns {{zone, pitch, cells, occluded, accent}|null}
 *   `cells` son {x, y, w, h, col, row, named, qty} en píxeles del frame, listas para
 *   recortar. `occluded` avisa de que algo tapa el panel (ver `hasGap`).
 */
export function detectRewardCells(img, opts = {}) {
    const trace = opts.trace || {};
    const { width, height } = img;

    const accent = opts.accent || estimateAccentColor(img);
    if (!accent) { trace.fail = "sin color de tema en el título"; return null; }
    trace.accent = accent.map(Math.round);

    // 1) ZONA: el panel de recompensas, acotado por la geometría fija de la pantalla.
    const zx = Math.floor(width * ZONE.x0), zy = Math.floor(height * ZONE.y0);
    const zone = { x: zx, y: zy, w: width - zx, h: height - zy };

    // 2) Los ✓ dentro de esa zona.
    const S = height * CHECK_SIDE_FRAC;
    const comps = connectedComponents(accentMask(img, accent, zone));
    const checks = comps.filter((c) => {
        if (Math.abs(c.w - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.h - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, S * 0.12)) return false;
        const fill = c.area / (c.w * c.h);
        return fill > CHECK_FILL_MIN && fill < CHECK_FILL_MAX;
    });
    trace.candidates = checks.length;
    if (checks.length < 4) { trace.fail = `solo ${checks.length} ✓ (<4)`; return null; }

    // 3) CASILLAS: la retícula que explica esos ✓. Lo que no cae en ella se cae — así se
    //    descartan el icono de la lupa, las letras de IMPORTANCE y el ✓ del tooltip de
    //    "N OWNED", que aparece flotando encima del panel cuando el ratón pasa por una celda.
    const sep = S * 0.5;
    const rowLanes = lanes(checks.map((c) => c.y), sep);
    const colLanes = lanes(checks.map((c) => c.x), sep);
    const { pitch: pitchY, positions: rows } = bestLattice(rowLanes, S, height);
    const { pitch: pitchX, positions: cols } = bestLattice(colLanes, S, width);
    if (!pitchX) { trace.fail = "sin retícula en X"; return null; }
    // Las celdas son cuadradas; un paso vertical muy distinto es señal de que la retícula de
    // filas se apoyó en fantasmas, así que manda el de columnas (más carriles, más robusto).
    const pitch = (!pitchY || Math.abs(pitchY - pitchX) > pitchX * 0.15) ? pitchX : Math.round((pitchX + pitchY) / 2);

    const onGrid = checks.filter((c) =>
        rows.some((r) => Math.abs(c.y - r) <= sep) && cols.some((x) => Math.abs(c.x - x) <= sep));

    // 4) Cada ✓ a su casilla. El ✓ va en la esquina superior izquierda, un poco metido.
    const inset = Math.round(S * 0.4);
    const sortedRows = [...rows].sort((a, b) => a - b);
    const sortedCols = [...cols].sort((a, b) => a - b);
    const cells = onGrid.map((c) => {
        const row = nearestIndex(sortedRows, c.y);
        const col = nearestIndex(sortedCols, c.x);
        return {
            x: zone.x + sortedCols[col] - inset,
            y: zone.y + sortedRows[row] - inset,
            w: pitch, h: pitch, col, row,
        };
    });
    // Dos ✓ del mismo carril pueden ser el mismo (anillo partido por el antialiasing).
    const unique = [...new Map(cells.map((c) => [`${c.row}:${c.col}`, c])).values()]
        .sort((a, b) => a.row - b.row || a.col - b.col);

    // Cada casilla sale ya descrita: si lleva rótulo y qué cantidad marca su badge. Se hace
    // aquí y no en quien la consuma porque es trabajo de píxel sobre la MISMA imagen y el
    // MISMO color de tema que ya se tienen a mano, y así el consumidor no vuelve a tocarlos.
    for (const cell of unique) {
        cell.named = classifyRewardCell(img, accent, cell).kind === "NAMED";
        cell.qty = cell.named ? readRewardQty(img, accent, cell) : 1;
    }

    trace.cols = sortedCols.length;
    trace.rows = sortedRows.length;
    trace.pitch = pitch;
    trace.cells = unique.length;

    const occluded = hasGap(unique, sortedCols.length);
    trace.occluded = occluded;

    return { zone, pitch, cells: unique, occluded, accent };
}

function nearestIndex(sorted, value) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < sorted.length; i++) {
        const d = Math.abs(sorted[i] - value);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/**
 * ¿Falta alguna casilla ANTES de la última ocupada?
 *
 * El juego rellena el panel en orden (izquierda a derecha, arriba a abajo) y deja los huecos
 * al final, así que un hueco en medio no puede ser una casilla vacía: algo la tapa. Pasó en
 * una captura real —el tooltip de NEURODES cubría dos celdas— y sin esta comprobación esas
 * recompensas se pierden en silencio, que es justo lo que no puede hacer un alta automática.
 */
export function hasGap(cells, cols) {
    if (!cells.length || !cols) return false;
    const idx = cells.map((c) => c.row * cols + c.col).sort((a, b) => a - b);
    const last = idx[idx.length - 1];
    return idx.length < last + 1;
}

/**
 * Franja inferior de la casilla donde el juego imprime el ROTULO (el nombre bajo el icono).
 * Empieza en 0.66 y no más abajo porque los nombres de tres líneas ("Revenant Prime
 * Neuroptics Blueprint") arrancan ahí.
 */
const NAME_BAND_TOP = 0.66;

/**
 * Tinta del color del tema en esa franja a partir de la cual la casilla lleva rótulo.
 * Medido sobre las dos capturas reales, a 1440/1200/1080/900/768/720: las casillas con
 * nombre van de 0.0226 a 0.1091 y las que no llevan dan 0.0000 clavado, así que el umbral
 * cae en un hueco enorme y no hay nada que afinar.
 */
const NAME_INK_MIN = 0.012;

/**
 * ¿La casilla lleva su nombre impreso DEBAJO del icono?
 *
 * Las cartas de MOD no: llevan el nombre DENTRO de la carta y en blanco, que la máscara del
 * tema no ve. Distinguirlas antes de pasar por Tesseract ahorra un OCR por celda y, sobre
 * todo, impide que el arte de la carta fabrique un parecido contra el catálogo.
 *
 * Se devuelve "lleva rótulo" y no "es un mod" porque la señal no distingue un mod de una
 * casilla cuyo rótulo esté teñido: al pasar el ratón por encima el juego lo pinta de rojo y
 * deja de casar con el tema. Esa celda solo aparece así en frames con tooltip, y esos se
 * descartan enteros por `occluded` antes de llegar aquí.
 *
 * @returns {{kind: "NAMED"|"UNNAMED", ink: number}}
 */
export function classifyRewardCell(img, accent, cell) {
    const top = Math.round(cell.h * NAME_BAND_TOP);
    const { mask } = accentMask(img, accent, {
        x: cell.x, y: cell.y + top, w: cell.w, h: cell.h - top,
    });
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    // Máscara vacía = la casilla cae entera fuera del frame. Sin el guarda saldría NaN, que
    // compara false contra el umbral y acaba en UNNAMED igual, pero por accidente.
    const ink = mask.length ? n / mask.length : 0;
    return { kind: ink >= NAME_INK_MIN ? "NAMED" : "UNNAMED", ink };
}

/**
 * Recorte del badge de cantidad: esquina superior izquierda de la casilla.
 *
 * El alto es el parámetro delicado y tiene una ventana estrecha por los dos lados: por
 * debajo de 0.16·celda el recorte CORTA los dígitos, y por encima de 0.21 el dígito baja del
 * 40 % del alto del recorte que exige `segmentDigits` y se descarta entero. 0.175 deja el
 * dígito al 50 % justo, con margen parecido a cada lado.
 */
const BADGE_W = 0.75;
const BADGE_H = 0.175;

/**
 * Dígitos del badge de cantidad de una casilla, o "" si no hay número (una recompensa de
 * una sola unidad enseña solo el ✓).
 *
 * El ✓ y la coma de millares se caen solos: el anillo no se parece a ningún dígito y la coma
 * no llega al 40 % del alto. Medido sobre las dos capturas: 20/20 a 1440p. Reescalado por
 * debajo baja a ~85 % sobre NÚMEROS GRANDES (las plantillas se cosecharon a 1440p), pero el
 * caso "sin número" no falló ni una vez a ninguna resolución, que es el que decide si una
 * pieza entra como 1.
 */
export function readRewardBadge(img, accent, cell) {
    const { mask, w, h } = accentMask(img, accent, {
        x: cell.x, y: cell.y, w: Math.round(cell.w * BADGE_W), h: Math.round(cell.h * BADGE_H),
    });
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i] ? 0 : 255; // dígitos NEGROS sobre blanco: lo que espera readBadgeDigits
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
    }
    return readBadgeDigits({ data, width: w, height: h });
}

/**
 * Cuántas unidades marca el badge de una casilla, ya como número.
 *
 * Una fisura endless da la MISMA pieza varias veces (una por ronda), así que la cantidad no
 * siempre es 1 y hasta ahora se daba por supuesta. Se acota a 20 porque por encima de eso ya
 * no es una pieza sino una lectura mala del badge, y ante la duda vale más contar 1 que
 * inflar el inventario.
 */
export function readRewardQty(img, accent, cell) {
    const n = Number.parseInt(readRewardBadge(img, accent, cell), 10);
    return Number.isFinite(n) && n >= 2 && n <= 20 ? n : 1;
}
