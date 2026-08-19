/**
 * Repository for OpenCV.js library management and raw image processing.
 */
export const OpenCVRepository = {
    DISABLE_OPENCV: false,
    isReady: false,
    initializationPromise: null,

    /**
     * Injects OpenCV.js
     */
    async waitReady(timeout = 30000) {
        if (this.DISABLE_OPENCV) {
            console.warn("[OpenCV] OpenCV loading is disabled by code toggle.");
            return false;
        }

        if (this.isReady) return true;
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            const check = () => {
                if (globalThis.cv?.getBuildInformation) {
                    this.isReady = true;
                    return true;
                }
                return false;
            };

            if (check()) return true;

            try {
                await this.injectScript("https://docs.opencv.org/4.5.4/opencv.js");
            } catch (e) {
                console.warn("[OpenCV] Primary CDN failed, fallback to unpkg...");
                try {
                    await this.injectScript("https://unpkg.com/@techstark/opencv-js@4.5.4-beta.3/dist/opencv.js");
                } catch (e2) {
                    // Sin los dos CDN esto RECHAZABA, y quien llama espera un booleano: el escáner
                    // móvil lo captura en su try general y se cierra entero, saltándose su propio
                    // `if (!success) setVisionStatus("ERROR")`. Sin OpenCV se pierde el enfoque y
                    // el aviso de reflejo, pero la detección de color y la binarización son JS
                    // puro y siguen funcionando: se degrada, no se cae.
                    console.warn("[OpenCV] Fallback CDN failed too; continuing without OpenCV.");
                    return false;
                }
            }

            // El sondeo lleva su propia fecha límite. El Promise.race de abajo resuelve false al
            // vencer el timeout, pero eso NO paraba este intervalo: si OpenCV no llegaba (CDN
            // caído, wasm bloqueado), seguía despertando cada 100 ms el resto de la sesión.
            return new Promise((resolve) => {
                const fin = Date.now() + timeout;
                const interval = setInterval(() => {
                    if (check()) {
                        clearInterval(interval);
                        resolve(true);
                    } else if (Date.now() >= fin) {
                        clearInterval(interval);
                        resolve(false);
                    }
                }, 100);
            });
        })();

        const timeoutPromise = new Promise((r) => setTimeout(() => r(false), timeout));
        return Promise.race([this.initializationPromise, timeoutPromise]);
    },

    injectScript(url) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${url}"]`)) return resolve();
            const script = document.createElement("script");
            script.src = url; script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("OpenCV Script Load Fail"));
            document.head.appendChild(script);
        });
    },

    /**
     * Wrap raw OpenCV calls
     */
    run(fn) {
        if (!this.isReady || !globalThis.cv) return null;
        try {
            return fn(globalThis.cv);
        } catch (e) {
            let msg = e;
            if (typeof e === 'number' && cv.exceptionFromPtr) {
                try { msg = cv.exceptionFromPtr(e).msg; } catch (ex) { msg = `C++ Err (ptr: ${e})`; }
            }
            console.error("[OpenCV Repo] Run Err:", msg);
            return null;
        }
    }
};
