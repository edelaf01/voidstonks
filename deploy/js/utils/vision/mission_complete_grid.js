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

import { WF_THEMES_VOTABLES } from "./wf_themes.js";
import { readBadgeDigits } from "./badge_digit_ocr.js";

/** Tolerancia del lado del ✓. Amplia a propósito: el reescalado del stream lo deforma. */
/**
 * Lado del ✓ como fracción de la ALTURA del frame. Medido: 30 px de lado en una captura de
 * 1439 px de alto. Se expresa en fracción porque el juego escala toda la UI con la altura.
 */
const CHECK_SIDE_FRAC = 0.0208;
const CHECK_SIDE_TOL = 0.30;
const CHECK_FILL_MIN = 0.28;
const CHECK_FILL_MAX = 0.52;
const GRUPOS_MAX = 4;   // grupos de ✓ que se prueban antes de rendirse

/**
 * El ✓ es un ANILLO, no un disco: entre el 28 % y el 52 % del cuadro que lo contiene está
 * pintado. Es lo que lo separa de las letras (macizas) del mismo color y tamaño parecido.
 */

/**
 * Zona gruesa donde vive el panel de recompensas. No es una fracción "afinada" sino la
 * geometría fija del juego: sindicatos a la izquierda, recompensas a la derecha, título
 * arriba. Acotar antes de buscar quita de un plumazo los candidatos del panel izquierdo,
 * del título y de la barra IMPORTANCE/SEARCH.
 */
const ZONE = { x0: 0.42, y0: 0.12 };

/**
 * Distancia en cromaticidad al color del tema para dar un píxel por "texto". Es una lista
 * porque se prueban en orden hasta que una produzca retícula, pero hoy basta una: las capturas
 * reales salen igual con cualquier valor entre 0.28 y 0.40 y las sintéticas solo con 0.36.
 *
 * Medido y descartado: Otsu sobre el histograma de distancias corta entre 0.35 y 0.86 según la
 * imagen —el fondo pesa demasiado—, y probar de estricto a laxo devuelve antes una retícula
 * plausible pero peor que la buena.
 */
const ACCENT_DIST = [0.36];

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
export function estimateAccentColor(img, { todos = false, maxCandidatos = 4 } = {}) {
    const { data, width, height } = img;
    const x0 = Math.floor(width * 0.30), x1 = Math.floor(width * 0.70);
    const y0 = Math.floor(height * 0.02), y1 = Math.floor(height * 0.10);
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 8) return null;

    // CONTRASTE LOCAL y no umbrales de color absolutos.
    //
    // Lo que se buscaba antes era "brillante y saturado", "casi blanco" u "oscuro y muy
    // saturado" (esta última, para el tema Tenno). El problema es que un arte de misión que
    // tiñe la pantalla de rojo oscuro cumple la tercera —(99,39,30): máximo 99, saturación
    // 69— y como el fondo es MAYORÍA dentro de la franja, la mediana se iba al tinte: el
    // acento salía (99,39,30) en vez del blanco del título, la máscara marcaba media pantalla
    // (6114 componentes) y no sobrevivía ni un ✓.
    //
    // El texto, sea del color que sea, siempre destaca sobre lo que tiene PEGADO; el tinte del
    // fondo varía suave. Comparar cada píxel con la media de su vecindad separa las letras sin
    // saber de qué color son, que es lo que hace que valga para los 13 temas a la vez.
    const luma = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + y0) * width + (x + x0)) * 4;
            luma[y * w + x] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
    }
    // Suma acumulada: la media de cualquier ventana sale en 4 lecturas, así que el radio no
    // encarece nada (la franja son ~120k píxeles en una captura de 1440p).
    const suma = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            suma[(y + 1) * (w + 1) + x + 1] = luma[y * w + x]
                + suma[y * (w + 1) + x + 1] + suma[(y + 1) * (w + 1) + x] - suma[y * (w + 1) + x];
        }
    }
    const RADIO = 7;          // ventana de 15x15: más ancha que un trazo, más estrecha que una letra
    // Cuánto tiene que DESTACAR un píxel de su vecindad, en valor absoluto: puede ser más claro
    // (lo normal) o más OSCURO, que es lo que pasa cuando el arte de la misión es más luminoso
    // que el texto. Con la comparación solo "hacia arriba", 54 de las 225 combinaciones de
    // tema × tinte de fondo se quedaban sin acento — todas las de un texto oscuro sobre un
    // fondo claro, y el tema Tenno contra casi cualquier cosa.
    //
    // El margen es RELATIVO al contraste de la franja, no fijo: un título blanco sobre rojo
    // saca 200 puntos, pero el Tenno (luma 72) sobre su propio tinte saca 17.
    const orden = Float32Array.from(luma).sort();
    const pct = (q) => orden[Math.min(orden.length - 1, Math.floor(orden.length * q))];
    const MARGEN = Math.min(40, Math.max(12, (pct(0.99) - pct(0.5)) * 0.12));
    const rs = [], gs = [], bs = [], cs = [], xs = [];
    for (let y = 0; y < h; y++) {
        const ya = Math.max(0, y - RADIO), yb = Math.min(h, y + RADIO + 1);
        for (let x = 0; x < w; x++) {
            const xa = Math.max(0, x - RADIO), xb = Math.min(w, x + RADIO + 1);
            const total = suma[yb * (w + 1) + xb] - suma[ya * (w + 1) + xb]
                - suma[yb * (w + 1) + xa] + suma[ya * (w + 1) + xa];
            const media = total / ((yb - ya) * (xb - xa));
            const contraste = Math.abs(luma[y * w + x] - media);
            if (contraste <= MARGEN) continue;
            const i = ((y + y0) * width + (x + x0)) * 4;
            rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); cs.push(contraste); xs.push(x);
        }
    }
    if (rs.length < 50) return null;

    // De todo lo que destaca sobre su vecindad, el título es lo único que repite un color
    // EXACTO: el arte de fondo también tiene bordes con contraste, pero cada mancha es de un
    // color distinto. Así que se agrupa por color (5 bits por canal) y se gana el grupo más
    // numeroso; dentro de él, la mediana. Sin esto, un fondo muy movido arrastraba la medida
    // en los temas oscuros —Tenno tiene luma 72 y cualquier mancha clara pesa más—.
    const CUBO = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    // Por grupo: cuántos píxeles tiene y CUÁNTO SE EXTIENDE a lo ancho de la franja. El título
    // ocupa media franja de lado a lado; una mancha del arte, por muchos píxeles que tenga, cabe
    // en su propio diámetro. Sin esto ganaba la mancha por número —medido: 306 píxeles de una
    // mancha contra 90 del título— en 21 de las 225 combinaciones de tema y tinte de fondo.
    const cuentas = new Map();
    for (let i = 0; i < rs.length; i++) {
        const k = CUBO(rs[i], gs[i], bs[i]);
        const g = cuentas.get(k) || { n: 0, xMin: Infinity, xMax: -Infinity };
        g.n++;
        if (xs[i] < g.xMin) g.xMin = xs[i];
        if (xs[i] > g.xMax) g.xMax = xs[i];
        cuentas.set(k, g);
    }
    // Al mirar el contraste en los dos sentidos, el lado OSCURO de cada borde también entra, y
    // ese lado es el color plano del fondo repetido miles de veces: un grupo enorme que gana al
    // título por goleada. Así que primero se identifica el fondo —el color más repetido de toda
    // la franja, con letras o sin ellas— y los grupos que se le parecen quedan fuera. Lo que
    // queda es "el color que más se repite y NO es el fondo", que es el título por definición.
    const fondo = new Map();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + y0) * width + (x + x0)) * 4;
            const k = CUBO(data[i], data[i + 1], data[i + 2]);
            fondo.set(k, (fondo.get(k) || 0) + 1);
        }
    }
    let kFondo = 0, nFondo = -1;
    for (const [k, c] of fondo) if (c > nFondo) { nFondo = c; kFondo = k; }
    const canal = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
    const [fR, fG, fB] = canal(kFondo);
    const esFondo = (k) => {
        const [r, g, b] = canal(k);
        return Math.abs(r - fR) + Math.abs(g - fG) + Math.abs(b - fB) < 60;
    };
    // Varios candidatos en vez de uno: un arte degradado no tiene UN color de fondo sino una
    // familia, y sus tonos intermedios se cuelan por delante del título. Decide la geometría.
    const ANCHO_MIN = w * 0.2;
    const anchos = [...cuentas].filter(([k, g]) => !esFondo(k) && g.xMax - g.xMin >= ANCHO_MIN);
    const sueltos = [...cuentas].filter(([k]) => !esFondo(k));
    const finalistas = (anchos.length ? anchos : sueltos).sort((a, b) => b[1].n - a[1].n).slice(0, maxCandidatos);
    if (!finalistas.length) return null;

    const mediana = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };
    const colores = finalistas.map(([k]) => {
        const dentro = { r: [], g: [], b: [] };
        for (let i = 0; i < rs.length; i++) {
            if (CUBO(rs[i], gs[i], bs[i]) !== k) continue;
            dentro.r.push(rs[i]); dentro.g.push(gs[i]); dentro.b.push(bs[i]);
        }
        // Mediana dentro del grupo: absorbe el borde antialiasado sin desplazar el tono.
        return [mediana(dentro.r), mediana(dentro.g), mediana(dentro.b)];
    });
    // Rescate por catálogo: con texto oscuro sobre fondo oscuro el grupo del título queda
    // diminuto y no llega a finalista (Tenno, luma 72, ni entre los seis primeros).
    if (todos) {
        for (const t of temasPresentes(rs, gs, bs)) {
            if (colores.some((c) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]) < 60)) continue;
            colores.push(t);
        }
    }
    return todos ? colores : colores[0];
}

/** Temas conocidos con presencia real entre los píxeles que destacan, de más a menos. */
function temasPresentes(rs, gs, bs) {
    const votos = new Map();
    for (let i = 0; i < rs.length; i++) {
        let mejor = -1, dMin = 60;
        for (let t = 0; t < WF_THEMES_VOTABLES.length; t++) {
            const { r, g, b } = WF_THEMES_VOTABLES[t];
            const d = Math.abs(rs[i] - r) + Math.abs(gs[i] - g) + Math.abs(bs[i] - b);
            if (d < dMin) { dMin = d; mejor = t; }
        }
        if (mejor >= 0) votos.set(mejor, (votos.get(mejor) || 0) + 1);
    }
    return [...votos].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([t]) => [WF_THEMES_VOTABLES[t].r, WF_THEMES_VOTABLES[t].g, WF_THEMES_VOTABLES[t].b]);
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
export function accentMask(img, accent, rect, dist = ACCENT_DIST[0]) {
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
            if (Math.sqrt(dr * dr + dg * dg + db * db) < dist) mask[y * w + x] = 1;
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
        const cw = maxX - minX + 1, ch = maxY - minY + 1;
        // Densidad del 40% central: un ✓ es un ANILLO y ahí no tiene casi nada. Es la única
        // señal de su forma que no depende del grosor del trazo, que cambia con la resolución.
        const cx0 = minX + Math.round(cw * 0.3), cx1 = maxX - Math.round(cw * 0.3);
        const cy0 = minY + Math.round(ch * 0.3), cy1 = maxY - Math.round(ch * 0.3);
        let dentro = 0, celdas = 0;
        for (let yy = cy0; yy <= cy1; yy++) {
            for (let xx = cx0; xx <= cx1; xx++) { celdas++; if (mask[yy * w + xx]) dentro++; }
        }
        out.push({ x: minX, y: minY, w: cw, h: ch, area, centro: celdas ? dentro / celdas : 1 });
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
    const candidatos = opts.accent ? [opts.accent] : (estimateAccentColor(img, { todos: true }) || []);
    if (!candidatos.length) { trace.fail = "sin color de tema en el título"; return null; }
    // El mejor, no el primero: un color equivocado cuela una casilla suelta por casualidad y
    // esa respuesta de una tapaba la buena de cuatro.
    let mejor = null, primerFallo = null;
    for (const color of candidatos) {
        const parcial = {};
        const res = _conAcento(img, color, parcial);
        if (res && (!mejor || res.cells.length > mejor.res.cells.length)) mejor = { res, parcial };
        primerFallo ||= parcial.fail;
    }
    if (!mejor) { trace.fail = primerFallo || "sin color de tema en el título"; return null; }
    Object.assign(trace, mejor.parcial);
    return mejor.res;
}

/** Bloque de filas seguidas (hueco <= 1.6 pasos) con más ✓; el resto son fantasmas. */
function compactRows(rows, pitch, checks, sep) {
    const orden = [...rows].sort((a, b) => a - b);
    if (orden.length < 2) return orden;
    const bloques = [[orden[0]]];
    for (let i = 1; i < orden.length; i++) {
        if (orden[i] - orden[i - 1] <= pitch * 1.6) bloques.at(-1).push(orden[i]);
        else bloques.push([orden[i]]);
    }
    const peso = (b) => checks.filter((c) => b.some((r) => Math.abs(c.y - r) <= sep)).length;
    return bloques.reduce((a, b) => (peso(b) > peso(a) ? b : a));
}

/** Un intento con un color concreto; null si con ese color no sale retícula. */
function _conAcento(img, accent, trace) {
    for (const dist of ACCENT_DIST) {
        const parcial = {};
        const res = _conTolerancia(img, accent, dist, parcial);
        if (res) { Object.assign(trace, parcial); return res; }
        trace.fail ||= parcial.fail;
    }
    return null;
}

function _conTolerancia(img, accent, dist, trace) {
    const { width, height } = img;
    trace.accent = accent.map(Math.round);
    trace.dist = dist;

    // 1) ZONA: el panel de recompensas, acotado por la geometría fija de la pantalla.
    const zx = Math.floor(width * ZONE.x0), zy = Math.floor(height * ZONE.y0);
    const zone = { x: zx, y: zy, w: width - zx, h: height - zy };

    // 2) Los ✓ dentro de esa zona. No se describen con umbrales —tamaño, relleno, cuadratura
    //    cambian con la resolución y el JPEG se los come: en una captura recomprimida el mismo
    //    ✓ pasaba de relleno 0.31 a 0.27 y caía por 0.01—. Se buscan grupos de componentes
    //    PARECIDOS ENTRE SÍ, que es lo que un ✓ es por definición: N copias del mismo glifo.
    const comps = connectedComponents(accentMask(img, accent, zone, dist));

    // Con una captura limpia el ✓ se reconoce por su forma y no hay nada que buscar. La
    // agrupación de abajo solo entra cuando eso no da nada, que es lo que pasa en cuanto la
    // imagen viene recomprimida: entonces el glifo se deforma pero SIGUE repitiéndose igual.
    const porForma = comps.filter((c) => {
        const S = height * CHECK_SIDE_FRAC;
        if (Math.abs(c.w - S) >= S * CHECK_SIDE_TOL || Math.abs(c.h - S) >= S * CHECK_SIDE_TOL) return false;
        if (Math.abs(c.w - c.h) > Math.max(2, S * 0.12)) return false;
        const fill = c.area / (c.w * c.h);
        return fill > CHECK_FILL_MIN && fill < CHECK_FILL_MAX;
    });
    if (porForma.length >= 4) {
        const parcial = {};
        const res = _conGrupo(img, accent, zone, porForma, parcial, height * CHECK_SIDE_FRAC, dist);
        if (res) { Object.assign(trace, parcial); return res; }
    }

    let mejor = null;
    for (const grupo of gruposSemejantes(comps, height)) {
        const parcial = {};
        const res = _conGrupo(img, accent, zone, grupo, parcial, median(grupo.map((c) => (c.w + c.h) / 2)), dist);
        if (res && (!mejor || res.cells.length > mejor.res.cells.length)) mejor = { res, parcial };
    }
    if (!mejor) { trace.fail ||= `solo ${porForma.length} ✓ (<4)`; return null; }
    Object.assign(trace, mejor.parcial);
    return mejor.res;
}

/**
 * Grupos de componentes del mismo tamaño, de más numeroso a menos. El tamaño sale de los datos,
 * no de una fracción del alto, para que dé igual a qué resolución esté la captura.
 */
function gruposSemejantes(comps, height) {
    const posibles = comps.filter((c) => c.w >= 5 && c.h >= 5
        && c.w <= height * 0.06 && c.h <= height * 0.06
        && c.w / c.h > 0.6 && c.w / c.h < 1.7);
    // Además del tamaño, la HUELLA del glifo: cuánto ocupa dentro de su caja y qué densidad
    // tiene su 40% central. Medido, los ✓ de una misma pantalla la repiten clavada (0.31 y 0.47
    // en las 10 casillas de una captura) mientras que las letras la varían mucho.
    const relleno = (c) => c.area / (c.w * c.h);
    const usados = new Set();
    const grupos = [];
    for (const semilla of posibles.sort((a, b) => b.area - a.area)) {
        if (usados.has(semilla)) continue;
        const g = posibles.filter((c) => !usados.has(c)
            && Math.abs(c.w - semilla.w) <= semilla.w * 0.25
            && Math.abs(c.h - semilla.h) <= semilla.h * 0.25
            && Math.abs(relleno(c) - relleno(semilla)) <= 0.08
            && Math.abs(c.centro - semilla.centro) <= 0.12);
        if (g.length < 4) continue;
        for (const c of g) usados.add(c);
        grupos.push(g);
    }
    return grupos.sort((a, b) => b.length - a.length).slice(0, GRUPOS_MAX);
}

/**
 * ¿Está el panel desplazado y hay una fila de recompensas cortada por arriba? La primera fila
 * de ✓ cae siempre en el mismo sitio —medido: 350 px sobre 1440 en cuatro capturas de dos
 * pantallas y dos resoluciones—, así que verla más abajo significa que arriba falta algo.
 *
 * No pilla un desplazamiento de una fila EXACTA: entonces la que se ve cae en el mismo carril
 * y por geometría es indistinguible de un panel entero.
 */
const PRIMERA_FILA_FRAC = 0.243;

function filaCortadaArriba(cells, pitch, height) {
    const yPrimera = Math.min(...cells.map((c) => c.y));
    return yPrimera > height * PRIMERA_FILA_FRAC + pitch * 0.25;
}

/** La retícula que explican un grupo de ✓ candidatos; null si no explican ninguna. */
function _conGrupo(img, accent, zone, checks, trace, S, dist) {
    const { width, height } = img;
    trace.candidates = checks.length;

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

    // Un ✓ suelto del HUD inferior abría una fila fantasma a media pantalla, y con ella una
    // quinta casilla inventada.
    const filas = compactRows(rows, pitch, checks, sep);
    const onGrid = checks.filter((c) =>
        filas.some((r) => Math.abs(c.y - r) <= sep) && cols.some((x) => Math.abs(c.x - x) <= sep));

    // 4) Cada ✓ a su casilla. El ✓ va en la esquina superior izquierda, un poco metido.
    const inset = Math.round(S * 0.4);
    // Una columna vacía puede estar tapada por el tooltip; una fila vacía no. Si se deja,
    // desplaza el índice de fila de las casillas que sí existen.
    const conCelda = filas.filter((r) => onGrid.some((c) => Math.abs(c.y - r) <= sep));
    const sortedRows = [...(conCelda.length ? conCelda : filas)].sort((a, b) => a - b);
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
        cell.named = classifyRewardCell(img, accent, cell, dist).kind === "NAMED";
        cell.qty = cell.named ? readRewardQty(img, accent, cell, dist) : 1;
    }

    trace.cols = sortedCols.length;
    trace.rows = sortedRows.length;
    trace.pitch = pitch;
    trace.cells = unique.length;

    const cortada = filaCortadaArriba(unique, pitch, height);
    const occluded = hasGap(unique, sortedCols.length) || cortada;
    trace.occluded = occluded;
    trace.cut = cortada;

    return { zone, pitch, cells: unique, occluded, accent, dist };
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
export function classifyRewardCell(img, accent, cell, dist) {
    const top = Math.round(cell.h * NAME_BAND_TOP);
    const { mask } = accentMask(img, accent, {
        x: cell.x, y: cell.y + top, w: cell.w, h: cell.h - top,
    }, dist);
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
export function readRewardBadge(img, accent, cell, dist) {
    const { mask, w, h } = accentMask(img, accent, {
        x: cell.x, y: cell.y, w: Math.round(cell.w * BADGE_W), h: Math.round(cell.h * BADGE_H),
    }, dist);
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
export function readRewardQty(img, accent, cell, dist) {
    const n = Number.parseInt(readRewardBadge(img, accent, cell, dist), 10);
    return Number.isFinite(n) && n >= 2 && n <= 20 ? n : 1;
}
