import { OpenCVRepository } from "../repositories/opencv.repository.js";

/**
 * Service for vision logic.
 */
export const VisionService = {
    //This should temp fix the mobile memory leak TODO BETTER FIX IF POSSIBLE
    _sharedCvs: document.createElement("canvas"),
    /**
     * Generates a simple hash of a frame to detect stability.
     */
    getFrameHash(ctx, w, h) {
        const data = ctx.getImageData(0, 0, w, h).data;
        let hash = 0;
        const step = Math.floor(data.length / 64) || 4;
        for (let i = 0; i < data.length; i += step) {
            hash += data[i];
        }
        return hash;
    },

    /**
     * Detects if a checkmark (tick) exists in a specific region.
     */
    detectCheckmark(snapshot, x, y, w, h) {
        const cvs = this._sharedCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true }); ctx.drawImage(snapshot, x, y, w, h, 0, 0, w, h);

        const data = ctx.getImageData(0, 0, w, h).data;
        let brightnessSum = 0;
        for (let i = 0; i < data.length; i += 4) {
            brightnessSum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avgBrightness = brightnessSum / (data.length / 4);
        let highPoints = 0;
        for (let i = 0; i < data.length; i += 4) {
            let l = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (l > avgBrightness * 1.8 && l > 100) highPoints++;
        }
        return highPoints > (w * h * 0.05);
    },

    /**
     * Uses OpenCV to find text rows in a canvas.
     */
    async findTextRows(canvas) {
        const ready = await OpenCVRepository.waitReady();
        if (!ready) return [];

        return OpenCVRepository.run((cv) => {
            const rects = [];
            let src = cv.imread(canvas);
            let gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            let binary = new cv.Mat();
            cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 10);

            let morph = new cv.Mat();
            let k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 3));
            cv.dilate(binary, morph, k);
            k.delete();

            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            for (let i = 0; i < contours.size(); i++) {
                let r = cv.boundingRect(contours.get(i));
                if (r.width > canvas.width * 0.3 && r.height > 15 && r.height < 150) {
                    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
                }
            }

            // Cleanup
            src.delete(); gray.delete(); binary.delete(); morph.delete(); contours.delete(); hierarchy.delete();

            return rects.sort((a, b) => a.y - b.y);
        }) || [];
    },
    /**
     * Prepares a virtual canvas for OCR from a video frame.
     */
    prepareVirtualCanvas(video, canvas) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = 1080 / height;
        const hCropH = Math.floor(height * 0.15);

        canvas.width = Math.floor(width * scale);
        canvas.height = Math.floor(hCropH * scale);

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, width, hCropH, 0, 0, canvas.width, canvas.height);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imgData.data;

        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            let luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
            let isOrange = (r > 140 && g > 70 && b < 100 && r > b + 40);
            let isWhiteText = (luma > 160 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30);

            if (isOrange || isWhiteText) {
                px[i] = px[i + 1] = px[i + 2] = 255;
            } else {
                px[i] = px[i + 1] = px[i + 2] = 0;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return { width, height, scale };
    },

    createFilteredOcrCanvas(snapshot, width, height, grid) {
        const cvs = document.createElement("canvas");
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, 0, 0);

        const imgData = ctx.getImageData(0, 0, width, height);
        const px = imgData.data;
        const refR = 215, refG = 165, refB = 95;
        const tolSq = 90 * 90;

        for (let i = 0; i < px.length; i += 4) {
            let dr = px[i] - refR, dg = px[i + 1] - refG, db = px[i + 2] - refB;
            if ((dr * dr + dg * dg + db * db) < tolSq) {
                px[i] = px[i + 1] = px[i + 2] = 0;
            } else {
                px[i] = px[i + 1] = px[i + 2] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

    createTextCanvas(ocrCanvas, cell, grid) {
        const TEXT_SCALE = 3;
        const textSrcY = Math.floor(grid.cellH * 0.5);
        const textSrcH = grid.cellH - textSrcY;
        const textCvs = document.createElement('canvas');
        textCvs.width = grid.cellW * TEXT_SCALE;
        textCvs.height = textSrcH * TEXT_SCALE;
        const tCtx = textCvs.getContext('2d');
        tCtx.imageSmoothingEnabled = false;
        tCtx.drawImage(ocrCanvas, cell.sx, cell.sy + textSrcY, grid.cellW, textSrcH, 0, 0, textCvs.width, textCvs.height);
        return textCvs;
    },

    createBadgeCanvas(snapshot, cell, grid) {
        const badgeW = Math.floor(grid.cellW * 0.35);
        const badgeH = Math.floor(grid.cellH * 0.2);
        const BADGE_SCALE = 3;

        const tempCvs = document.createElement('canvas');
        tempCvs.width = badgeW; tempCvs.height = badgeH;
        const tCtx = tempCvs.getContext('2d');
        tCtx.drawImage(snapshot, cell.sx, cell.sy, badgeW, badgeH, 0, 0, badgeW, badgeH);

        // Simplified Clustering ported from scanner_vision.js
        this.applyClusteringToBadge(tCtx, badgeW, badgeH);

        const badgeCvs = document.createElement('canvas');
        badgeCvs.width = badgeW * BADGE_SCALE;
        badgeCvs.height = badgeH * BADGE_SCALE;
        const bCtx = badgeCvs.getContext('2d');
        bCtx.imageSmoothingEnabled = false;
        bCtx.drawImage(tempCvs, 0, 0, badgeW, badgeH, 0, 0, badgeCvs.width, badgeCvs.height);
        return badgeCvs;
    },

    applyClusteringToBadge(ctx, w, h) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        // Logic similar to scanner_vision.js:createBadgeCanvas (K-means)
        // I'll use a slightly simplified version for brevity in first pass
        for (let i = 0; i < px.length; i += 4) {
            let luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            px[i] = px[i + 1] = px[i + 2] = (luma > 150) ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    /**
     * Prepares canvas for relic selection detection (Right side of screen).
     */
    prepareRelicSelectionCanvas(video, scale) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const rsCropX = Math.floor(width * 0.5);
        const rsCropY = Math.floor(height * 0.2);
        const rsCropW = Math.floor(width * 0.5);
        const rsCropH = Math.floor(height * 0.25);

        const cvs = document.createElement("canvas");
        cvs.width = Math.floor(rsCropW * scale * 0.75);
        cvs.height = Math.floor(rsCropH * scale * 0.75);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.filter = "grayscale(100%) brightness(1.2) contrast(300%)";
        ctx.drawImage(video, rsCropX, rsCropY, rsCropW, rsCropH, 0, 0, cvs.width, cvs.height);
        return cvs;
    },

    /**
     * Prepares canvas for reward detection.
     */
    prepareRewardOCRCanvas(video, width, height, scale) {
        const rCropY = Math.floor(height * 0.18);
        const rCropH = Math.floor(height * 0.5);
        const targetW = Math.floor(width * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = document.createElement("canvas");
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, rCropY, width, rCropH, 0, 0, targetW, targetH);
        return cvs;
    },

    /**
     * Determines the UI context from OCR'd header text.
     */
    determineContext(headerText) {
        const text = headerText.toUpperCase();
        if (/INVEN|TORY|SELL/.test(text)) return "INVENTORY";
        if (/RELI|ELIC/.test(text) || /REFI|NEME/.test(text)) return "RELICS";
        if (/REWA|WARD|FISSU|FISSI|VOID/.test(text)) return "REWARD";
        return "UNKNOWN";
    }
};
