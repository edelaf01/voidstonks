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

        this.applyClusteringThreshold(ctx, canvas.width, canvas.height);

        return { width, height, scale };
    },

    createFilteredOcrCanvas(snapshot, width, height, grid) {
        const cvs = document.createElement("canvas");
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, 0, 0);

        // Legacy Thresholding: Look for specific Bronze/Gold text color
        const refR = 215, refG = 165, refB = 95;
        const imgData = ctx.getImageData(0, 0, width, height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            const dist = Math.sqrt(Math.pow(r - refR, 2) + Math.pow(g - refG, 2) + Math.pow(b - refB, 2));

            if (dist < 90) {
                px[i] = px[i + 1] = px[i + 2] = 0; // Text -> Black
            } else {
                px[i] = px[i + 1] = px[i + 2] = 255; // Background -> White
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
        // Skip the far-left tick by shifting the crop X offset by ~10% of cell width
        const bdgOffsetX = Math.floor(grid.cellW * 0.10);
        const copyW = Math.floor(grid.cellW * 0.25) - bdgOffsetX;

        const badgeH = Math.floor(grid.cellH * 0.11);
        const BADGE_SCALE = 3;

        const tempCvs = document.createElement('canvas');
        tempCvs.width = copyW; tempCvs.height = badgeH;
        const tCtx = tempCvs.getContext('2d');
        tCtx.drawImage(snapshot, cell.sx + bdgOffsetX, cell.sy, copyW, badgeH, 0, 0, copyW, badgeH);

        // Simplified Clustering ported from scanner_vision.js
        this.applyClusteringToBadge(tCtx, copyW, badgeH);

        const badgeCvs = document.createElement('canvas');
        badgeCvs.width = copyW * BADGE_SCALE;
        badgeCvs.height = badgeH * BADGE_SCALE;
        const bCtx = badgeCvs.getContext('2d');
        bCtx.imageSmoothingEnabled = false;
        bCtx.drawImage(tempCvs, 0, 0, copyW, badgeH, 0, 0, badgeCvs.width, badgeCvs.height);
        return badgeCvs;
    },

    applyClusteringToBadge(ctx, w, h) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        const samples = [];
        for (let i = 0; i < px.length; i += 8) {
            samples.push([px[i], px[i + 1], px[i + 2]]);
        }
        let c1 = [0, 0, 0], c2 = [255, 255, 255], minLum = 255, maxLum = 0;
        for (let s of samples) {
            let l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
            if (l < minLum) { minLum = l; c1 = [...s]; }
            if (l > maxLum) { maxLum = l; c2 = [...s]; }
        }
        for (let iter = 0; iter < 4; iter++) {
            let s1 = [0, 0, 0], s2 = [0, 0, 0], n1 = 0, n2 = 0;
            for (let s of samples) {
                let d1 = Math.abs(s[0] - c1[0]) + Math.abs(s[1] - c1[1]) + Math.abs(s[2] - c1[2]);
                let d2 = Math.abs(s[0] - c2[0]) + Math.abs(s[1] - c2[1]) + Math.abs(s[2] - c2[2]);
                if (d1 < d2) { s1[0] += s[0]; s1[1] += s[1]; s1[2] += s[2]; n1++; }
                else { s2[0] += s[0]; s2[1] += s[1]; s2[2] += s[2]; n2++; }
            }
            if (n1 > 0) { c1[0] = s1[0] / n1; c1[1] = s1[1] / n1; c1[2] = s1[2] / n1; }
            if (n2 > 0) { c2[0] = s2[0] / n2; c2[1] = s2[1] / n2; c2[2] = s2[2] / n2; }
        }
        let l1 = 0.299 * c1[0] + 0.587 * c1[1] + 0.114 * c1[2], l2 = 0.299 * c2[0] + 0.587 * c2[1] + 0.114 * c2[2];
        let textC = l2 > l1 ? c2 : c1, bgC = l2 > l1 ? c1 : c2;
        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            let dT = Math.abs(r - textC[0]) + Math.abs(g - textC[1]) + Math.abs(b - textC[2]);
            let dB = Math.abs(r - bgC[0]) + Math.abs(g - bgC[1]) + Math.abs(b - bgC[2]);
            px[i] = px[i + 1] = px[i + 2] = (dT < dB * 1.5) ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    applyClusteringThreshold(ctx, w, h) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        const samples = [];
        for (let i = 0; i < px.length; i += 32) {
            samples.push([px[i], px[i + 1], px[i + 2]]);
        }
        let c1 = [0, 0, 0], c2 = [255, 255, 255], minL = 255, maxL = 0;
        for (const s of samples) {
            let l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
            if (l < minL) { minL = l; c1 = [...s]; }
            if (l > maxL) { maxL = l; c2 = [...s]; }
        }
        for (let iter = 0; iter < 4; iter++) {
            let s1 = [0, 0, 0], s2 = [0, 0, 0], n1 = 0, n2 = 0;
            for (const s of samples) {
                let d1 = Math.abs(s[0] - c1[0]) + Math.abs(s[1] - c1[1]) + Math.abs(s[2] - c1[2]);
                let d2 = Math.abs(s[0] - c2[0]) + Math.abs(s[1] - c2[1]) + Math.abs(s[2] - c2[2]);
                if (d1 < d2) { s1[0] += s[0]; s1[1] += s[1]; s1[2] += s[2]; n1++; }
                else { s2[0] += s[0]; s2[1] += s[1]; s2[2] += s[2]; n2++; }
            }
            if (n1 > 0) { c1[0] = s1[0] / n1; c1[1] = s1[1] / n1; c1[2] = s1[2] / n1; }
            if (n2 > 0) { c2[0] = s2[0] / n2; c2[1] = s2[1] / n2; c2[2] = s2[2] / n2; }
        }
        let l1 = 0.299 * c1[0] + 0.587 * c1[1] + 0.114 * c1[2], l2 = 0.299 * c2[0] + 0.587 * c2[1] + 0.114 * c2[2];
        let textC = l2 > l1 ? c2 : c1, bgC = l2 > l1 ? c1 : c2;
        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            let dT = Math.abs(r - textC[0]) + Math.abs(g - textC[1]) + Math.abs(b - textC[2]);
            let dB = Math.abs(r - bgC[0]) + Math.abs(g - bgC[1]) + Math.abs(b - bgC[2]);
            px[i] = px[i + 1] = px[i + 2] = (dT < dB * 1.2) ? 0 : 255;
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

        ctx.filter = "grayscale(100%) contrast(300%) brightness(1.2)";
        ctx.drawImage(video, 0, rCropY, width, rCropH, 0, 0, targetW, targetH);
        ctx.filter = "none";

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
