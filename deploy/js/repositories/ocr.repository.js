// tesseract.js worker pool and raw recognition
const TESSERACT_VERSION = "7.0.0";

export const OCRRepository = {
    DEFAULT_PSM: "6",
    DEFAULT_CHARS: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789, ",
    RIVEN_CHARS: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '/%,.",

    workers: [],
    initPromise: null,

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

                const BASE = `js/tesseract/${TESSERACT_VERSION}`;
                const RUTAS = { workerPath: `${BASE}/worker.min.js`, corePath: `${BASE}/` };

                const createStandardWorker = async () => {
                    const w = await tess.createWorker("eng", 1, { ...LOCAL_LANG, ...RUTAS });
                    await w.setParameters({
                        tessedit_char_whitelist: this.DEFAULT_CHARS,
                        tessedit_pageseg_mode: this.DEFAULT_PSM,
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                console.log(`[OCR Repo] Tesseract ${TESSERACT_VERSION}, worker y core servidos en local.`);
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

    MAX_WORKERS: 2,

    async ensureWorkers(n = 2) {
        if (!this._createStandardWorker) return;
        const nucleos = globalThis.navigator?.hardwareConcurrency || 4;
        const tope = Math.max(1, Math.min(this.MAX_WORKERS, nucleos - 1));
        const objetivo = Math.min(n, tope);
        const pendientes = [];
        for (let i = this.workers.length; i < objetivo; i++) pendientes.push(i);
        for (const i of pendientes) {
            this._workerPromises ||= [];
            this._workerPromises[i] ||= this._createStandardWorker()
                .then((w) => { this.workers[i] = w; })
                .catch((e) => {
                    console.warn(`[OCR Repo] worker ${i} no arrancó:`, e);
                    this.workers[i] = null;
                });
        }
        await Promise.all(pendientes.map((i) => this._workerPromises[i]));
        this.workers = this.workers.filter(Boolean);
    },

    async ensureSecondWorker() { return this.ensureWorkers(2); },

    terminateAll() {
        this.workers.forEach(w => {
            if (w) {
                w.terminate();
            }
        });
        this.workers = [];
        this.initPromise = null;
        this._workerPromises = null;
    },

    // relic grid needs both: psm 6 catches names and psm 11 catches loose counters
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

    async recognizeWithChars(worker, image, chars, output = undefined) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            await worker.setParameters({ tessedit_char_whitelist: chars });
            return await worker.recognize(image, {}, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize chars Err:", e);
            return { data: { text: "", confidence: 0 } };
        } finally {
            await worker.setParameters({ tessedit_char_whitelist: this.DEFAULT_CHARS })
                .catch((e) => console.error("[OCR Repo] no se pudo restaurar la lista de caracteres:", e));
        }
    },

    async recognize(worker, image, options = {}, output = undefined) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            return await worker.recognize(image, options, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
