/**
 * Franjas de título que el OCR ya reconoció, para reconocerlas sin OCR la vez siguiente. Correlación
 * normalizada con desplazamiento; en el corpus, mismo título 0,70-1,00 y distintos 0,59 como mucho.
 */

export const COLS = 160, FILAS = 10;
export const UMBRAL = 0.8, MARGEN = 0.15;
// Cuatro avatares mueven el título unas 36 columnas.
const DESPLAZA = 40, SOLAPE_MIN = 60;
const MISMA = 0.95, POR_CONTEXTO = 6, TOTAL = 30;
// Una franja casi lisa (juego, pantalla de carga) correlaciona con cualquier cosa.
const TEXTURA_MIN = 12;

export function textura(m) {
    let s = 0, s2 = 0;
    for (const v of m) { s += v; s2 += v * v; }
    const media = s / m.length;
    return Math.sqrt(Math.max(0, s2 / m.length - media * media));
}

export function parecido(a, b) {
    let mejor = -1;
    for (let d = -DESPLAZA; d <= DESPLAZA; d++) {
        const c0 = Math.max(0, -d), c1 = Math.min(COLS, COLS - d);
        if (c1 - c0 < SOLAPE_MIN) continue;
        let sa = 0, sb = 0, n = 0;
        for (let f = 0; f < FILAS; f++) for (let c = c0; c < c1; c++) { sa += a[f * COLS + c]; sb += b[f * COLS + c + d]; n++; }
        const ma = sa / n, mb = sb / n;
        let num = 0, da = 0, db = 0;
        for (let f = 0; f < FILAS; f++) for (let c = c0; c < c1; c++) {
            const x = a[f * COLS + c] - ma, y = b[f * COLS + c + d] - mb;
            num += x * y; da += x * x; db += y * y;
        }
        if (da && db) mejor = Math.max(mejor, num / Math.sqrt(da * db));
    }
    return mejor;
}

/** Un rótulo de pantalla es "CATEGORÍA/SUBTÍTULO" o "TRADING POST"; el nombre de un jugador que contiene "MOD" no. */
export function esTitulo(texto) {
    return /[A-Z]{3,}\s*\/\s*[A-Z]{3,}|TRAD[I1L]NG\s*P[O0]ST/.test(String(texto || "").toUpperCase());
}

export function creaCatalogo(entradas = []) {
    return {
        entradas,

        /** { contexto, texto, score } si la muestra es un rótulo conocido sin duda, o null. */
        reconoce(muestra) {
            if (!muestra || !entradas.length || textura(muestra) < TEXTURA_MIN) return null;
            const puntos = entradas.map((e) => ({ e, s: parecido(muestra, e.m) }));
            const mejor = puntos.reduce((a, b) => (b.s > a.s ? b : a));
            const rival = Math.max(-1, ...puntos.filter((p) => p.e.contexto !== mejor.e.contexto).map((p) => p.s));
            if (mejor.s < UMBRAL || mejor.s - rival < MARGEN) return null;
            mejor.e.t = Date.now();
            return { contexto: mejor.e.contexto, texto: mejor.e.texto, score: mejor.s };
        },

        /** @returns true si el catálogo cambió (para guardarlo). */
        aprende(muestra, contexto, texto, ahora = Date.now()) {
            if (!muestra || textura(muestra) < TEXTURA_MIN) return false;
            // Lo que el OCR confirma manda: una firma de otro contexto que se parece a esta estaba mal aprendida.
            const choques = entradas.filter((e) => e.contexto !== contexto && parecido(muestra, e.m) >= UMBRAL);
            for (const e of choques) entradas.splice(entradas.indexOf(e), 1);
            const igual = entradas.find((e) => e.contexto === contexto && parecido(muestra, e.m) >= MISMA);
            if (igual) { igual.t = ahora; return false; }
            entradas.push({ contexto, texto, m: Uint8Array.from(muestra, (v) => Math.round(v)), t: ahora });
            const viejas = (lista, max) => lista.sort((a, b) => a.t - b.t).slice(0, Math.max(0, lista.length - max));
            for (const e of [...viejas(entradas.filter((x) => x.contexto === contexto), POR_CONTEXTO), ...viejas([...entradas], TOTAL)]) {
                const i = entradas.indexOf(e);
                if (i >= 0) entradas.splice(i, 1);
            }
            return true;
        },
    };
}

export function exporta(catalogo) {
    return catalogo.entradas.map(({ contexto, texto, m, t }) => ({ contexto, texto, t, m: btoa(String.fromCharCode(...m)) }));
}

export function importa(datos) {
    const entradas = (Array.isArray(datos) ? datos : [])
        .filter((e) => e?.contexto && typeof e.m === "string")
        .map((e) => ({ contexto: e.contexto, texto: e.texto || "", t: e.t || 0, m: Uint8Array.from(atob(e.m), (ch) => ch.charCodeAt(0)) }))
        .filter((e) => e.m.length === COLS * FILAS);
    return creaCatalogo(entradas);
}
