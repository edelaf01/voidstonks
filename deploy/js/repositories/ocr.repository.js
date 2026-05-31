/**
 * Repository for Tesseract.js worker management and raw recognition.
 */
export const OCRRepository = {
    workers: [],
    badgeWorkers: [],
    initPromise: null,

    /**
     * Initializes a pool of Tesseract workers.
     */
    async warmUp(timeout = 60000) {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                const tess = globalThis.Tesseract;
                if (!tess) throw new Error("Tesseract not found");

                const createStandardWorker = async () => {
                    const w = await tess.createWorker("eng", 1);
                    await w.setParameters({
                        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '",
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
                    createStandardWorker(),
                    createBadgeWorker(),
                    createBadgeWorker(),
                    createBadgeWorker()
                ]);

                this.workers = [results[0], results[1], results[2]];
                this.badgeWorkers = [results[3], results[4], results[5]];

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

    /**
     * Shuts down all workers.
     */
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

    /**
     * Executes recognition on an image.
     */
    async recognize(worker, image, options = {}) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            return await worker.recognize(image, options);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
