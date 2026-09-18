/**
 * Dónde empieza el rótulo dentro de una casilla de MISSION COMPLETE, a partir de la máscara.
 *
 * La máscara se hace por el color del tema y en los temas dorados el arte del icono (un
 * Larkspur, una reliquia) es de ese mismo color: Tesseract recibía el dibujo entero encima
 * del nombre y devolvía basura ("C HT VS EEK EE COLI BR ME BLUEPRINT" por "Larkspur Prime
 * Blueprint") con el nombre perfectamente limpio debajo. El rótulo son de una a tres líneas
 * de texto pegadas al borde inferior: se recorren las bandas de tinta de abajo arriba y se
 * aceptan mientras tengan alto de línea y hueco de interlínea; lo que hay por encima es arte.
 */

/** Alto de una banda para ser una línea de texto (una línea mide ~0,09 del alto). */
const LINEA_MIN = 0.04;
const LINEA_MAX = 0.13;
/** Hueco máximo entre dos líneas del mismo rótulo (~0,03 medido). */
const HUECO_MAX = 0.06;
/** Fracción de la fila más densa por debajo de la cual una fila cuenta como blanca. */
const BLANCO_REL = 0.3;
/**
 * Franja donde puede estar el rótulo: tres líneas arrancan en 0,59 y la última acaba en
 * 0,95. Por debajo queda el borde inferior de la casilla, que en los temas dorados es del
 * color del tema y, contado, pasaba por línea de texto o fijaba el pico de tinta.
 */
const TECHO = 0.45;
const SUELO = 0.955;
/**
 * Tinta mínima en la fila más densa para contar como línea (fracción del ancho). Con
 * LINEA_MIN descarta el borde inferior de la casilla: una hilera de 1-2 filas y 5-15 píxeles
 * que, tomada por línea, dejaba el rótulo entero fuera ("Larkspur Prime Blueprint" -> "AS").
 */
const TINTA_MIN = 0.04;

/**
 * @param {Uint8Array} mask 1 = píxel de texto, w*h
 * @returns {number} fila (px) donde empieza el rótulo, o 0 si no se distingue ninguno
 */
export function labelTop(mask, w, h) {
    const desde = Math.floor(h * TECHO), hasta = Math.floor(h * SUELO);
    const filas = new Uint32Array(h);
    let pico = 0;
    for (let y = desde; y < hasta; y++) {
        let tinta = 0;
        for (let x = 0; x < w; x++) tinta += mask[y * w + x];
        filas[y] = tinta;
        if (tinta > pico) pico = tinta;
    }
    // "Fila en blanco" es relativa a la más densa: el arte que llega hasta el rótulo deja
    // 25-35 píxeles por fila (el alambre del Larkspur) frente a los 60-110 de una línea de
    // texto, y con blanco = 0 los dos quedaban en una sola banda que no era línea de nada.
    const blanco = pico * BLANCO_REL;
    const bandas = [];
    let abierta = null;
    for (let y = desde; y < hasta; y++) {
        const tinta = filas[y];
        if (tinta > blanco) {
            if (abierta) { abierta[1] = y; abierta[2] = Math.max(abierta[2], tinta); } else abierta = [y, y, tinta];
        } else if (abierta) { bandas.push(abierta); abierta = null; }
    }
    if (abierta) bandas.push(abierta);

    let top = null, siguiente = null;
    for (let i = bandas.length - 1; i >= 0; i--) {
        const [y0, y1, max] = bandas[i];
        if (max < w * TINTA_MIN || y1 - y0 + 1 < h * LINEA_MIN) continue;
        if (y1 - y0 + 1 > h * LINEA_MAX) break;
        if (siguiente !== null && siguiente - y1 > h * HUECO_MAX) break;
        top = y0;
        siguiente = y0;
    }
    if (top === null) return 0;
    // Margen por encima: la banda empieza donde la tinta pasa del umbral, y los trazos altos de
    // la primera línea (la R de "Revenant") quedan unas filas más arriba.
    return Math.max(0, Math.round(top - h * 0.05));
}
