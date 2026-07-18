export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || "https://esm.sh/ppu-paddle-ocr@latest/web";
            const mod = await import(/* @vite-ignore */ cdn);
            const { PaddleOcrService, V5_EN_MOBILE_MODEL } = mod;
            this._service = new PaddleOcrService({ model: V5_EN_MOBILE_MODEL });
            await this._service.initialize();
            console.log("[Paddle] PaddleOCR listo (PP-OCRv5 EN mobile).");
            return this._service;
        })();
        return this._initPromise;
    },

    /**
     * recognizes text from a color canvas and returns uppercase words matching
     * OCRService.extractCellText format for getValidItemMatch
     */
    async recognizeWords(colorCanvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(colorCanvas);
        const text = (res && res.text) ? res.text : "";
        const words = text.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        return words.length ? words.map((w) => w.toUpperCase()) : null;
    },
};
