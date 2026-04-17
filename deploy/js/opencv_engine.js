export class OpenCVEngine {
    static isReady = false;
    static statusCallback = null;

    static waitReady(timeout = 30000) {
        if (this.isReady) return Promise.resolve(true);
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = new Promise((resolve) => {
            const check = () => {
                if (globalThis.cv?.getBuildInformation) {
                    this.isReady = true;
                    this.initializationPromise = null;
                    this.log("VISION ENGINE READY", "#2ecc71");
                    resolve(true);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
            this.injectScript("https://docs.opencv.org/4.5.4/opencv.js");
        });

        const timeoutPromise = new Promise(r => setTimeout(() => r(false), timeout));
        return Promise.race([this.initializationPromise, timeoutPromise]);
    }

    static log(msg, color = "#f1c40f") {
        if (this.statusCallback) this.statusCallback(msg, color);
        console.log(`[OpenCV] ${msg}`);
    }

    static injectScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = url; script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Fail"));
            document.head.appendChild(script);
        });
    }

    /**
     * Si conocemos el color del texto (ej: dorado de PRIME), aislamos ese rango en HSV
     * antes de binarizar. Esto destruye fondos complejos del mismo brillo pero distinto tono.
     */
    static processForOCR(canvas, mode = "hard", targetColor = null, settings = null) {
        if (!this.isReady || !canvas || canvas.width <= 0 || canvas.height <= 0) return;

        const s = settings || { thresholdC: -15, claheClip: 2, hsvHueTol: 25, bilateralD: 5, dilation: 0, erosion: 0, blockSize: 31, sigmaColor: 75, sigmaSpace: 75 };
        let src, hsv, mask, dst, low, high, clahe;
        try {
            src = cv.imread(canvas);
            hsv = new cv.Mat(); mask = new cv.Mat(); dst = new cv.Mat();

            if (targetColor && targetColor[2] > 50) {
                cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
                cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
                let lowH = Math.max(0, targetColor[0] - s.hsvHueTol);
                let highH = Math.min(180, targetColor[0] + s.hsvHueTol);
                low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lowH, 30, 30, 0]);
                high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [highH, 255, 255, 0]);
                cv.inRange(hsv, low, high, mask);
                src.copyTo(dst, mask);
            } else {
                src.copyTo(dst);
            }

            cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
            if (dst.empty()) return;

            let tmp = new cv.Mat();
            cv.bilateralFilter(dst, tmp, s.bilateralD, s.sigmaColor || 75, s.sigmaSpace || 75);
            tmp.copyTo(dst);
            tmp.delete();

            clahe = new cv.CLAHE(s.claheClip, new cv.Size(8, 8)); clahe.apply(dst, dst);

            const threshC = (mode === "hard") ? s.thresholdC : (mode === "soft") ? Math.floor(s.thresholdC / 2) : 0;
            const bSize = s.blockSize || 31;
            if (threshC !== 0) {
                cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bSize, threshC);
            } else {
                cv.threshold(dst, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            }

            if (dst.empty()) return;

            let whitePixels = cv.countNonZero(dst);
            if (whitePixels < (dst.rows * dst.cols) / 2) {
                cv.bitwise_not(dst, dst);
            }

            if (s.dilation > 0) {
                let M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(s.dilation, s.dilation));
                cv.dilate(dst, dst, M);
                M.delete();
            }

            if (s.medianBlur > 0) {
                let ksize = Math.max(1, s.medianBlur);
                if (ksize % 2 === 0) ksize += 1;
                cv.medianBlur(dst, dst, ksize);
            }

            if (s.erosion > 0) {
                let M = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(s.erosion, s.erosion));
                cv.erode(dst, dst, M);
                M.delete();
            }

            if (s.contrast !== 1.0 || s.brightness !== 0) {
                dst.convertTo(dst, -1, s.contrast || 1.0, s.brightness || 0);
            }

            if (s.sharpen > 0) {
                let kernel = cv.matFromArray(3, 3, cv.CV_32F, [
                    -1, -1, -1,
                    -1, 9, -1,
                    -1, -1, -1
                ]);
                cv.filter2D(dst, dst, -1, kernel);
                kernel.delete();
            }


            cv.imshow(canvas, dst);

            if (s.showROI && canvas.id === "debug-live-preview") {
                const boxes = this.findTextRows(canvas);
                let ctx = canvas.getContext("2d");
                ctx.strokeStyle = "#00ff78";
                ctx.lineWidth = 2;
                boxes.forEach(r => {
                    ctx.strokeRect(r.x, r.y, r.width, r.height);
                    ctx.fillStyle = "rgba(0, 255, 120, 0.1)";
                    ctx.fillRect(r.x, r.y, r.width, r.height);
                });
            }
        } catch (e) {
            let msg = e;
            if (typeof e === 'number' && cv.exceptionFromPtr) {
                try { msg = cv.exceptionFromPtr(e).msg; } catch (ex) { msg = `C++ Err (ptr: ${e})`; }
            }
            console.error("OpenCV Process Err:", msg);
        } finally {
            if (src) src.delete();
            if (hsv) hsv.delete();
            if (mask) mask.delete();
            if (dst) dst.delete();
            if (low) low.delete();
            if (high) high.delete();
            if (clahe) clahe.delete();
        }
    }

    /**
     * Muestrea el color promedio (HSV) de los píxeles brillantes en un área con texto fiable.
     */
    static sampleTextColor(canvas, x0, y0, x1, y1) {
        if (!this.isReady) return null;
        let src, crop, hsv, mask, low, high;
        try {
            src = cv.imread(canvas);
            let rect = new cv.Rect(Math.max(0, x0), Math.max(0, y0), Math.min(src.cols - x0, x1 - x0), Math.min(src.rows - y0, y1 - y0));
            if (rect.width <= 0 || rect.height <= 0) return null;

            crop = src.roi(rect);
            hsv = new cv.Mat();
            cv.cvtColor(crop, hsv, cv.COLOR_RGBA2RGB);
            cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

            mask = new cv.Mat();
            low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, 180, 0]);
            high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 0]);
            cv.inRange(hsv, low, high, mask);

            let mean = cv.mean(hsv, mask);
            let result = [Math.floor(mean[0]), Math.floor(mean[1]), Math.floor(mean[2])];
            return result[2] > 100 ? result : null;
        } catch (e) {
            console.error("OpenCV Sample Err:", e); return null;
        } finally {
            if (src) src.delete();
            if (crop) crop.delete();
            if (hsv) hsv.delete();
            if (mask) mask.delete();
            if (low) low.delete();
            if (high) high.delete();
        }
    }

    /**
     *  Detecta filas de texto horizontalmente para colaboración ROI.
     * Devuelve un array de Rects donde se concentra el texto.
     */
    static findTextRows(canvas) {
        if (!this.isReady) return [];
        let src, gray, binary, morph, contours, hierarchy;
        const rects = [];
        try {
            src = cv.imread(canvas);
            gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            binary = new cv.Mat();
            cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 10);

            // Dilatación horizontal para unir palabras en líneas
            morph = new cv.Mat();
            let k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 3));
            cv.dilate(binary, morph, k);
            k.delete();

            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            for (let i = 0; i < contours.size(); i++) {
                let r = cv.boundingRect(contours.get(i));
                if (r.width > canvas.width * 0.3 && r.height > 15 && r.height < 150) {
                    rects.push(r);
                }
            }

            rects.sort((a, b) => a.y - b.y);

        } catch (e) {
            console.error("OpenCV ROW DETECT ERR:", e);
        } finally {
            if (src) src.delete();
            if (gray) gray.delete();
            if (binary) binary.delete();
            if (morph) morph.delete();
            if (contours) contours.delete();
            if (hierarchy) hierarchy.delete();
        }
        return rects;
    }

    /**
     * Encuentra 1-4 recompensas dinámicamente mediante clustering vertical .
     */
    static findTextROIs(canvas) {
        if (!OpenCVEngine.isReady) return [];
        let src = cv.imread(canvas);
        let srcSmall = new cv.Mat();
        let dsize = new cv.Size(640, Math.floor(src.rows * (640 / src.cols)));
        cv.resize(src, srcSmall, dsize, 0, 0, cv.INTER_AREA);

        let gray = new cv.Mat(); cv.cvtColor(srcSmall, gray, cv.COLOR_RGBA2GRAY);
        let binary = new cv.Mat();
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 5);
        let mClose = new cv.Mat();
        let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(40, 100));
        cv.morphologyEx(binary, mClose, cv.MORPH_CLOSE, kernel);

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(mClose, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let finalROIs = [];
        const scale = src.cols / 640;

        for (let i = 0; i < contours.size(); ++i) {
            let rect = cv.boundingRect(contours.get(i));
            if (rect.width > 30 && rect.height > 40) {
                finalROIs.push({
                    x: Math.floor(rect.x * scale),
                    y: Math.max(0, Math.floor((rect.y - 10) * scale)),
                    w: Math.floor(rect.width * scale),
                    h: Math.floor((rect.height + 20) * scale)
                });
            }
        }

        src.delete(); srcSmall.delete(); gray.delete(); binary.delete(); mClose.delete(); contours.delete(); hierarchy.delete(); kernel.delete();

        return finalROIs.sort((a, b) => a.x - b.x);
    }
}