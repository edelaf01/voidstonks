import { respuestaResultado, respuestaError, aplanaResultado, eligeModelo } from "../utils/vision/paddle_rpc.js";

/**
 * Extremo del worker de PaddleRepository: carga la librería y responde a "init"/"recognize".
 * Corre aquí y no en la página porque onnxruntime-web bloquea el hilo desde el que se le llama
 * (200-600 ms por montaje): era la congelación del HUD en modo auto.
 */
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
    // FIFO: el servicio ONNX es único y no es seguro llamarlo en paralelo; y así una lectura
    // que llegue antes de acabar la carga espera en vez de fallar.
    puerto.onmessage = (ev) => { cola = cola.then(() => atiende(ev.data)); };
}

/** La librería solo acepta algo con getContext: el bitmap se pinta en un canvas del worker. */
function pintaBitmap(imagen, crearCanvas) {
    const c = crearCanvas(imagen.width, imagen.height);
    // willReadFrequently ANTES del primer drawImage: solo cuenta en el primer getContext, y la
    // librería hace getImageData del canvas entero varias veces por llamada.
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(imagen, 0, 0);
    imagen.close?.(); // el bitmap ya es del worker; sin close se queda hasta el GC
    return c;
}

/** debug_log.js solo silencia la consola de la página: los avisos del worker se le mandan. error se queda nativo. */
function redirigeConsola(puerto, consola) {
    for (const nivel of ["log", "info", "debug", "warn"]) {
        consola[nivel] = (...args) => puerto.postMessage({ tipo: "log", nivel, args: args.map((a) => (typeof a === "string" ? a : String(a))) });
    }
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) arrancaWorkerPaddle(self, { consola: console });
