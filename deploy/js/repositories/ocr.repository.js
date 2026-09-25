/**
 * Repository for Tesseract.js worker management and raw recognition.
 */
/**
 * Versión de tesseract.js que se usa. Tiene que coincidir con la del bundle de deploy/js y con
 * la de los ficheros de deploy/js/tesseract/, que servimos nosotros; el test cruza las tres.
 */
const TESSERACT_VERSION = "7.0.0";

export const OCRRepository = {
    // Bloque uniforme de texto. Lo comparte todo el escáner salvo recognizeWithPSM.
    DEFAULT_PSM: "6",
    // Solo lo que aparece en los rótulos: letras, dígitos y la coma de los millares ("7,661"). El
    // espacio NO es un carácter a reconocer sino el separador del que vive todo el parseo — medido,
    // sin él Tesseract pega las palabras ("Steel Fccence" -> "SteelFccence").
    DEFAULT_CHARS: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789, ",
    // Las cartas de riven necesitan signo, punto decimal y "%": con la lista de los rótulos salía
    // "187,6 Critical Chance" y el parser, que se ancla en el "%", no encontraba ningún stat.
    RIVEN_CHARS: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '/%,.",

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

                // Worker y core SERVIDOS POR NOSOTROS, no por un CDN. Por defecto tesseract.js
                // los baja de jsdelivr en cada arranque, así que un compromiso de ese paquete
                // ejecuta código arbitrario en la página: es la misma superficie de ataque que
                // tendría un <script src> a un tercero, solo que menos visible porque la URL la
                // construye la librería sola concatenando su propia versión.
                //
                // `corePath` va como DIRECTORIO: la librería elige dentro según lo que soporte el
                // navegador. Con oem=1 (solo LSTM) son tres variantes —relaxedsimd, simd y sin
                // SIMD—; las legacy no se piden nunca y por eso no se sirven.
                // tests/tesseract-version.test.mjs comprueba que están y que su huella es la del
                // paquete oficial.
                // La versión va en la RUTA, no en un ?v=: `corePath` es un directorio al que la
                // librería le concatena el nombre del fichero, así que ahí no cabe una query. Y
                // con la versión en la carpeta, los cores (3,7 MB cada uno) se pueden servir como
                // inmutables sin miedo a caché vieja — subir de versión cambia la ruta entera.
                // Ver la regla de /js/tesseract/* en deploy/_headers.
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

                // Arranca con UN solo worker: el escaneo de rivens y la detección de contexto
                // corren secuenciales sobre workers[0], así que el 2º worker estándar solo pagaba
                // RAM (una instancia WASM) sin aportar nada hasta que el usuario escanea el grid de
                // inventario o recompensas. Se crea perezosamente con ensureSecondWorker(). Las
                // CANTIDADES ya no usan Tesseract (template-matching en utils/badge_digit_ocr.js),
                // por eso no hay workers de badges.
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

    // Crea el 2º worker estándar bajo demanda (paraleliza las 2 pasadas de recompensas y el
    // grid de inventario). Idempotente; memoiza la promesa para no crear dos en carrera.
    /**
     * Tope del pool. Cada worker es una instancia WASM con su copia del traineddata, y el escáner
     * ya es lo que más RAM consume de la app, así que no se escala sin límite.
     *
     * Dos y no cuatro: medido sobre una página de 18 celdas (Chromium, 8 núcleos), la fase de
     * celdas tarda 914 ms con 4 workers, 1003 con 2 y 1275 con 1. El ritmo lo marca el hilo
     * principal (recorte, binarizado, badges), no el OCR: el tercero y el cuarto ganan un 10 %
     * a cambio de dos instancias WASM más compitiendo con el juego por la CPU.
     */
    MAX_WORKERS: 2,

    /**
     * Crea workers hasta tener `n`. Se piden justo antes de repartir una rejilla: con dos, las 18
     * celdas del inventario se leen de nueve en nueve y se NOTA que van una a una.
     *
     * Los que falten se crean EN PARALELO: en serie, arrancar tres instancias WASM antes de la
     * primera lectura es exactamente la espera que se quiere quitar.
     */
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

    /** Compatibilidad: el escáner de rivens solo necesita un segundo worker. */
    async ensureSecondWorker() { return this.ensureWorkers(2); },

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
        this._workerPromises = null;
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

    /** Reconoce con OTRA lista de caracteres y deja el worker como estaba, igual que recognizeWithPSM. */
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
            // `output` (p.ej. { blocks: true }) pide a Tesseract las cajas por palabra/línea,
            // necesarias para separar dos cartas side-by-side por posición X.
            return await worker.recognize(image, options, output);
        } catch (e) {
            console.error("[OCR Repo] Recognize Err:", e);
            return { data: { text: "", confidence: 0 } };
        }
    }
};
