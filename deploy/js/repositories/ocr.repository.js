/**
 * Repository for Tesseract.js worker management and raw recognition.
 */
export const OCRRepository = {
    workers: [],
    badgeWorkers: [],
    initPromise: null,

    /**
     * Loads the Tesseract loader script on demand (the heavy wasm core is fetched
     * later by createWorker). Keeps the main page light for price-only users.
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

    /**
     * Initializes a pool of Tesseract workers.
     */
    async warmUp(timeout = 60000) {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                await this.loadTesseractScript();
                const tess = globalThis.Tesseract;
                if (!tess) throw new Error("Tesseract not found");

                // Carga los datos de idioma desde el archivo local (tessdata_fast, ~4MB en vez
                // de los 23MB del tessdata estándar). Menos RAM por worker y sin depender del CDN.
                // Se deja worker/core en el default (que ya funciona) para no tocar el wiring del WASM.
                const LOCAL_LANG = { langPath: "js/", gzip: false };

                const createStandardWorker = async () => {
                    const w = await tess.createWorker("eng", 1, LOCAL_LANG);
                    await w.setParameters({
                        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '/%,.",
                        tessedit_pageseg_mode: "6",
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                const createBadgeWorker = async () => {
                    const w = await tess.createWorker("eng", 1, LOCAL_LANG);
                    await w.setParameters({
                        tessedit_char_whitelist: " 0123456789",
                        tessedit_pageseg_mode: "7",
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                // Arranca con UN solo worker: el escaneo de rivens y la detección de contexto
                // corren secuenciales sobre workers[0], así que los otros 3 (2º estándar + 2 de
                // badges) solo pagaban RAM (una instancia WASM cada uno) sin aportar nada hasta
                // que el usuario escanea el grid de inventario o recompensas. Esos se crean
                // perezosamente con ensureSecondWorker()/ensureBadgeWorkers().
                this._createStandardWorker = createStandardWorker;
                this._createBadgeWorker = createBadgeWorker;
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

    // Crea el 2º worker estándar bajo demanda (paraleliza las 2 pasadas de recompensas y el
    // grid de inventario). Idempotente; memoiza la promesa para no crear dos en carrera.
    async ensureSecondWorker() {
        if (this.workers[1]) return;
        if (!this._createStandardWorker) return; // warmUp no completado: workers[1]||workers[0] cubre
        if (!this._w2Promise) {
            this._w2Promise = this._createStandardWorker().then(w => { this.workers[1] = w; });
        }
        await this._w2Promise;
    },

    // Crea los 2 workers de badges (solo dígitos, cantidades del grid) bajo demanda.
    async ensureBadgeWorkers() {
        if (this.badgeWorkers.length) return;
        if (!this._createBadgeWorker) return;
        if (!this._badgePromise) {
            this._badgePromise = Promise.all([this._createBadgeWorker(), this._createBadgeWorker()])
                .then(ws => { this.badgeWorkers = ws; });
        }
        await this._badgePromise;
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
        this._w2Promise = null;
        this._badgePromise = null;
    },

    /**
     * Executes recognition on an image.
     */
    async recognize(worker, image, options = {}, output = undefined) {
        if (!worker) return { data: { text: "", confidence: 0 } };
        try {
            // `output` (p.ej. { blocks: true }) pide a Tesseract las cajas por palabra/línea,
            // necesarias para separar dos cartas side-by-side por posición X.
            return await worker.recognize(image, options, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
