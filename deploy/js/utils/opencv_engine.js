import { OpenCVRepository } from "../repositories/opencv.repository.js";

export class OpenCVEngine {
    static isReady = false;
    static statusCallback = null;

    static waitReady(timeout = 30000) {
        return OpenCVRepository.waitReady(timeout).then(ready => {
            this.isReady = ready;
            if (ready) this.log("VISION ENGINE READY", "#2ecc71");
            return ready;
        });
    }

    static log(msg, color = "#f1c40f") {
        if (this.statusCallback) this.statusCallback(msg, color);
        console.log(`[OpenCV] ${msg}`);
    }

    static injectScript(url) {
        return OpenCVRepository.injectScript(url);
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
     * Nitidez/foco: varianza del Laplaciano. Alto = nítido, bajo = borroso/movido.
     * Barato (~ms). Sirve de gate para OCR en tiempo real: solo leer frames nítidos.
     */
    static sharpness(canvas) {
        if (!this.isReady || !canvas || canvas.width <= 0 || canvas.height <= 0) return 0;
        let src, gray, lap, mean, stddev;
        try {
            src = cv.imread(canvas);
            gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            lap = new cv.Mat();
            cv.Laplacian(gray, lap, cv.CV_64F);
            mean = new cv.Mat(); stddev = new cv.Mat();
            cv.meanStdDev(lap, mean, stddev);
            const sd = stddev.doubleAt(0, 0);
            return sd * sd; // varianza
        } catch (e) {
            return 0;
        } finally {
            if (src) src.delete();
            if (gray) gray.delete();
            if (lap) lap.delete();
            if (mean) mean.delete();
            if (stddev) stddev.delete();
        }
    }

    // Paleta de temas de Warframe (la que expone el live scanner; fallback embebido).
    static WF_PALETTE() {
        return globalThis._WF_THEMES || [
            { r: 232, g: 213, b: 93 }, { r: 245, g: 227, b: 173 }, { r: 255, g: 61, b: 51 },
            { r: 236, g: 211, b: 162 }, { r: 111, g: 229, b: 253 }, { r: 255, g: 115, b: 230 },
            { r: 255, g: 224, b: 153 }, { r: 255, g: 241, b: 191 }, { r: 245, g: 73, b: 93 },
            { r: 178, g: 125, b: 5 }, { r: 6, g: 106, b: 74 }, { r: 255, g: 255, b: 0 },
        ];
    }

    /**
     * Detecta el COLOR REAL del texto de acento en la imagen (como live scanner / inventario):
     * vota cada píxel brillante al tema WF más cercano y devuelve el PROMEDIO de los píxeles del
     * tema ganador. Eso capta el desvío de color de foto-a-pantalla (bloom, glow, balance de
     * blancos de la cámara). Devuelve [r,g,b] o null.
     */
    static detectAccentColor(canvas) {
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const themes = this.WF_PALETTE();
        const st = themes.map(() => ({ r: 0, g: 0, b: 0, n: 0, w: 0 }));
        for (let i = 0; i < data.length; i += 16) { // stride 4px
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (0.299 * r + 0.587 * g + 0.114 * b < 100) continue; // ignora fondo oscuro
            let bi = 0, bd = Infinity;
            for (let t = 0; t < themes.length; t++) {
                const th = themes[t];
                const d = Math.abs(r - th.r) + Math.abs(g - th.g) + Math.abs(b - th.b);
                if (d < bd) { bd = d; bi = t; }
            }
            const w = 1 / Math.pow(bd + 1, 2);
            st[bi].w += w; st[bi].r += r; st[bi].g += g; st[bi].b += b; st[bi].n++;
        }
        let bi = 0, bw = -1;
        for (let t = 0; t < themes.length; t++) if (st[t].w > bw) { bw = st[t].w; bi = t; }
        const s = st[bi];
        if (s.n < 4) return null;
        return [Math.round(s.r / s.n), Math.round(s.g / s.n), Math.round(s.b / s.n)];
    }

    /**
     * Binariza por CERCANÍA a un color RGB (texto negro / fondo blanco). tolSq = umbral de
     * distancia² en RGB (referencia live/inventario ≈ 1944). JS puro, no necesita OpenCV.
     */
    static binarizeNearColor(canvas, rgb, tolSq) {
        if (!canvas || !rgb) return;
        const ctx = canvas.getContext("2d");
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data, cr = rgb[0], cg = rgb[1], cb = rgb[2];
        for (let i = 0; i < d.length; i += 4) {
            const dr = d[i] - cr, dg = d[i + 1] - cg, db = d[i + 2] - cb;
            const v = (dr * dr + dg * dg + db * db) < tolSq ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(img, 0, 0);
    }

    /**
     * Binarización FIABLE para texto de recompensas: aísla el texto de acento del tema
     * (píxeles SATURADOS y BRILLANTES, cualquier tono) y descarta el fondo oscuro/desaturado
     * y los reflejos blancos (baja saturación). Theme-agnóstico (naranja, cian, verde…).
     * Devuelve texto negro sobre fondo blanco (lo que mejor lee Tesseract).
     */
    static isolateAccentText(canvas, settings = null) {
        if (!this.isReady || !canvas || canvas.width <= 0 || canvas.height <= 0) return;
        const s = settings || {};
        const satMin = s.satMin ?? 55, valMin = s.valMin ?? 110;
        let src, hsv, mask, low, high, k;
        try {
            src = cv.imread(canvas);
            hsv = new cv.Mat();
            cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
            cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
            mask = new cv.Mat();
            low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, satMin, valMin, 0]);
            high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 0]);
            cv.inRange(hsv, low, high, mask);            // texto = blanco
            k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
            cv.dilate(mask, mask, k);                    // engrosa trazos finos
            cv.bitwise_not(mask, mask);                  // -> texto negro / fondo blanco
            cv.imshow(canvas, mask);
        } catch (e) {
            console.error("isolateAccentText err:", e);
        } finally {
            if (src) src.delete();
            if (hsv) hsv.delete();
            if (mask) mask.delete();
            if (low) low.delete();
            if (high) high.delete();
            if (k) k.delete();
        }
    }

    /**
     * Nivel de reflejo (glare) 0..1: fracción de píxeles especulares (muy brillantes y poco
     * saturados). Alto = reflejo de pantalla que rompe el OCR -> conviene cambiar el ángulo.
     */
    static glareLevel(canvas) {
        if (!this.isReady || !canvas || canvas.width <= 0 || canvas.height <= 0) return 0;
        let src, hsv, mask, low, high;
        try {
            src = cv.imread(canvas);
            hsv = new cv.Mat();
            cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
            cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
            mask = new cv.Mat();
            low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, 245, 0]);
            high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 35, 255, 0]);
            cv.inRange(hsv, low, high, mask);
            const spec = cv.countNonZero(mask);
            return spec / (mask.rows * mask.cols);
        } catch (e) {
            return 0;
        } finally {
            if (src) src.delete();
            if (hsv) hsv.delete();
            if (mask) mask.delete();
            if (low) low.delete();
            if (high) high.delete();
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
