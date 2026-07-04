/**
 * Tesseract.js worker pool and raw recognition.
 */
export const OCRRepository = {
    workers: [],
    badgeWorkers: [],
    initPromise: null,

    /**
     * Loads the Tesseract loader script on demand 
     */
    loadTesseractScript() {
        if (globalThis.Tesseract) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const url = "js/tesseract.min.js";
            if (document.querySelector(`script[src="${url}"]`)) {
                const poll = setInterval(() => {
                    if (globalThis.Tesseract) { clearInterval(poll); resolve(); }
                }, 50);
                setTimeout(() => { clearInterval(poll); resolve(); }, 10000);
                return;
            }
            const script = document.createElement("script");
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Tesseract Script Load Fail"));
            document.head.appendChild(script);
        });
    },

    async warmUp(timeout = 60000) {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                await this.loadTesseractScript();
                const tess = globalThis.Tesseract;
                if (!tess) throw new Error("Tesseract not found");

                const createStandardWorker = async () => {
                    const w = await tess.createWorker("eng", 1);
                    await w.setParameters({
                        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '/%,.",
                        tessedit_pageseg_mode: "6",
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                const createBadgeWorker = async () => {
                    const w = await tess.createWorker("eng", 1);
                    await w.setParameters({
                        tessedit_char_whitelist: " 0123456789",
                        tessedit_pageseg_mode: "7",
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                const results = await Promise.all([
                    createStandardWorker(),
                    createStandardWorker(),
                    createBadgeWorker(),
                    createBadgeWorker()
                ]);

                this.workers = [results[0], results[1]];
                this.badgeWorkers = [results[2], results[3]];

                return true;
            } catch (e) {
                console.error("[OCR Repo] Warmup Fail:", e);
                this.initPromise = null;
                return false;
            }
        })();

        const timeoutPromise = new Promise(r => setTimeout(() => r(false), timeout));
        return Promise.race([this.initPromise, timeoutPromise]);
    },

    terminateAll() {
        [...this.workers, ...new Set(this.badgeWorkers)].forEach(w => {
            if (w) {
                w.terminate();
            }
        });
        this.workers = [];
        this.badgeWorkers = [];
        this.initPromise = null;
    },

    async recognize(worker, image, options = {}, output = undefined) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            // `output` (e.g. { blocks: true }) requests word/line boxes from Tesseract to split side-by-side cards by X position when rolling rivens
            return await worker.recognize(image, options, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
