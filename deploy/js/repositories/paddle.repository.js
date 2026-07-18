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
            const { PaddleOcrService, V5_EN_MOBILE_MODEL } = mod;
            // Modelo inglés móvil PP-OCRv5: ligero y de sobra para nombres en fuente latina.
            this._service = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
            await this._service.initialize();
            console.log("[Paddle] PaddleOCR listo (PP-OCRv5 EN mobile).");
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
};
