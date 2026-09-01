/**
 * Repositorio de OCR con PaddleOCR (PP-OCRv5) vía onnxruntime-web — ALTERNATIVA
 * a Tesseract, en PARALELO. Lee el recorte de nombre a COLOR directamente (sin
 * binarizar): maneja cualquier tema/contraste por sí mismo, así que evita toda la
 * binarización por color de tema y la mayoría de los alias del matcher.
 *
 * Lo elige el usuario en el HUD del escáner; la preferencia la lleva
 * services/scanner/ocr_engine.service.js (por defecto, el clásico).
 * Carga la librería `ppu-paddle-ocr/web` por import dinámico desde un CDN ESM con la versión
 * FIJADA (configurable con globalThis.PADDLE_CDN); los modelos los servimos nosotros desde
 * deploy/assets/ocr/ y se cachean en el primer uso.
 *
 * NOTA: WebGPU acelera mucho; con WASM va más lento (aceptable en escaneo puntual).
 * onnxruntime-web con hilos/WebGPU puede requerir aislamiento de origen (COOP/COEP)
 * — la librería incluye `coi-serviceworker.js` para ello si hiciera falta.
 */
export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    /**
     * ¿Está el motor cargado YA? Distinto de `warmUp()`, que lo carga: quien lee frames en vivo
     * no puede esperar a que bajen 4,8 MB de modelo, así que pregunta y sigue con el otro motor
     * si aún no está.
     */
    listo() { return !!this._service; },

    /** Carga la librería y arranca el servicio (una vez). */
    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            // Versión FIJA, no @latest: el paquete es de un tercero y una publicación suya
            // rompería la app en caliente, sin tocar nosotros nada.
            const cdn = globalThis.PADDLE_CDN || "https://esm.sh/ppu-paddle-ocr@6.4.3/web";
            const mod = await import(/* @vite-ignore */ cdn);
            const { PaddleOcrService } = mod;
            // V6 TINY: 4,8 MB de descarga y ~630 ms por imagen, frente a los 12 MB y ~1,5 s
            // del PP-OCRv5 EN mobile con la misma precisión (ver MAINTENANCE_REWARD_PHOTO_OCR).
            // Servidos por nosotros: por defecto la librería los baja de HuggingFace en cada
            // navegador nuevo, así que el escáner dependía de que ese host estuviera arriba.
            const local = {
                detection: "assets/ocr/PP-OCRv6_tiny_det.ort",
                recognition: "assets/ocr/PP-OCRv6_tiny_rec.ort",
                charactersDictionary: "assets/ocr/ppocrv6_tiny_dict.txt",
            };
            // PADDLE_MODEL sigue admitiendo el NOMBRE de un modelo de la librería (que se baja
            // de su host) para poder comparar motores sin tocar código; lo que cambia es que el
            // de por defecto ya es el nuestro.
            const pedido = globalThis.PADDLE_MODEL;
            const model = (typeof pedido === "string" ? mod[pedido] : pedido) || local;
            this._service = new PaddleOcrService({ model });
            await this._service.initialize();
            console.log("[Paddle] listo (V6 TINY).");
            return this._service;
        })();
        return this._initPromise;
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
        const lines = (res?.lines || []).flat().filter((l) => l?.box && l?.text);
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
