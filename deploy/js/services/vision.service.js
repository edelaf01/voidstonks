import { OpenCVRepository } from "../repositories/opencv.repository.js";



/**
 * Known Warframe UI theme text colors (Secondary highlight colors used for item names).
 * Values perfectly mirror WFInfo's ThemeSecondary.
 * Each entry: { name, r, g, b, tol } — used for theme detection and RGB Euclidean thresholding.
 */
export const WF_THEMES = [
    { name: "Legacy", r: 232, g: 213, b: 93 },
    { name: "Vitruvian", r: 245, g: 227, b: 173 },
    { name: "Stalker", r: 255, g: 61, b: 51 },
    { name: "Baruuk", r: 236, g: 211, b: 162 },
    { name: "Corpus", r: 111, g: 229, b: 253 },
    { name: "Fortuna", r: 255, g: 115, b: 230 },
    { name: "Grineer", r: 255, g: 224, b: 153 },
    { name: "Lotus", r: 255, g: 241, b: 191 },
    { name: "Nidus", r: 245, g: 73, b: 93 },
    { name: "Orokin", r: 178, g: 125, b: 5 },
    { name: "Tenno", r: 6, g: 106, b: 74 },
    { name: "High Contrast", r: 255, g: 255, b: 0 },
];

// 10% of max Euclidean distance (sqrt(3)*255 ≈ 441): (441*0.10)^2 ≈ 1944
// This accounts for JPEG compression and anti-aliasing on real screenshots.
const THEME_TOL_SQ = 1944;

/**
 * Service for vision logic.
 */
export const VisionService = {
    // Shared canvases 
    _sharedCvs: document.createElement("canvas"),
    _themeCvs: document.createElement("canvas"),
    _filterCvs: document.createElement("canvas"),
    _textCvs: document.createElement("canvas"),
    _tempBadgeCvs: document.createElement("canvas"),
    _badgeCvs: document.createElement("canvas"),
    _relicSelectionCvs: document.createElement("canvas"),
    _rewardCvs: document.createElement("canvas"),
    _inventoryCvs: document.createElement("canvas"),
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
        cvs.width = w;
        cvs.height = h;
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

    /**
     * Detects the active Warframe UI theme by sampling a region of the snapshot.
     * Uses a weighted voting system: it finds the closest theme for each pixel,
     * and adds a weight of 1 / (distance + 1)^4. This ensures that a few exact
     * text pixels (distance ~0) vastly outweigh a large background of slightly
     * mismatched color (e.g. red lighting), preventing false "Stalker" detection.
     */
    detectThemeFromSnapshot(snapshot, sampleX, sampleY, sampleW, sampleH) {
        const cvs = this._themeCvs;
        cvs.width = sampleW; cvs.height = sampleH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, sampleX, sampleY, sampleW, sampleH, 0, 0, sampleW, sampleH);

        const px = ctx.getImageData(0, 0, sampleW, sampleH).data;

        // Group pixels by their closest theme to find the winning theme AND
        // to compute the average dynamic RGB of the actual text on screen.
        const themeStats = new Array(WF_THEMES.length).fill(0).map(() => ({ rSum: 0, gSum: 0, bSum: 0, count: 0, weight: 0 }));

        for (let i = 0; i < px.length; i += 16) { // stride of 4 pixels for speed
            const r = px[i], g = px[i + 1], b = px[i + 2];

            // Text is extremely bright. Ignore dark background pixels
            // entirely so ambient lighting doesn't skew detection.
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luma < 100) continue;

            // For each bright pixel, find the closest theme by Manhattan distance
            let bestThemeIdx = 0;
            let bestDist = Infinity;

            for (let t = 0; t < WF_THEMES.length; t++) {
                const theme = WF_THEMES[t];
                const dist = Math.abs(r - theme.r) + Math.abs(g - theme.g) + Math.abs(b - theme.b);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestThemeIdx = t;
                }
            }

            // Exact matches get weight 1.0, distance 10 gets 0.00006
            const w = 1 / Math.pow(bestDist + 1, 4);
            themeStats[bestThemeIdx].weight += w;
            themeStats[bestThemeIdx].rSum += r;
            themeStats[bestThemeIdx].gSum += g;
            themeStats[bestThemeIdx].bSum += b;
            themeStats[bestThemeIdx].count += 1;
        }

        let maxWeight = -1;
        let bestThemeIdx = 0;
        for (let t = 0; t < WF_THEMES.length; t++) {
            if (themeStats[t].weight > maxWeight) {
                maxWeight = themeStats[t].weight;
                bestThemeIdx = t;
            }
        }

        const bestTheme = WF_THEMES[bestThemeIdx];

        console.log(`[VisionService] Theme detected: ${bestTheme.name} (weight: ${maxWeight.toFixed(4)})`);

        return {
            name: bestTheme.name,
            r: bestTheme.r,
            g: bestTheme.g,
            b: bestTheme.b,
            tol: bestTheme.tol
        };
    },

    /**
     * Creates a binarized OCR canvas for inventory scanning.
     * Uses grayscale+high contrast then inverts: bright text -> black, dark background -> white.
     */
    createFilteredOcrCanvas(snapshot, width, height, grid) {
        const cvs = this._filterCvs;
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        ctx.filter = "grayscale(100%) contrast(400%) brightness(1.3)";
        ctx.drawImage(snapshot, 0, 0);
        ctx.filter = "none";

        // Invert: bright=text -> black(0), dark=background -> white(255)
        const imgData = ctx.getImageData(0, 0, width, height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const v = px[i] > 128 ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

    /** Draws inventory area (original colors) and returns theme pixel mask + source canvas. */
    buildThemeMask(video, width, height, scale) {
        const cropY = Math.floor(height * 0.12);
        const cropH = Math.floor(height * 0.78);
        const cropW = Math.floor(width * 0.74);
        const targetW = Math.floor(cropW * scale);
        const targetH = Math.floor(cropH * scale);

        const cvs = this._inventoryCvs;
        cvs.width = targetW; cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, cropY, cropW, cropH, 0, 0, targetW, targetH);

        const { data: px } = ctx.getImageData(0, 0, targetW, targetH);
        const mask = new Uint8Array(targetW * targetH);
        for (let i = 0; i < mask.length; i++) {
            const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
            for (const t of WF_THEMES) {
                const dr = r - t.r, dg = g - t.g, db = b - t.b;
                if (dr * dr + dg * dg + db * db < THEME_TOL_SQ) { mask[i] = 1; break; }
            }
        }
        return { sourceCvs: cvs, mask, maskW: targetW, maskH: targetH };
    },

    /** Find rows/cols of inventory items from theme pixel density projections. */
    detectInventoryGrid(mask, maskW, maskH) {
        // Vertical projection
        const rowDensity = new Float32Array(maskH);
        for (let y = 0; y < maskH; y++)
            for (let x = 0; x < maskW; x++) rowDensity[y] += mask[y * maskW + x];

        const rowMax = Math.max(...rowDensity);
        if (rowMax < 10) return null;

        // adaptive minDist based on expected minimum cell sizes (at least 1/12th of screen)
        const rowMinDist = Math.floor(maskH / 12);
        const rowPeaks = this._findPeaks(rowDensity, rowMinDist, rowMax * 0.25);
        if (!rowPeaks.length) return null;

        // Horizontal projection around row peaks to reduce noise
        const colDensity = new Float32Array(maskW);
        for (const rp of rowPeaks) {
            for (let y = Math.max(0, rp - 20); y <= Math.min(maskH - 1, rp + 20); y++)
                for (let x = 0; x < maskW; x++) colDensity[x] += mask[y * maskW + x];
        }
        const colMax = Math.max(...colDensity);
        if (colMax < 2) return null;

        const colMinDist = Math.floor(maskW / 12);
        const colPeaks = this._findPeaks(colDensity, colMinDist, colMax * 0.20);
        if (!colPeaks.length) return null;

        const avgSpacing = (arr) => arr.length < 2 ? null :
            arr.slice(1).reduce((s, v, i) => s + v - arr[i], 0) / (arr.length - 1);

        const cellH = avgSpacing(rowPeaks) ?? maskH / 4;
        const cellW = avgSpacing(colPeaks) ?? maskW / 6;

        return { rowPeaks, colPeaks, cellW: Math.round(cellW), cellH: Math.round(cellH) };
    },

    _findPeaks(density, minDist, threshold) {
        // 1. Smooth density with moving average to merge letters into single blocks
        const smoothDist = Math.floor(minDist / 2);
        const smoothed = new Float32Array(density.length);
        for (let i = 0; i < density.length; i++) {
            let sum = 0, count = 0;
            for (let j = Math.max(0, i - smoothDist); j <= Math.min(density.length - 1, i + smoothDist); j++) {
                sum += density[j];
                count++;
            }
            smoothed[i] = sum / count;
        }

        // 2. Find local maxima with minimum distance constraint
        const peaks = [];
        let last = -minDist;
        for (let i = 1; i < smoothed.length - 1; i++) {
            if (smoothed[i] >= threshold && smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
                if (i - last >= minDist) {
                    peaks.push(i);
                    last = i;
                } else if (smoothed[i] > smoothed[last]) {
                    // Better peak found within minDist, replace the previous one
                    peaks[peaks.length - 1] = i;
                    last = i;
                }
            }
        }
        return peaks;
    },

    /** Crop region from source canvas, apply theme binarization, scale 2x for OCR. */
    cropThemeBinarized(sourceCvs, sx, sy, sw, sh) {
        const S = 2;
        const cvs = this._textCvs;
        cvs.width = sw * S; cvs.height = sh * S;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            let isText = false;
            for (const t of WF_THEMES) {
                const dr = r - t.r, dg = g - t.g, db = b - t.b;
                if (dr * dr + dg * dg + db * db < THEME_TOL_SQ) { isText = true; break; }
            }
            px[i] = px[i + 1] = px[i + 2] = isText ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

    /** Crop badge region, apply grayscale+contrast+inversion, scale 3x for digit OCR. */
    cropBadgeBinarized(sourceCvs, sx, sy, sw, sh) {
        const S = 3;
        const cvs = this._badgeCvs;
        cvs.width = sw * S; cvs.height = sh * S;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.filter = "grayscale(100%) contrast(500%) brightness(1.5)";
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        ctx.filter = "none";
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const v = px[i] > 128 ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

    createTextCanvas(ocrCanvas, cell, grid) {
        const TEXT_SCALE = 3;
        const textSrcY = Math.floor(grid.cellH * 0.35);
        const textSrcH = grid.cellH - textSrcY;
        const textCvs = this._textCvs;
        textCvs.width = grid.cellW * TEXT_SCALE;
        textCvs.height = textSrcH * TEXT_SCALE;
        const tCtx = textCvs.getContext('2d');
        tCtx.imageSmoothingEnabled = false;
        tCtx.drawImage(ocrCanvas, cell.sx, cell.sy + textSrcY, grid.cellW, textSrcH, 0, 0, textCvs.width, textCvs.height);
        return textCvs;
    },

    createBadgeCanvas(snapshot, cell, grid) {
        // Skip the far-left tick by shifting the crop X offset by 10% of cell width
        const bdgOffsetX = Math.floor(grid.cellW * 0.10);
        const copyW = Math.floor(grid.cellW * 0.25) - bdgOffsetX;

        const badgeH = Math.floor(grid.cellH * 0.11);
        const BADGE_SCALE = 3;

        const tempCvs = this._tempBadgeCvs;
        tempCvs.width = copyW; tempCvs.height = badgeH;
        const tCtx = tempCvs.getContext('2d');
        tCtx.drawImage(snapshot, cell.sx + bdgOffsetX, cell.sy, copyW, badgeH, 0, 0, copyW, badgeH);

        // Simplified Clustering ported from scanner_vision.js
        this.applyClusteringToBadge(tCtx, copyW, badgeH);

        const badgeCvs = this._badgeCvs;
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

        const cvs = this._relicSelectionCvs;
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

        const cvs = this._rewardCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        // Grayscale + high contrast to maximize text/background separation.
        // Multi-theme detection doesn't work here because reward text is white/cream,
        // not the specific golden theme colors.
        ctx.filter = "grayscale(100%) contrast(400%) brightness(1.3)";
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
        if (/RELI|ELIC|REFI|NEME/.test(text)) return "RELICS";
        if (/REWA|WARD|ARDS|FISSU|FISSI|FISR|VOID/.test(text)) return "REWARD";
        return "UNKNOWN";
    }
};
