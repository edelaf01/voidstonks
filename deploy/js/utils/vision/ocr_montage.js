/**
 * Stacks several crops of a frame into ONE canvas to read them with ONE OCR pass. Each call pays the whole
 * DETECTION network no matter how tiny the crop, so stacking pays it once. Shape matters: a narrow vertical
 * strip beats a grid and the uncropped zone, where item art also adds garbage lines.
 *
 * ONLY FOR PADDLE. With Tesseract the montage is SLOWER: its cost goes with pixel area, and stacking adds the
 * gaps and the padding up to the common width. Tesseract has no fixed detection cost to save.
 */

// a very tall canvas goes past the browser limits and makes detection rescale so much the letters get lost.
// Past it, it splits into several montages
const ALTO_MAXIMO = 6000;

/**
 * @param tiras  [{ clave, sx, sy, sw, sh }] in `fuente` coordinates.
 * @returns [{ canvas, tramos: [{ clave, y, h }] }], one or several montages.
 */
/**
 * Scale each strip is drawn at in the montage. The detection network rescales its input by itself, so
 * upscaling first only multiplies the pixels to process; at 1 small resolutions start losing names. What must
 * NOT be touched is the detection `maxSideLength`: capping it loses names at every resolution. The saving has
 * to come from not upscaling, not from looking at less.
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
        // the gap goes in the game background color, not white: a jump to white between strips is a very hard edge
        // and detection chases it as if it were text
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
 * Splits the lines read among the montage sections by the Y of each box center. A line whose center falls in
 * a gap (a box can overflow its strip a bit) goes to the nearest section instead of being dropped: that is
 * exactly a two line name whose second half touches the edge.
 *
 * @returns Map<clave, lines sorted by Y>
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
