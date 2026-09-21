/**
 * Protocolo entre PaddleRepository (página) y paddle.worker.js: mensajes, peticiones pendientes
 * con timeout y saneado del resultado. Puro (sin DOM ni Worker) para que cliente y worker se
 * prueben en Node por un MessageChannel real.
 */

export function mensajeInit(id, { cdn, pedido, local, opciones }) { return { tipo: "init", id, cdn, pedido, local, opciones }; }
export function mensajeReconoce(id, imagen) { return { tipo: "recognize", id, imagen }; }
export function respuestaResultado(id, resultado) { return { tipo: "resultado", id, resultado }; }
export function respuestaError(id, e) {
    return { tipo: "error", id, error: { message: e?.message ?? String(e), name: e?.name ?? "Error" } };
}

/**
 * Deja solo lo que viaja por postMessage: una función o un tensor colado en una línea daría
 * DataCloneError y se perdería la página entera. Conserva lo que ya filtra el repositorio
 * (líneas sin caja, `lines` sin anidar, null).
 */
export function aplanaResultado(res) {
    const grupos = Array.isArray(res?.lines) ? res.lines : [];
    const caja = (b) => (b && typeof b === "object"
        ? { x: Number(b.x) || 0, y: Number(b.y) || 0, width: Number(b.width) || 0, height: Number(b.height) || 0 }
        : null);
    return {
        text: typeof res?.text === "string" ? res.text : "",
        confidence: typeof res?.confidence === "number" ? res.confidence : null,
        lines: grupos.map((g) => (Array.isArray(g) ? g : [g]).filter(Boolean).map((l) => ({
            text: typeof l?.text === "string" ? l.text : "",
            confidence: typeof l?.confidence === "number" ? l.confidence : null,
            box: caja(l?.box),
        }))),
    };
}

/**
 * Dentro del worker `fetch("assets/ocr/x.ort")` resuelve contra /js/repositories/ y da 404: las
 * rutas relativas se convierten a absolutas respecto a la página. Lo que no es una cadena
 * (un ArrayBuffer con el modelo) se deja igual.
 */
export function rutasAbsolutas(rutas, base) {
    if (!rutas || typeof rutas !== "object") return rutas;
    const out = {};
    for (const [k, v] of Object.entries(rutas)) out[k] = typeof v === "string" ? new URL(v, base).href : v;
    return out;
}

/** PADDLE_MODEL admite el NOMBRE de un modelo de la librería o un objeto; si no existe, el nuestro. */
export function eligeModelo(mod, pedido, local) {
    return (typeof pedido === "string" ? mod?.[pedido] : pedido) || local;
}

/** PADDLE_WORKER=false es el interruptor para comparar en el navegador (como PADDLE_CDN). */
export function puedeUsarWorker(g = globalThis) {
    return g.PADDLE_WORKER !== false && typeof g.Worker === "function"
        && typeof g.OffscreenCanvas === "function" && typeof g.createImageBitmap === "function";
}

export function transferiblesDe(imagen) {
    return typeof ImageBitmap !== "undefined" && imagen instanceof ImageBitmap ? [imagen] : [];
}

/**
 * Registro de peticiones en vuelo con timeout. Los ids son enteros crecientes por instancia; una
 * respuesta tardía (id ya expirado o desconocido) se ignora sin lanzar.
 */
export function crearLlamadasPendientes({ programa = setTimeout, cancela = clearTimeout } = {}) {
    const pendientes = new Map();
    let siguiente = 0;
    const saca = (id) => { const p = pendientes.get(id); if (p) { pendientes.delete(id); cancela(p.timer); } return p; };
    return {
        registra(timeoutMs, alExpirar) {
            const id = ++siguiente;
            let entrada;
            const promesa = new Promise((resolve, reject) => {
                const timer = programa(() => {
                    if (!pendientes.delete(id)) return;
                    reject(new Error(`sin respuesta en ${timeoutMs} ms`));
                    alExpirar?.();
                }, timeoutMs);
                entrada = { resolve, reject, timer };
            });
            pendientes.set(id, entrada);
            return { id, promesa };
        },
        resuelve(id, valor) { const p = saca(id); if (p) p.resolve(valor); return !!p; },
        rechaza(id, error) { const p = saca(id); if (p) p.reject(error); return !!p; },
        rechazaTodas(error) { for (const id of [...pendientes.keys()]) saca(id).reject(error); },
        enVuelo() { return pendientes.size; },
    };
}
