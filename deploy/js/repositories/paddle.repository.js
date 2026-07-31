export const PaddleRepository = {
    _service: null,
    _initPromise: null,

    warmUp() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            const cdn = globalThis.PADDLE_CDN || "https://esm.sh/ppu-paddle-ocr@latest/web";
            const mod = await import(/* @vite-ignore */ cdn);
            const { PaddleOcrService } = mod;
            const model = mod[globalThis.PADDLE_MODEL || "V6_TINY_MODEL"] || mod.V6_TINY_MODEL;
            this._service = new PaddleOcrService({ model });
            await this._service.initialize();
            console.log("[Paddle] listo (V6 TINY).");
            return this._service;
        })();
        return this._initPromise;
    },

    async recognizeWords(colorCanvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(colorCanvas);
        const text = (res && res.text) ? res.text : "";
        const words = text.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
        return words.length ? words.map((w) => w.toUpperCase()) : null;
    },

    async recognizeWordsWithBoxes(canvas) {
        const svc = await this.warmUp();
        const res = await svc.recognize(canvas);
        const lines = (res?.lines || []).flat().filter((l) => l?.box && l?.text);
        const words = [];
        for (const line of lines) {
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
