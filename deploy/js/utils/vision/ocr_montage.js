// stacks multiple crops into a single canvas to pay PaddleOCR detection cost once

const ALTO_MAXIMO = 6000;

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
        // gaps use the game background color because a jump to white is detected as text
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
