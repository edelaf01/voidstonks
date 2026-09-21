/**
 * Repositorio de OCR con PaddleOCR (PP-OCRv5) vía onnxruntime-web: ALTERNATIVA a Tesseract, en
 * PARALELO. Lee el recorte de nombre a COLOR directamente (sin binarizar): maneja cualquier
 * tema/contraste por sí mismo, así que evita toda la binarización por color de tema y la
 * mayoría de los alias del matcher.
 *
 * Lo elige el usuario en el HUD del escáner; la preferencia la lleva
 * services/scanner/ocr_engine.service.js (por defecto, el clásico).
 *
 * La inferencia corre en paddle.worker.js: onnxruntime-web bloquea el hilo desde el que se le
 * llama (200-600 ms por montaje) y en la página era la congelación del HUD en modo auto. Si el
 * worker no arranca, la librería se carga en el hilo principal como antes. En ambos casos se
 * importa `ppu-paddle-ocr/web` desde un CDN ESM con la versión FIJADA (configurable con
 * globalThis.PADDLE_CDN); los modelos los servimos nosotros desde deploy/assets/ocr/.
 */
import { montaTiras, repartePorTramos } from "../utils/vision/ocr_montage.js";
import { PaddleWorkerClient } from "./paddle_worker_client.js";
import { rutasAbsolutas, eligeModelo, puedeUsarWorker } from "../utils/vision/paddle_rpc.js";

const CDN = "https://esm.sh/ppu-paddle-ocr@6.4.3/web";
const MODELO_LOCAL = {
    detection: "assets/ocr/PP-OCRv6_tiny_det.ort",
    recognition: "assets/ocr/PP-OCRv6_tiny_rec.ort",
    charactersDictionary: "assets/ocr/ppocrv6_tiny_dict.txt",
};
const OPCIONES = { recognition: { strategy: "per-box" } };
export const RUTA_WORKER_PADDLE = "./paddle.worker.js?v=1.0";
const MAX_ARRANQUES_WORKER = 2;

export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    listo() { return !!this._service; },

    /** Última carga fallida, para que la UI pueda decirlo en vez de quedarse en "preparando". */
    ultimoFallo: null,

    _arranquesWorker: 0,
    _modo: null,
    modo() { return this._service ? this._modo : null; },

    /** Carga la librería y arranca el servicio (una vez, o de nuevo si la anterior falló). */
    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || CDN;
            const pedido = globalThis.PADDLE_MODEL ?? null;
            this._service = (await this._arrancaWorker(cdn, pedido)) || (await this._cargaEnHilo(cdn, pedido));
            this.ultimoFallo = null;
            return this._service;
        })();
        // Un fallo NO puede quedarse cacheado: la promesa rechazada se devolvía para siempre, así
        // que un tropiezo puntual (CDN, un momento sin red) dejaba el motor preciso muerto toda
        // la sesión y TODO pasaba a leerse con el clásico, más lento y peor, sin decir nada.
        // console.error y no warn: debug_log.js silencia el resto en producción.
        this._initPromise.catch((e) => {
            this.ultimoFallo = e;
            this._initPromise = null;
            console.error("[Paddle] no se pudo cargar el motor preciso; se lee con el clásico:", e);
        });
        return this._initPromise;
    },

    async _arrancaWorker(cdn, pedido) {
        if (!puedeUsarWorker(globalThis) || this._arranquesWorker >= MAX_ARRANQUES_WORKER) return null;
        this._arranquesWorker++;
        const cliente = new PaddleWorkerClient({
            crearWorker: () => new Worker(new URL(RUTA_WORKER_PADDLE, import.meta.url), { type: "module" }),
            aBitmap: (fuente) => createImageBitmap(fuente),
            onMuerte: (e) => this._workerMurio(cliente, e),
        });
        try {
            const base = globalThis.document?.baseURI || globalThis.location?.href;
            const info = await cliente.init({ cdn, pedido, local: rutasAbsolutas(MODELO_LOCAL, base), opciones: OPCIONES });
            this._modo = "worker";
            // Sin aislamiento de origen onnxruntime-web se queda en un hilo WASM; se registra
            // porque no hay otra forma de saber cuál de los dos casos es.
            console.log(`[Paddle] listo (V6 TINY, worker) · proveedores: ${info.proveedores.join(",")} · aislamiento de origen: ${info.aislado}`);
            return cliente;
        } catch (e) {
            cliente.terminate();
            // error y no warn: debug_log.js silencia el resto en producción, y es la única pista de por qué el escaneo congela.
            console.error("[Paddle] el worker no arrancó; el motor preciso se carga en el hilo principal:", e);
            return null;
        }
    },

    async _cargaEnHilo(cdn, pedido) {
        const mod = await import(/* @vite-ignore */ cdn);
        const servicio = new mod.PaddleOcrService({ model: eligeModelo(mod, pedido, MODELO_LOCAL), ...OPCIONES });
        await servicio.initialize();
        this._modo = "hilo";
        console.log(`[Paddle] listo (V6 TINY, hilo) · aislamiento de origen: ${globalThis.crossOriginIsolated === true}`);
        return servicio;
    },

    /**
     * Suelta el motor al cerrar el escáner: el worker (onnxruntime + modelos, ~200 MB) se quedaba
     * entre sesiones. La siguiente lo recarga; librería y modelos ya están en la caché del
     * navegador. El servicio en hilo principal no se puede liberar: se deja.
     */
    apaga() {
        if (!this._service || this._service.terminate) {
            this._service?.terminate();
            this._service = null; this._initPromise = null; this._modo = null;
        }
        this._arranquesWorker = 0;
    },

    _workerMurio(cliente, e) {
        if (this._service !== cliente) return; // ya sustituido, o murió en el init (lo gestiona _arrancaWorker)
        this._service = null; this._initPromise = null; this.ultimoFallo = e; // rejillaConClasico() da true en el hueco
        console.error("[Paddle] el worker murió; se rearranca:", e);
        this.warmUp().catch(() => {});
    },

    /**
     * Reconoce el texto de un canvas a COLOR (la banda de nombre recortada, sin
     * binarizar) y devuelve las PALABRAS en mayúsculas — mismo formato que
     * OCRService.extractCellText, para alimentar getValidItemMatch sin cambios.
     */
    async recognizeWords(colorCanvas) {
        const svc = await this.warmUp();
        // ppu-paddle-ocr acepta un canvas directamente (usa getContext/getImageData).
        const res = await svc.recognize(colorCanvas);
        const text = (res && res.text) ? res.text : "";
        const words = text.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        return words.length ? words.map((w) => w.toUpperCase()) : null;
    },

    /**
     * Lee VARIOS recortes del mismo frame en una sola pasada (ver utils/vision/ocr_montage.js).
     *
     * Una celda del inventario a la vez costaba 49 ms cada una porque cada llamada paga entera
     * la red de detección; apiladas en un montaje salen a 12 ms. Sobre las 18 celdas de una
     * página: 889 ms -> 209 ms, por debajo de los 420 ms de Tesseract sobre esos mismos recortes.
     *
     * @param tiras [{ clave, sx, sy, sw, sh }]
     * @returns Map<clave, palabras en MAYÚSCULAS> — mismo formato que OCRService.extractCellText.
     */
    async recognizeStripWords(fuente, tiras, opciones = {}) {
        const svc = await this.warmUp();
        const salida = new Map();
        this._lote = new Map();
        for (const { canvas, tramos } of montaTiras(fuente, tiras, opciones)) {
            const res = await svc.recognize(canvas);
            const lineas = (res?.lines || []).flat().filter((l) => l?.box && l?.text);
            for (const [clave, suyas] of repartePorTramos(lineas, tramos)) {
                const palabras = suyas.map((l) => l.text).join(" ")
                    .replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
                salida.set(clave, palabras.length ? palabras.map((w) => w.toUpperCase()) : null);
                this._lote.set(clave, { lineas: suyas, canvas });
            }
        }
        return salida;
    },

    /** Palabras con caja (reparto por caracteres, como recognizeWordsWithBoxes) de la última tira leída con esa clave. */
    palabrasDelLote(clave) {
        return this._lote?.get(clave) ? this._palabrasConCaja(this._lote.get(clave).lineas) : [];
    },

    /** Recorte RGBA del montaje (a color, misma geometría que las cajas) para una caja de esa tira. */
    recorteDelLote(clave) {
        const canvas = this._lote?.get(clave)?.canvas;
        return ({ x0, y0, x1, y1 }) => {
            if (!canvas) return null;
            const pad = 3, sx = Math.max(0, Math.floor(x0) - pad), sy = Math.max(0, Math.floor(y0) - pad);
            const sw = Math.min(canvas.width - sx, Math.ceil(x1 - x0) + pad * 2), sh = Math.min(canvas.height - sy, Math.ceil(y1 - y0) + pad * 2);
            return sw > 2 && sh > 2 ? canvas.getContext("2d", { willReadFrequently: true }).getImageData(sx, sy, sw, sh) : null;
        };
    },

    /** Líneas crudas con su caja, para quien reparte por posición (montajes). */
    async recognizeLines(canvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(canvas);
        return (res?.lines || []).flat().filter((l) => l?.box && l?.text);
    },

    /**
     * Reconoce un canvas y devuelve las palabras CON SUS CAJAS, en el mismo formato que
     * Tesseract (`{ text, bbox: { x0, x1, y0, y1 } }`), para poder alimentar parseRewards
     * y el filtro por columnas sin cambios.
     *
     * Paddle devuelve una caja por LÍNEA, no por palabra, así que las palabras de una línea
     * se reparten proporcionalmente a lo ancho de esa caja. Basta para agrupar por columnas:
     * lo que importa es a qué card pertenece cada nombre, no el píxel exacto de cada letra.
     */
    async recognizeWordsWithBoxes(canvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(canvas);
        return this._palabrasConCaja((res?.lines || []).flat().filter((l) => l?.box && l?.text));
    },

    _palabrasConCaja(lines) {
        const words = [];
        for (const line of lines) {
            // Paddle a veces pega dos palabras ("YareliPrime"), pero separarlas por el cambio de
            // minúscula a mayúscula parte también las que llevan una mayúscula por error de
            // lectura: medido, "Lex Prime ReceIver" se convertía en "Rece Iver" y la pieza se
            // perdía entera. Las pegadas las deshace después splitFusedWords con el VOCABULARIO
            // del catálogo, que sabe dónde está la juntura de verdad.
            const tokens = String(line.text).split(/\s+/).filter(Boolean);
            if (!tokens.length) continue;
            const step = line.box.width / tokens.length;
            tokens.forEach((text, i) => words.push({
                text,
                confidence: (line.confidence ?? 1) * 100,
                bbox: {
                    x0: line.box.x + i * step,
                    x1: line.box.x + (i + 1) * step,
                    y0: line.box.y,
                    y1: line.box.y + line.box.height,
                },
            }));
        }
        return words;
    },
};
