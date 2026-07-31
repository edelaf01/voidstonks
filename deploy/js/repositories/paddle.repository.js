/**
 * Repositorio de OCR con PaddleOCR (PP-OCRv5) vía onnxruntime-web — ALTERNATIVA
 * a Tesseract, en PARALELO. Lee el recorte de nombre a COLOR directamente (sin
 * binarizar): maneja cualquier tema/contraste por sí mismo, así que evita toda la
 * binarización por color de tema y la mayoría de los alias del matcher.
 *
 * Se activa con `globalThis.OCR_ENGINE = "paddle"` (por defecto "tesseract").
 * Carga la librería `ppu-paddle-ocr/web` por import dinámico desde un CDN ESM
 * (configurable con globalThis.PADDLE_CDN); los modelos se cachean en el primer uso.
 *
 * NOTA: WebGPU acelera mucho; con WASM va más lento (aceptable en escaneo puntual).
 * onnxruntime-web con hilos/WebGPU puede requerir aislamiento de origen (COOP/COEP)
 * — la librería incluye `coi-serviceworker.js` para ello si hiciera falta.
 */
export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    /** Carga la librería y arranca el servicio (una vez). */
    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || "https://esm.sh/ppu-paddle-ocr@latest/web";
            const mod = await import(/* @vite-ignore */ cdn);
            const { PaddleOcrService } = mod;
            // V6 TINY: 4,8 MB de descarga y ~630 ms por imagen, frente a los 12 MB y ~1,5 s
            // del PP-OCRv5 EN mobile con la misma precisión (ver MAINTENANCE_REWARD_PHOTO_OCR).
            const model = mod[globalThis.PADDLE_MODEL || "V6_TINY_MODEL"] || mod.V6_TINY_MODEL;
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
            // Paddle a veces pega dos palabras ("YareliPrime"): se separan también en el
            // cambio de minúscula a mayúscula, o el matcher no encuentra el token de ancla.
            const tokens = String(line.text)
                .replace(/([a-z])([A-Z])/g, "$1 $2")
                .split(/\s+/)
                .filter(Boolean);
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
