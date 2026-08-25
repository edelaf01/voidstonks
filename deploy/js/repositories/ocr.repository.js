/**
 * Tesseract.js worker pool and raw recognition.
 */
export const OCRRepository = {
    DEFAULT_PSM: "6",

    workers: [],
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

                const LOCAL_LANG = { langPath: "js/", gzip: false };

                const createStandardWorker = async () => {
                    const w = await tess.createWorker("eng", 1, LOCAL_LANG);
                    await w.setParameters({
                        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '/%,.",
                        tessedit_pageseg_mode: this.DEFAULT_PSM,
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                this._createStandardWorker = createStandardWorker;
                this.workers = [await createStandardWorker()];

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

    async ensureSecondWorker() {
        if (this.workers[1]) return;
        if (!this._createStandardWorker) return;
        if (!this._w2Promise) {
            this._w2Promise = this._createStandardWorker()
                .then(w => { this.workers[1] = w; })
                .catch(e => {
                    console.warn("[OCR Repo] Second worker failed to init:", e);
                    this.workers[1] = null;
                });
        }
        await this._w2Promise;
    },

    terminateAll() {
        this.workers.forEach(w => {
            if (w) {
                w.terminate();
            }
        });
        this.workers = [];
        this.initPromise = null;
        this._w2Promise = null;
    },

    /**
     * runs OCR with another PSM and restores the default: relic grid needs both because
     * psm 6 catches names but misses loose counters, while psm 11 does the reverse
     */
    async recognizeWithPSM(worker, image, psm, output = undefined) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
            return await worker.recognize(image, {}, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize PSM Err:", e);
            return { data: { text: "", confidence: 0 } };
        } finally {
            await worker.setParameters({ tessedit_pageseg_mode: this.DEFAULT_PSM })
                .catch((e) => console.error("[OCR Repo] no se pudo restaurar el psm:", e));
        }
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
