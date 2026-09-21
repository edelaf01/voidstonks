// protocol between PaddleRepository and paddle.worker.js with timeouts and result cleanup

export function mensajeInit(id, { cdn, pedido, local, opciones }) { return { tipo: "init", id, cdn, pedido, local, opciones }; }
export function mensajeReconoce(id, imagen) { return { tipo: "recognize", id, imagen }; }
export function respuestaResultado(id, resultado) { return { tipo: "resultado", id, resultado }; }
export function respuestaError(id, e) {
    return { tipo: "error", id, error: { message: e?.message ?? String(e), name: e?.name ?? "Error" } };
}

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

// inside the worker relative paths resolve against /js/repositories/ and 404
export function rutasAbsolutas(rutas, base) {
    if (!rutas || typeof rutas !== "object") return rutas;
    const out = {};
    for (const [k, v] of Object.entries(rutas)) out[k] = typeof v === "string" ? new URL(v, base).href : v;
    return out;
}

export function eligeModelo(mod, pedido, local) {
    return (typeof pedido === "string" ? mod?.[pedido] : pedido) || local;
}

export function puedeUsarWorker(g = globalThis) {
    return g.PADDLE_WORKER !== false && typeof g.Worker === "function"
        && typeof g.OffscreenCanvas === "function" && typeof g.createImageBitmap === "function";
}

export function transferiblesDe(imagen) {
    return typeof ImageBitmap !== "undefined" && imagen instanceof ImageBitmap ? [imagen] : [];
}

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
