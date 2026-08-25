/**
 * Repository for Tesseract.js worker management and raw recognition.
 */
export const OCRRepository = {
    // Bloque uniforme de texto. Lo comparte todo el escáner salvo recognizeWithPSM.
    DEFAULT_PSM: "6",

    workers: [],
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
                        tessedit_pageseg_mode: this.DEFAULT_PSM,
                        user_defined_dictionary_priority: "1",
                    });
                    return w;
                };

                // Arranca con UN solo worker: el escaneo de rivens y la detección de contexto
                // corren secuenciales sobre workers[0], así que el 2º worker estándar solo pagaba
                // RAM (una instancia WASM) sin aportar nada hasta que el usuario escanea el grid de
                // inventario o recompensas. Se crea perezosamente con ensureSecondWorker(). Las
                // CANTIDADES ya no usan Tesseract (template-matching en utils/badge_digit_ocr.js),
                // por eso no hay workers de badges.
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

    // Crea el 2º worker estándar bajo demanda (paraleliza las 2 pasadas de recompensas y el
    // grid de inventario). Idempotente; memoiza la promesa para no crear dos en carrera.
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

    /**
     * Shuts down all workers.
     */
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
     * Executes recognition on an image.
     */
    /**
     * Reconoce con OTRO modo de segmentación y deja el worker como estaba.
     *
     * La rejilla de reliquias necesita las dos: con psm 6 (bloque uniforme) salen los
     * nombres pero se pierden los contadores sueltos, y con psm 11 (texto disperso) al
     * revés. El modo es un parámetro del worker, no de la llamada, así que hay que
     * ponerlo y devolverlo — y por eso se restaura en un finally: si se queda en 11, la
     * detección de contexto y el escáner de rivens leen peor sin que nada lo delate.
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
            // `output` (p.ej. { blocks: true }) pide a Tesseract las cajas por palabra/línea,
            // necesarias para separar dos cartas side-by-side por posición X.
            return await worker.recognize(image, options, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
