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

        // Crop strictly the top-left area (45% width, 12% height) where the screen title header
        // (e.g. "VOID FISSURE/REWARDS", "INVENTORY", "RELIC REFINEMENT") is always located.
        // This completely avoids the middle/right background graphic and sparks from skewing
        // the K-means clustering threshold, ensuring 100% stable context detection.
        const hCropW = Math.floor(width * 0.45);
        const hCropH = Math.floor(height * 0.12);

        canvas.width = Math.floor(hCropW * scale);
        canvas.height = Math.floor(hCropH * scale);

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, hCropW, hCropH, 0, 0, canvas.width, canvas.height);

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
        const bestStats = themeStats[bestThemeIdx];

        // Compute the ACTUAL average color of pixels that voted for this theme.
        // This accounts for bloom, glow, and JPEG compression — closer to the real on-screen color.
        const actualR = bestStats.count > 0 ? Math.round(bestStats.rSum / bestStats.count) : bestTheme.r;
        const actualG = bestStats.count > 0 ? Math.round(bestStats.gSum / bestStats.count) : bestTheme.g;
        const actualB = bestStats.count > 0 ? Math.round(bestStats.bSum / bestStats.count) : bestTheme.b;

        console.log(`[VisionService] Theme detected: ${bestTheme.name} (weight: ${maxWeight.toFixed(4)}, catalog: rgb(${bestTheme.r},${bestTheme.g},${bestTheme.b}), actual: rgb(${actualR},${actualG},${actualB}))`);

        return {
            name: bestTheme.name,
            r: bestTheme.r,
            g: bestTheme.g,
            b: bestTheme.b,
            actualR,
            actualG,
            actualB,
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

        // adaptive minDist based on expected minimum cell sizes (at least 1/6.5th of screen)
        // This prevents weapon details/decorations inside a card from creating duplicate row peaks.
        const rowMinDist = Math.floor(maskH / 6.5);
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

    cropThemeBinarized(sourceCvs, sx, sy, sw, sh, theme) {
        const S = 3;
        const cvs = document.createElement("canvas");
        cvs.width = sw * S; cvs.height = sh * S;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const px = imgData.data;

        const targetThemes = theme ? [theme, ...WF_THEMES] : WF_THEMES;
        // Relaxed tolerance (45px distance) to capture full, thick letter strokes including anti-aliasing
        const tolSq = theme ? 45 * 45 : 35 * 35;

        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let isText = false;

            for (const t of targetThemes) {
                const dr = r - t.r, dg = g - t.g, db = b - t.b;
                if (dr * dr + dg * dg + db * db < tolSq) {
                    isText = true;
                    break;
                }
                if (t.actualR !== undefined) {
                    const dar = r - t.actualR, dag = g - t.actualG, dab = b - t.actualB;
                    if (dar * dar + dag * dag + dab * dab < tolSq) {
                        isText = true;
                        break;
                    }
                }
            }

            // Universal fallback for solid white/light text across all themes
            if (luma > 180) {
                isText = true;
            }

            px[i] = px[i + 1] = px[i + 2] = isText ? 0 : 255;
        }

        // Apply an ultra-high-quality, morphological 3x3 cross binary dilation kernel
        // to fill in fine anti-aliasing line gaps while keeping inner loops of lowercase
        // letters (like 'e', 'a', 'o') perfectly hollow, open, and highly legible for Tesseract.
        const dilatedImgData = ctx.createImageData(cvs.width, cvs.height);
        const dPx = dilatedImgData.data;
        const w = cvs.width;
        const h = cvs.height;

        // Initialize output as all white (255)
        for (let i = 0; i < dPx.length; i += 4) {
            dPx[i] = dPx[i + 1] = dPx[i + 2] = 255;
            dPx[i + 3] = 255;
        }

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                if (px[idx] === 0) { // Black pixel found
                    dPx[idx] = dPx[idx + 1] = dPx[idx + 2] = 0; // Center
                    dPx[idx - 4] = dPx[idx - 3] = dPx[idx - 2] = 0; // Left
                    dPx[idx + 4] = dPx[idx + 5] = dPx[idx + 6] = 0; // Right
                    const topIdx = idx - w * 4;
                    dPx[topIdx] = dPx[topIdx + 1] = dPx[topIdx + 2] = 0; // Top
                    const botIdx = idx + w * 4;
                    dPx[botIdx] = dPx[botIdx + 1] = dPx[botIdx + 2] = 0; // Bottom
                }
            }
        }

        ctx.putImageData(dilatedImgData, 0, 0);
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
        // Crop starting higher up (22% of cell height) to perfectly capture 2-line item names,
        // and add 8% bottom padding to guarantee no letters on the bottom line are cut off.
        const textSrcY = Math.floor(grid.cellH * 0.22);
        const textSrcH = grid.cellH - textSrcY + Math.floor(grid.cellH * 0.08);
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
        const copyW = Math.floor(grid.cellW * 0.22);

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

    applyThemeToBadge(ctx, w, h, theme) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;

        const targetThemes = theme ? [theme] : WF_THEMES;
        const tolSq = theme ? 55 * 55 : 45 * 45;

        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let isBadge = false;

            for (const t of targetThemes) {
                const dr = r - t.r, dg = g - t.g, db = b - t.b;
                if (dr * dr + dg * dg + db * db < tolSq) {
                    isBadge = true;
                    break;
                }
                if (t.actualR !== undefined) {
                    const dar = r - t.actualR, dag = g - t.actualG, dab = b - t.actualB;
                    if (dar * dar + dag * dag + dab * dab < tolSq) {
                        isBadge = true;
                        break;
                    }
                }
            }

            if (luma > 165) {
                isBadge = true;
            }

            px[i] = px[i + 1] = px[i + 2] = isBadge ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    applyClusteringToBadge(ctx, w, h) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        
        let maxL = 0;
        for (let i = 0; i < px.length; i += 4) {
            const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (l > maxL) maxL = l;
        }
        
        // Dynamic adaptive threshold based on peak luminance (55% of maximum, minimum 50)
        const thresh = Math.max(50, maxL * 0.55);
        
        for (let i = 0; i < px.length; i += 4) {
            const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            px[i] = px[i + 1] = px[i + 2] = (l >= thresh) ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    applyClusteringThreshold(ctx, w, h, theme) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        const samples = [];
        for (let i = 0; i < px.length; i += 8) {
            samples.push([px[i], px[i + 1], px[i + 2]]);
        }
        let c1 = [0, 0, 0], c2 = theme ? [theme.r, theme.g, theme.b] : [255, 255, 255], minL = 255, maxL = 0;
        for (const s of samples) {
            let l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
            if (l < minL) { minL = l; c1 = [...s]; }
            if (!theme && l > maxL) { maxL = l; c2 = [...s]; }
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
    prepareRewardCanvas(snapshot, card, scale) {
        const cvs = this._rewardCvs;
        cvs.width = Math.floor(card.w * scale);
        cvs.height = Math.floor(card.h * scale);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, card.x, card.y, card.w, card.h, 0, 0, cvs.width, cvs.height);
        return cvs;
    },

    /**
     * Detects if a cell contains a valid reward.
     */
    detectReward(snapshot, card, scale) {
        const cvs = this.prepareRewardCanvas(snapshot, card, scale);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        const px = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
        let whitePixels = 0;
        for (let i = 0; i < px.length; i += 4) {
            const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
            if (l > 180) whitePixels++;
        }
        return whitePixels > (cvs.width * cvs.height * 0.02);
    },

    detectRewardTheme(snapshot, card, scale) {
        const cvs = this.prepareRewardCanvas(snapshot, card, scale);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        const text = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
        let maxL = 0;
        for (let i = 0; i < text.length; i += 4) {
            const l = (text[i] + text[i + 1] + text[i + 2]) / 3;
            if (l > maxL) maxL = l;
        }
        if (maxL < 100) return "UNKNOWN";
        if (maxL > 180) return "REWARD";
        return "UNKNOWN";
    },

    /**
     * Prepares canvas for reward detection.
     */
    prepareRewardOCRCanvas(video, width, height, scale) {
        // Crop strictly inside the clean dark translucent bounds of the reward cards (Y = 18.5% to 44%)
        // to completely eliminate the busy backgrounds and player names below the cards!
        const rCropY = Math.floor(height * 0.185);
        const rCropH = Math.floor(height * 0.255);
        const targetW = Math.floor(width * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = this._rewardCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        // Grayscale + high contrast to maximize text/background separation.
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
        // Extremely robust regex including common Tesseract/OCR garblings for FISSURE and VOID (e.g. F5UR, FI55, F1SS, V0ID)
        if (/REWA|WARD|ARDS|FISSU|FISSI|FISR|F5UR|FSUR|FI55|F1SS|FISS|FISU|VOID|V0ID|V01D/.test(text)) return "REWARD";
        return "UNKNOWN";
    },

    /**
     * Detects the inventory grid automatically from a calibrated zone.
     * Uses luminance-based bright-pixel mask since inventory item names are white/cream,
     * NOT the theme secondary color (which is only used in the relic reward screen).
     */
     buildAutoGrid(snapshot, gridZone, theme, calibData) {
        // If the user has manually edited the grid (or we have saved grid dimensions), respect it!
        if (calibData && calibData.cellW && calibData.cols && calibData.rows) {
            const cols = calibData.cols;
            const rows = calibData.rows;
            const cellW = calibData.cellW;
            const cellH = calibData.cellH;
            const gapX = calibData.gapX || 0;
            const gapY = calibData.gapY || 0;
            const gridX = calibData.gridX !== undefined ? calibData.gridX : gridZone.x;
            const gridY = calibData.gridY !== undefined ? calibData.gridY : gridZone.y;

            const cellRects = [];
            for (let ri = 0; ri < rows; ri++) {
                for (let ci = 0; ci < cols; ci++) {
                    const sx = Math.round(gridX + ci * (cellW + gapX));
                    const sy = Math.round(gridY + ri * (cellH + gapY));
                    const cx = sx + cellW / 2;
                    const cy = sy + cellH * 0.82;
                    cellRects.push({ r: ri, c: ci, sx, sy, cx, cy });
                }
            }
            console.log(`[buildAutoGrid] Snapped saved/edited grid layout: ${rows}r x ${cols}c, cellW=${cellW}, cellH=${cellH}`);
            return { cellRects, cellW, cellH, cols, rows };
        }

        const { x: zx, y: zy, w: zw, h: zh } = gridZone;

        // Since the Warframe inventory grid can show more columns on ultra-wide screens (e.g., 8 columns instead of 6),
        // we dynamically calculate the column count using the calibrated zone's aspect ratio.
        const rows = 3;
        const aspectRatio = zw / zh;
        let cols = Math.round(aspectRatio * rows);
        if (cols < 3) cols = 3;
        if (cols > 12) cols = 12;

        const finalCellW = Math.round(zw / cols);
        const finalCellH = Math.round(zh / rows);
        const cellRects = [];

        for (let ri = 0; ri < rows; ri++) {
            for (let ci = 0; ci < cols; ci++) {
                const sx = Math.round(zx + ci * finalCellW);
                const sy = Math.round(zy + ri * finalCellH);

                // We estimate the text center (cx, cy) in case any other function relies on it.
                const cx = sx + finalCellW / 2;
                const cy = sy + finalCellH * 0.82;

                cellRects.push({ r: ri, c: ci, sx, sy, cx, cy });
            }
        }

        console.log(`[buildAutoGrid] Snapped perfect ${rows}x${cols} grid to calibrated zone: cellW=${finalCellW}, cellH=${finalCellH}`);
        return { cellRects, cellW: finalCellW, cellH: finalCellH, cols, rows };
    },

    /**
     * Extracts the quantity badge from the top-left of an inventory cell.
     * Fully self-calibrating and dynamic. Immune to grid calibration offsets and theme variations.
     */
    extractBadgeByColor(snapshot, cell, cellW, cellH, theme) {
        // 1. Crop a very generous top-left area starting exactly at cell.sx (35% of cell width)
        const safeW = Math.round(cellW * 0.35);
        // Start crop higher to prevent clipping the top hook of 6 or top bar of 7 and 5
        const padTop = 12;
        const startY = Math.max(0, cell.sy - padTop);
        // Use a taller vertical search window to guarantee digit presence
        const safeH = Math.round(cellH * 0.25) + padTop;

        const tempCvs = document.createElement("canvas");
        tempCvs.width = safeW;
        tempCvs.height = safeH;
        const tCtx = tempCvs.getContext("2d", { willReadFrequently: true });
        tCtx.drawImage(snapshot, cell.sx, startY, safeW, safeH, 0, 0, safeW, safeH);

        // 2. Binarize using dynamic K-Means color clustering seeded by the exact detected theme
        this.applyClusteringThreshold(tCtx, safeW, safeH, theme);

        // 3. Find connected components on the binarized canvas
        const imgData = tCtx.getImageData(0, 0, safeW, safeH);
        const px = imgData.data;



        // BFS-based Connected Component Labeling
        const visited = new Uint8Array(safeW * safeH);
        const components = [];

        // Scan 100% of the cropped area to prevent any cutoffs
        const scanW = safeW;
        const scanH = safeH;

        for (let y = 0; y < scanH; y++) {
            for (let x = 0; x < scanW; x++) {
                const idx = y * safeW + x;
                // Black pixels are binarized text/digits
                if (px[idx * 4] === 0 && !visited[idx]) {
                    // Start BFS for new component
                    const compPixels = [];
                    const queue = [idx];
                    visited[idx] = 1;
                    let minX = x, maxX = x, minY = y, maxY = y;

                    while (queue.length > 0) {
                        const current = queue.shift();
                        compPixels.push(current);
                        const cx = current % safeW;
                        const cy = Math.floor(current / safeW);

                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;

                        // 8-connected neighbors using coordinates to prevent wrapping and digit splitting
                        const neighbors = [];
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                if (dx === 0 && dy === 0) continue;
                                const nx = cx + dx;
                                const ny = cy + dy;
                                if (nx >= 0 && nx < safeW && ny >= 0 && ny < safeH) {
                                    neighbors.push(ny * safeW + nx);
                                }
                            }
                        }

                        for (const n of neighbors) {
                            if (px[n * 4] === 0 && !visited[n]) {
                                visited[n] = 1;
                                queue.push(n);
                            }
                        }
                    }

                    // Ignore tiny noise (less than 3 pixels)
                    if (compPixels.length >= 3) {
                        components.push({
                            pixels: compPixels,
                            minX,
                            maxX,
                            minY,
                            maxY,
                            width: maxX - minX + 1,
                            height: maxY - minY + 1
                        });
                    }
                }
            }
        }

        // If no components found, return null
        if (components.length === 0) {
            return null;
        }

        // Erase horizontal border lines (the selection box border) to break merge bridges
        for (const comp of components) {
            if (comp.width > 18 && comp.height <= 3) {
                for (const pixelIdx of comp.pixels) {
                    px[pixelIdx * 4] = 255;
                    px[pixelIdx * 4 + 1] = 255;
                    px[pixelIdx * 4 + 2] = 255;
                }
                comp.erased = true;
            }
        }

        // Filter out components that are clearly too low in the crop box.
        // The quantity badge numbers always start at the very top.
        // Find the global top baseline.
        let globalMinY = safeH;
        for (const comp of components) {
            if (!comp.erased && comp.pixels.length >= 8 && comp.minY < globalMinY) {
                globalMinY = comp.minY;
            }
        }

        // Anything starting 16px below the top baseline is a crafting icon or background detail.
        for (const comp of components) {
            if (comp.minY > globalMinY + 16) {
                for (const pixelIdx of comp.pixels) {
                    px[pixelIdx * 4] = 255;
                    px[pixelIdx * 4 + 1] = 255;
                    px[pixelIdx * 4 + 2] = 255;
                }
                comp.erased = true;
            }
        }

        // Get non-erased components
        const activeComponents = components.filter(c => !c.erased);
        if (activeComponents.length === 0) {
            return null;
        }

        // Sort active components from left to right based on minX
        activeComponents.sort((a, b) => a.minX - b.minX);

        // Find the split point based on the largest horizontal gap of at least 3 pixels
        let splitIdx = -1;
        let maxGap = 0;
        for (let i = 0; i < activeComponents.length - 1; i++) {
            const gap = activeComponents[i+1].minX - activeComponents[i].maxX;
            if (gap > maxGap) {
                maxGap = gap;
                splitIdx = i;
            }
        }

        // If a clear separation gap of at least 1 pixel is found, erase everything to the left of it (the checkmark icon)!
        // Otherwise, fall back to a conservative 25% boundary to prevent erasing thin digits (like 11).
        if (splitIdx !== -1 && maxGap >= 1 && activeComponents[splitIdx].maxX < safeW * 0.55) {
            for (let i = 0; i <= splitIdx; i++) {
                for (const pixelIdx of activeComponents[i].pixels) {
                    px[pixelIdx * 4] = 255;
                    px[pixelIdx * 4 + 1] = 255;
                    px[pixelIdx * 4 + 2] = 255;
                }
                activeComponents[i].erased = true;
            }
        } else {
            for (const comp of activeComponents) {
                if (comp.minX < safeW * 0.25) {
                    for (const pixelIdx of comp.pixels) {
                        px[pixelIdx * 4] = 255;
                        px[pixelIdx * 4 + 1] = 255;
                        px[pixelIdx * 4 + 2] = 255;
                    }
                    comp.erased = true;
                }
            }
        }
        tCtx.putImageData(imgData, 0, 0);

        // Determine the bounding box of the remaining digit components
        let digitMinX = safeW, digitMaxX = 0, digitMinY = safeH, digitMaxY = 0;
        let hasDigits = false;

        for (const comp of components) {
            if (comp.erased) continue;
            
            if (comp.minX < digitMinX) digitMinX = comp.minX;
            if (comp.maxX > digitMaxX) digitMaxX = comp.maxX;
            if (comp.minY < digitMinY) digitMinY = comp.minY;
            if (comp.maxY > digitMaxY) digitMaxY = comp.maxY;
            hasDigits = true;
        }

        // If no digits remain, return null
        if (!hasDigits || digitMinX >= digitMaxX || digitMinY >= digitMaxY) {
            return null;
        }

        // Add generous padding (8px horiz, 6px vert) for maximum Tesseract OCR precision and beautiful debug outlines
        const padX = 8;
        const padY = 6;
        const cropStartX = Math.max(0, digitMinX - padX);
        const cropStartY = Math.max(0, digitMinY - padY);
        const cropEndX = Math.min(safeW - 1, digitMaxX + padX);
        const cropEndY = Math.min(safeH - 1, digitMaxY + padY);

        const digitW = cropEndX - cropStartX + 1;
        const digitH = cropEndY - cropStartY + 1;

        const SCALE = 4;
        const badgeCvs = document.createElement("canvas");
        badgeCvs.width = digitW * SCALE;
        badgeCvs.height = digitH * SCALE;
        const bCtx = badgeCvs.getContext("2d", { willReadFrequently: true });
        // Scale the perfectly clustered binary image with high-quality bilinear smoothing
        bCtx.imageSmoothingEnabled = true;
        bCtx.imageSmoothingQuality = "high";
        bCtx.drawImage(tempCvs, cropStartX, cropStartY, digitW, digitH, 0, 0, badgeCvs.width, badgeCvs.height);

        // Re-binarize the smoothed high-resolution canvas to get perfectly smooth, solid vector-like black digits
        const bImgData = bCtx.getImageData(0, 0, badgeCvs.width, badgeCvs.height);
        const bPx = bImgData.data;
        for (let i = 0; i < bPx.length; i += 4) {
            const luma = bPx[i] * 0.299 + bPx[i + 1] * 0.587 + bPx[i + 2] * 0.114;
            const val = luma < 180 ? 0 : 255;
            bPx[i] = bPx[i + 1] = bPx[i + 2] = val;
        }
        bCtx.putImageData(bImgData, 0, 0);

        // Attach properties for debug outline
        badgeCvs.bestY = startY + cropStartY;
        badgeCvs.bestOffset = cropStartY;
        badgeCvs.cropX = cell.sx + cropStartX;
        badgeCvs.cropY = startY + cropStartY;
        badgeCvs.cropW = digitW;
        badgeCvs.cropH = digitH;

        return badgeCvs;
    },
};
