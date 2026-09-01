export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    listo() { return !!this._service; },

    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || "https://esm.sh/ppu-paddle-ocr@6.4.3/web";
            const mod = await import(/* @vite-ignore */ cdn);
            const { PaddleOcrService } = mod;
            const local = {
                detection: "assets/ocr/PP-OCRv6_tiny_det.ort",
                recognition: "assets/ocr/PP-OCRv6_tiny_rec.ort",
                charactersDictionary: "assets/ocr/ppocrv6_tiny_dict.txt",
            };
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

    /**
     * recognizes canvas text and returns words with bounding boxes matching Tesseract format
     * (`{ text, bbox: { x0, x1, y0, y1 } }`) to feed parseRewards and column filtering unchanged
     */
    async recognizeWordsWithBoxes(canvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(canvas);
        const lines = (res?.lines || []).flat().filter((l) => l?.box && l?.text);
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
