/**
 * Apila varios recortes de un frame en UN canvas para leerlos con UNA sola pasada de OCR.
 *
 * Medido sobre las 18 celdas del inventario (PP-OCRv6 tiny, misma captura, mismos nombres
 * leídos): 18 llamadas sueltas 889 ms, `batchRecognize` 721 ms, montaje vertical 209 ms.
 * El motivo es que cada llamada paga entera la red de DETECCIÓN, y da igual que el recorte
 * sea diminuto; apilándolos se paga una vez. La forma importa: en rejilla 6x3 son 287 ms y
 * sobre la zona del inventario sin recortar 466 ms —y ahí el arte de los ítems mete líneas
 * basura—, así que la tira vertical estrecha es la que gana.
 *
 * SOLO PARA PADDLE. Con Tesseract el montaje es más LENTO, no más rápido: su coste va con el
 * área de píxeles, y apilar añade los huecos y el relleno hasta el ancho común. Medido con una
 * sola invocación de tesseract para aislar el arranque del proceso: las 18 máscaras sueltas 550
 * y 556 ms, el montaje de las mismas 633 y 640. Midiéndolo con una invocación POR máscara sale
 * al revés (4006 contra 1112 ms) y es un espejismo: eso son 18 arranques de proceso, que en el
 * navegador no existen. Paddle gana porque lo que se ahorra ahí es su red de DETECCIÓN, que se
 * paga entera en cada llamada; Tesseract no tiene ese coste fijo.
 */

// Un canvas muy alto se sale de los límites del navegador y además obliga a la detección a
// reescalar tanto que las letras se pierden. Al pasarse se parte en varios montajes.
const ALTO_MAXIMO = 6000;

/**
 * @param tiras  [{ clave, sx, sy, sw, sh }] en coordenadas de `fuente`.
 * @returns [{ canvas, tramos: [{ clave, y, h }] }] — uno o varios montajes.
 */
/**
 * Escala a la que se dibuja cada tira en el montaje.
 *
 * Estaba en 2 y era trabajo tirado: la red de detección reescala su entrada por su cuenta, así
 * que ampliar antes solo multiplica los píxeles que hay que procesar. Medido sobre las 18 celdas
 * del inventario en cuatro resoluciones (nativa, 1080p, 720p, 540p), milisegundos y nombres
 * leídos: escala 2 -> 367/347/310/255 ms con 18/18 en todas; escala 1.5 -> 239/225/205/158 ms
 * y también 18/18 en todas; escala 1 -> más rápido pero se cae a 16/18 a 540p.
 *
 * Lo que NO hay que tocar es `maxSideLength` de la detección: capado a 960 baja a 15/18, 17/18
 * y 13/18 según la resolución. El ahorro tiene que venir de no ampliar, no de mirar menos.
 */
const ESCALA = 1.5;

export function montaTiras(fuente, tiras, { escala = ESCALA, hueco = 10, fondo = "#0a0e16" } = {}) {
    if (!tiras?.length) return [];
    const alto = (t) => Math.max(1, Math.round(t.sh * escala));
    const ancho = Math.max(1, ...tiras.map((t) => Math.round(t.sw * escala)));

    const grupos = [];
    let actual = [], acumulado = 0;
    for (const tira of tiras) {
        const h = alto(tira);
        if (actual.length && acumulado + hueco + h > ALTO_MAXIMO) {
            grupos.push(actual); actual = []; acumulado = 0;
        }
        actual.push(tira);
        acumulado += (actual.length > 1 ? hueco : 0) + h;
    }
    if (actual.length) grupos.push(actual);

    return grupos.map((grupo) => {
        const total = grupo.reduce((s, t, i) => s + alto(t) + (i ? hueco : 0), 0);
        const canvas = document.createElement("canvas");
        canvas.width = ancho;
        canvas.height = total;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        // El hueco va del color de fondo del juego, no blanco: un salto a blanco entre tiras
        // es un borde durísimo y la detección lo persigue como si fuera texto.
        ctx.fillStyle = fondo;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const tramos = [];
        let y = 0;
        for (const tira of grupo) {
            const h = alto(tira);
            ctx.drawImage(fuente, tira.sx, tira.sy, tira.sw, tira.sh, 0, y, Math.round(tira.sw * escala), h);
            tramos.push({ clave: tira.clave, y, h });
            y += h + hueco;
        }
        return { canvas, tramos };
    });
}

/**
 * Devuelve el reparto de las líneas leídas entre los tramos del montaje, por la Y del centro
 * de cada caja. Una línea cuyo centro cae en un hueco (la caja puede desbordar un poco su
 * tira) se asigna al tramo más cercano, no se tira: es justo el nombre de dos líneas cuya
 * segunda mitad roza el borde.
 *
 * @returns Map<clave, líneas ordenadas por Y>
 */
export function repartePorTramos(lineas, tramos) {
    const salida = new Map(tramos.map((t) => [t.clave, []]));
    for (const linea of lineas) {
        const cy = linea.box.y + linea.box.height / 2;
        let mejor = null, mejorDist = Infinity;
        for (const t of tramos) {
            const dist = cy < t.y ? t.y - cy : (cy > t.y + t.h ? cy - (t.y + t.h) : 0);
            if (dist < mejorDist) { mejorDist = dist; mejor = t; }
            if (dist === 0) break;
        }
        if (mejor) salida.get(mejor.clave).push(linea);
    }
    for (const lista of salida.values()) lista.sort((a, b) => a.box.y - b.box.y);
    return salida;
}
