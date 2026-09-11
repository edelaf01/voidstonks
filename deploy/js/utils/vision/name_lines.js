/**
 * Cuántas LÍNEAS de texto hay en el rótulo de una recompensa, y cuánta de esa tinta explica
 * lo que ha leído el OCR.
 *
 * Existe por un fallo que el texto solo no puede resolver: el juego dibuja "Xaku Prime
 * Neuroptics Blueprint" partido en dos o tres líneas, y si el OCR pierde la del medio queda
 * "Xaku Prime Blueprint", que ES OTRO ÍTEM REAL del catálogo. Medido sobre el catálogo: de
 * 224 nombres que ocupan varias líneas, 168 (el 75%) se convierten en otro ítem al perder
 * una. Con el texto no hay forma de distinguirlo; con la tinta sí, porque la línea perdida
 * deja su rastro en la imagen aunque el OCR no la lea.
 *
 * Puro sobre { data, width, height }: sin DOM, para poder medirlo con capturas y sintéticos.
 */

/** Distancia al color de fondo a partir de la cual un píxel cuenta como tinta. */
const TOL_FONDO = 60;

/** Filas seguidas por debajo de este mínimo de tinta que cortan una línea de la siguiente. */
const HUECO_MIN = 2;

function colorFondo({ data, width, height }) {
    // La moda de los bordes: el rótulo va centrado, así que los laterales son fondo casi seguro.
    const cuenta = new Map();
    const mira = (x, y) => {
        const i = (y * width + x) * 4;
        const k = (data[i] >> 3 << 10) | (data[i + 1] >> 3 << 5) | (data[i + 2] >> 3);
        cuenta.set(k, (cuenta.get(k) || 0) + 1);
    };
    for (let y = 0; y < height; y++) { mira(0, y); mira(width - 1, y); }
    for (let x = 0; x < width; x++) { mira(x, 0); mira(x, height - 1); }
    let mejor = 0, top = -1;
    for (const [k, c] of cuenta) if (c > top) { top = c; mejor = k; }
    return [((mejor >> 10) & 31) << 3, ((mejor >> 5) & 31) << 3, (mejor & 31) << 3];
}

/**
 * Bandas horizontales con tinta.
 * @returns {{y0:number,y1:number,x0:number,x1:number,tinta:number}[]} de arriba a abajo.
 */
export function textLines(img, { minTinta = 2, tinta = null } = {}) {
    const { data, width, height } = img;
    const [bR, bG, bB] = colorFondo(img);
    // Con el color del texto delante se clasifica por CROMATICIDAD, igual que accentMask: el
    // arte de fondo es tenue pero no negro, y "distinto del fondo" lo daba por tinta y fundía
    // las líneas en una sola. El tono del rótulo no lo tiene nada más en la caja.
    let ar = 0, ag = 0, ab = 0;
    if (tinta) {
        const lum = (tinta[0] + tinta[1] + tinta[2]) / 3 || 1;
        ar = tinta[0] / lum; ag = tinta[1] / lum; ab = tinta[2] / lum;
    }
    // Un tema BLANCO no tiene cromaticidad que comparar (los tres canales iguales) y los
    // PÁLIDOS —Vitruvian (245,227,173), Lotus, Grineer, Baruuk— la tienen tan cerca del gris
    // que el arte de fondo entra igual. En los dos casos manda el brillo: el rótulo se dibuja
    // a tope y el arte, atenuado por el panel, se queda muy por debajo.
    const lumTinta = tinta ? (tinta[0] + tinta[1] + tinta[2]) / 3 : 0;
    const acromatico = tinta && (Math.max(...tinta) - Math.min(...tinta) < 30 || lumTinta > 180);
    const lumFondo = (bR + bG + bB) / 3;
    const esTinta = !tinta
        ? (i) => Math.abs(data[i] - bR) + Math.abs(data[i + 1] - bG) + Math.abs(data[i + 2] - bB) >= TOL_FONDO
        : acromatico
            ? (i) => (data[i] + data[i + 1] + data[i + 2]) / 3 > Math.max(150, lumFondo + 80)
            : (i) => {
                const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (lum <= 60) return false;
                const dr = data[i] / lum - ar, dg = data[i + 1] / lum - ag, db = data[i + 2] / lum - ab;
                return Math.sqrt(dr * dr + dg * dg + db * db) < 0.28;
            };
    const porFila = new Int32Array(height);
    const x0Fila = new Int32Array(height).fill(width);
    const x1Fila = new Int32Array(height).fill(-1);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (!esTinta(i)) continue;
            porFila[y]++;
            if (x < x0Fila[y]) x0Fila[y] = x;
            if (x > x1Fila[y]) x1Fila[y] = x;
        }
    }
    const lineas = [];
    let dentro = null, vacias = 0;
    for (let y = 0; y < height; y++) {
        if (porFila[y] >= minTinta) {
            vacias = 0;
            if (!dentro) dentro = { y0: y, y1: y, x0: x0Fila[y], x1: x1Fila[y], tinta: 0 };
            dentro.y1 = y;
            dentro.x0 = Math.min(dentro.x0, x0Fila[y]);
            dentro.x1 = Math.max(dentro.x1, x1Fila[y]);
            dentro.tinta += porFila[y];
        } else if (dentro && ++vacias >= HUECO_MIN) {
            lineas.push(dentro); dentro = null;
        }
    }
    if (dentro) lineas.push(dentro);
    return lineas;
}

/**
 * Qué parte del ancho de cada línea de tinta cubren las cajas de palabra del OCR.
 *
 * Un rótulo leído a medias ("XAKU PRIME" donde pone "XAKU PRIME NEUROPTICS") deja una línea
 * con mucha tinta sin cubrir, y eso es lo que permite desconfiar de un match que, por texto,
 * parecería perfecto.
 *
 * @param {{x0:number,x1:number}[]} lineas  las de textLines()
 * @param {{x0:number,x1:number,y0:number,y1:number}[]} palabras  cajas OCR, mismas coordenadas
 * @returns {number} 0..1, la cobertura de la línea PEOR cubierta
 */
export function inkCoverage(lineas, palabras) {
    if (!lineas.length) return 1;
    let peor = 1;
    for (const l of lineas) {
        const anchoLinea = l.x1 - l.x0 + 1;
        if (anchoLinea <= 0) continue;
        const dentro = palabras.filter((p) => p.y0 <= l.y1 && p.y1 >= l.y0);
        if (!dentro.length) return 0;
        const cubierto = Math.min(l.x1, Math.max(...dentro.map((p) => p.x1)))
            - Math.max(l.x0, Math.min(...dentro.map((p) => p.x0))) + 1;
        peor = Math.min(peor, Math.max(0, cubierto) / anchoLinea);
    }
    return peor;
}

/**
 * ¿Lo leído explica el rótulo entero?
 *
 * Junta las dos medidas de arriba para el uso real: el lector de recompensas tiene el canvas
 * binarizado que vio el OCR y sus cajas de palabra, y necesita una respuesta de sí/no.
 *
 * @param {{width:number,height:number,getContext:Function}} canvas  el mismo que fue al OCR
 * @param {{x0:number,x1:number,y0:number,y1:number}[]} palabras  cajas del OCR
 * @param {number} minimo  cobertura mínima (0..1) para darlo por completo
 * @param {number} desdeY  fracción de altura a partir de la cual vive el rótulo
 */
export function labelFullyRead(canvas, palabras, { minimo = 0.7, desdeY = 0.45 } = {}) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const lineas = textLines(ctx.getImageData(0, 0, canvas.width, canvas.height))
        .filter((l) => l.y0 >= canvas.height * desdeY);
    const cobertura = inkCoverage(lineas, palabras);
    return { completo: cobertura >= minimo, cobertura, lineas: lineas.length };
}
