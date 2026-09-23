import { respuestaResultado, respuestaError, aplanaResultado, eligeModelo } from "../utils/vision/paddle_rpc.js";

export function arrancaWorkerPaddle(puerto, { importar = (u) => import(/* @vite-ignore */ u), crearCanvas = (w, h) => new OffscreenCanvas(w, h), consola = null } = {}) {
    let servicio = null;
    let cola = Promise.resolve();
    if (consola) redirigeConsola(puerto, consola);
    const atiende = async (msg) => {
        try {
            if (msg?.tipo === "init") {
                const mod = await importar(msg.cdn);
                servicio = new mod.PaddleOcrService({ model: eligeModelo(mod, msg.pedido, msg.local), ...msg.opciones });
                await servicio.initialize();
                puerto.postMessage(respuestaResultado(msg.id, {
                    proveedores: servicio.options?.session?.executionProviders ?? [],
                    aislado: globalThis.crossOriginIsolated === true,
                }));
            } else if (msg?.tipo === "recognize") {
                if (!servicio) throw new Error("worker de Paddle sin inicializar");
                puerto.postMessage(respuestaResultado(msg.id, aplanaResultado(await servicio.recognize(pintaBitmap(msg.imagen, crearCanvas)))));
            } else {
                throw new Error(`tipo desconocido: ${msg?.tipo}`);
            }
        } catch (e) {
            puerto.postMessage(respuestaError(msg?.id, e));
        }
    };
    puerto.onmessage = (ev) => { cola = cola.then(() => atiende(ev.data)); };
}

function pintaBitmap(imagen, crearCanvas) {
    const c = crearCanvas(imagen.width, imagen.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(imagen, 0, 0);
    imagen.close?.();
    return c;
}

function redirigeConsola(puerto, consola) {
    for (const nivel of ["log", "info", "debug", "warn"]) {
        consola[nivel] = (...args) => puerto.postMessage({ tipo: "log", nivel, args: args.map((a) => (typeof a === "string" ? a : String(a))) });
    }
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) arrancaWorkerPaddle(self, { consola: console });
