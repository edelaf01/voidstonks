export const OpenCVRepository = {
    DISABLE_OPENCV: false,
    isReady: false,
    initializationPromise: null,

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
                await this.injectScript(new URL("../opencv/4.5.4/opencv.js", import.meta.url).href);
            } catch (e) {
                   
                console.warn("[OpenCV] Script load failed; continuing without OpenCV.");
                return false;
            }

           
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
