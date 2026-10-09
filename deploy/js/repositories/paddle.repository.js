/**
 * paddleocr (pp-ocrv5) via onnxruntime-web as a parallel alternative to tesseract: reads color
 * name crops directly without theme binarization
 *
 * inference runs in paddle.worker.js to avoid blocking the ui (200-600 ms per montage),
 * falling back to main thread if the worker fails to spawn; loads pinned ppu-paddle-ocr/web
 * (configurable via globalThis.PADDLE_CDN) with models in deploy/assets/ocr/
 */
//TODO lookup cdn dependency consider hosting it or hash checking
import { montaTiras, repartePorTramos } from "../utils/vision/ocr_montage.js";
import { PaddleWorkerClient } from "./paddle_worker_client.js";
import { rutasAbsolutas, eligeModelo, puedeUsarWorker } from "../utils/vision/paddle_rpc.js";
import { pistasDelLog } from "../utils/ganchos.js";

const CDN = "https://esm.sh/ppu-paddle-ocr@6.4.3/web?alias=onnxruntime-web:onnxruntime-web/wasm&deps=onnxruntime-web@1.30.0";
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

    SUELTA_REPOSO_MS: 10 * 60 * 1000,
    _enUso: 0,
    _ultimoUso: 0,
    _relojReposo: null,
    _enReposo: false,

    disponible() {
        if (!this._service && this._enReposo && !this._initPromise) this.warmUp().catch(() => {});
        return this.listo();
    },

    ultimoFallo: null,

    _arranquesWorker: 0,
    _modo: null,
    modo() { return this._service ? this._modo : null; },

    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || CDN;
            const pedido = globalThis.PADDLE_MODEL ?? null;
            this._service = (await this._arrancaWorker(cdn, pedido)) || (await this._cargaEnHilo(cdn, pedido));
            this.ultimoFallo = null;
            this._enReposo = false;
            this._marcaUso();
            return this._service;
        })();
        this._initPromise.catch((e) => {
            this.ultimoFallo = e;
            this._initPromise = null;
            this._enReposo = false;
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
            console.log(`[Paddle] listo (V6 TINY, worker) · proveedores: ${info.proveedores.join(",")} · aislamiento de origen: ${info.aislado}`);
            return cliente;
        } catch (e) {
            cliente.terminate();
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
     * Frees the worker engine when the scanner closes. The main-thread fallback cannot be freed.
     */
    apaga() {
        clearTimeout(this._relojReposo);
        this._relojReposo = null;
        this._enReposo = false;
        if (!this._service || this._service.terminate) {
            this._service?.terminate();
            this._service = null; this._initPromise = null; this._modo = null;
        }
        this._arranquesWorker = 0;
    },

    _workerMurio(cliente, e) {
        if (this._service !== cliente) return;
        this._service = null; this._initPromise = null; this.ultimoFallo = e;
        console.error("[Paddle] el worker murió; se rearranca:", e);
        this.warmUp().catch(() => {});
    },

    _marcaUso() {
        this._ultimoUso = Date.now();
        this._programaReposo(this.SUELTA_REPOSO_MS);
    },

    _programaReposo(ms) {
        clearTimeout(this._relojReposo);
        this._relojReposo = setTimeout(() => this.sueltaEnReposo(), ms);
        this._relojReposo?.unref?.();
    },

    sueltaEnReposo(ahora = Date.now()) {
        if (!this._service?.terminate || this._enUso > 0) return false;
        const falta = this.SUELTA_REPOSO_MS - (ahora - this._ultimoUso);
        if (falta > 0) { this._programaReposo(falta); return false; }
        if (pistasDelLog.enMision() === true) { this._programaReposo(this.SUELTA_REPOSO_MS); return false; }
        const svc = this._service;
        this._service = null; this._initPromise = null; this._modo = null; this._lote = null;
        this._arranquesWorker = 0; this._relojReposo = null; this._enReposo = true;
        svc.terminate();
        console.log("[Paddle] liberado tras diez minutos sin leer; se recarga en la próxima lectura");
        return true;
    },

    async _lee(canvas) {
        const svc = await this.warmUp();
        this._enUso++;
        try {
            return await svc.recognize(canvas);
        } finally {
            this._enUso--;
            this._marcaUso();
        }
    },

    /**
     * recognizes text from a color canvas and returns uppercase words matching
     * OCRService.extractCellText format for getValidItemMatch
     */
    async recognizeWords(colorCanvas) {
        const res = await this._lee(colorCanvas);
        const text = (res && res.text) ? res.text : "";
        const words = text.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        return words.length ? words.map((w) => w.toUpperCase()) : null;
    },

    /**
     * reads multiple crops from the same frame in a single pass (see utils/vision/ocr_montage.js)
     * @param tiras [{ clave, sx, sy, sw, sh }]
     * @returns Map<clave, uppercase words> matching OCRService.extractCellText format
     */
    async recognizeStripWords(fuente, tiras, opciones = {}) {
        const salida = new Map();
        this._lote = new Map();
        for (const { canvas, tramos } of montaTiras(fuente, tiras, opciones)) {
            const res = await this._lee(canvas);
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

    /** Palabras con caja  de la última tira leída con esa clave. */
    palabrasDelLote(clave) {
        return this._lote?.get(clave) ? this._palabrasConCaja(this._lote.get(clave).lineas) : [];
    },

    /** rgba crop of the montage (in color, matching box geometry) for a box in that strip */
    recorteDelLote(clave) {
        const canvas = this._lote?.get(clave)?.canvas;
        return ({ x0, y0, x1, y1 }) => {
            if (!canvas) return null;
            const pad = 3, sx = Math.max(0, Math.floor(x0) - pad), sy = Math.max(0, Math.floor(y0) - pad);
            const sw = Math.min(canvas.width - sx, Math.ceil(x1 - x0) + pad * 2), sh = Math.min(canvas.height - sy, Math.ceil(y1 - y0) + pad * 2);
            return sw > 2 && sh > 2 ? canvas.getContext("2d", { willReadFrequently: true }).getImageData(sx, sy, sw, sh) : null;
        };
    },

    async recognizeLines(canvas) {
        const res = await this._lee(canvas);
        return (res?.lines || []).flat().filter((l) => l?.box && l?.text);
    },

    /**
     * recognizes canvas text and returns words with bounding boxes matching Tesseract format
     * (`{ text, bbox: { x0, x1, y0, y1 } }`) to feed parseRewards and column filtering unchanged
     */
    async recognizeWordsWithBoxes(canvas) {
        const res = await this._lee(canvas);
        return this._palabrasConCaja((res?.lines || []).flat().filter((l) => l?.box && l?.text));
    },

    _palabrasConCaja(lines) {
        const words = [];
        for (const line of lines) {
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
