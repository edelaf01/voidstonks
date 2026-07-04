import { OpenCVRepository } from "../repositories/opencv.repository.js";



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

const THEME_TOL_SQ = 1944;

export const VisionService = {
    _sharedCvs: document.createElement("canvas"),
    _themeCvs: document.createElement("canvas"),
    _filterCvs: document.createElement("canvas"),
    _textCvs: document.createElement("canvas"),
    _tempBadgeCvs: document.createElement("canvas"),
    _badgeCvs: document.createElement("canvas"),
    _relicSelectionCvs: document.createElement("canvas"),
    _rewardCvs: document.createElement("canvas"),
    _rewardNamesCvs: document.createElement("canvas"),
    _rivenCvs: document.createElement("canvas"),
    _inventoryCvs: document.createElement("canvas"),
    getFrameHash(ctx, w, h) {
        const data = ctx.getImageData(0, 0, w, h).data;
        let hash = 0;
        const step = Math.floor(data.length / 64) || 4;
        for (let i = 0; i < data.length; i += step) {
            hash += data[i];
        }
        return hash;
    },

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

    async findTextRows(canvas) {
        const ready = await OpenCVRepository.waitReady();
        if (!ready) return [];

        return OpenCVRepository.run((cv) => {
            const rects = [];
            let src, gray, binary, morph, k, contours, hierarchy;
            try {
                src = cv.imread(canvas);
                gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                binary = new cv.Mat();
                cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 10);

                morph = new cv.Mat();
                k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(25, 3));
                cv.dilate(binary, morph, k);
                k.delete();
                k = null;

                contours = new cv.MatVector();
                hierarchy = new cv.Mat();
                cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                for (let i = 0; i < contours.size(); i++) {
                    let r = cv.boundingRect(contours.get(i));
                    if (r.width > canvas.width * 0.3 && r.height > 15 && r.height < 150) {
                        rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
                    }
                }
            } finally {
                if (src) src.delete();
                if (gray) gray.delete();
                if (binary) binary.delete();
                if (morph) morph.delete();
                if (k) k.delete();
                if (contours) contours.delete();
                if (hierarchy) hierarchy.delete();
            }

            return rects.sort((a, b) => a.y - b.y);
        }) || [];
    },
    prepareVirtualCanvas(video, canvas) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = 1080 / height;

        const hCropW = Math.floor(width * 0.45);
        const hCropH = Math.floor(height * 0.12);

        canvas.width = Math.floor(hCropW * scale);
        canvas.height = Math.floor(hCropH * scale);

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, hCropW, hCropH, 0, 0, canvas.width, canvas.height);

        const theme = this.detectThemeFromSnapshot(canvas, 0, 0, canvas.width, canvas.height);

        this.applyClusteringThreshold(ctx, canvas.width, canvas.height, theme);

        return { width, height, scale };
    },

    detectThemeFromSnapshot(snapshot, sampleX, sampleY, sampleW, sampleH) {
        const cvs = this._themeCvs;
        cvs.width = sampleW; cvs.height = sampleH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, sampleX, sampleY, sampleW, sampleH, 0, 0, sampleW, sampleH);

        const px = ctx.getImageData(0, 0, sampleW, sampleH).data;

        const themeStats = new Array(WF_THEMES.length).fill(0).map(() => ({ rSum: 0, gSum: 0, bSum: 0, count: 0, weight: 0 }));

        for (let i = 0; i < px.length; i += 16) {
            const r = px[i], g = px[i + 1], b = px[i + 2];

            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luma < 100) continue;

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

        const actualR = bestStats.count > 0 ? Math.round(bestStats.rSum / bestStats.count) : bestTheme.r;
        const actualG = bestStats.count > 0 ? Math.round(bestStats.gSum / bestStats.count) : bestTheme.g;
        const actualB = bestStats.count > 0 ? Math.round(bestStats.bSum / bestStats.count) : bestTheme.b;

        console.log(`[VisionService] Theme detected: ${bestTheme.name} (weight: ${maxWeight.toFixed(4)}, catalog: rgb(${bestTheme.r},${bestTheme.g},${bestTheme.b}), actual: rgb(${actualR},${actualG},${actualB}))`);

        if (maxWeight < 0.001) {
            if (globalThis.state && globalThis.state.lastStableTheme) {
                return globalThis.state.lastStableTheme;
            }
            return null;
        }

        const result = {
            name: bestTheme.name,
            r: bestTheme.r,
            g: bestTheme.g,
            b: bestTheme.b,
            actualR,
            actualG,
            actualB,
        };

        if (globalThis.state) {
            globalThis.state.lastStableTheme = result;
        }

        return result;
    },

    createFilteredOcrCanvas(snapshot, width, height, grid) {
        const cvs = this._filterCvs;
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        ctx.filter = "grayscale(100%) contrast(400%) brightness(1.3)";
        ctx.drawImage(snapshot, 0, 0);
        ctx.filter = "none";

        const imgData = ctx.getImageData(0, 0, width, height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const v = px[i] > 128 ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

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

    detectInventoryGrid(mask, maskW, maskH) {
        const rowDensity = new Float32Array(maskH);
        for (let y = 0; y < maskH; y++)
            for (let x = 0; x < maskW; x++) rowDensity[y] += mask[y * maskW + x];

        const rowMax = Math.max(...rowDensity);
        if (rowMax < 10) return null;

        const rowMinDist = Math.floor(maskH / 6.5);
        const rowPeaks = this._findPeaks(rowDensity, rowMinDist, rowMax * 0.25);
        if (!rowPeaks.length) return null;

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

        const peaks = [];
        let last = -minDist;
        for (let i = 1; i < smoothed.length - 1; i++) {
            if (smoothed[i] >= threshold && smoothed[i] > smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
                if (i - last >= minDist) {
                    peaks.push(i);
                    last = i;
                } else if (smoothed[i] > smoothed[last]) {
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

            if (luma > 180) {
                isText = true;
            }

            px[i] = px[i + 1] = px[i + 2] = isText ? 0 : 255;
        }

        const dilatedImgData = ctx.createImageData(cvs.width, cvs.height);
        const dPx = dilatedImgData.data;
        const w = cvs.width;
        const h = cvs.height;

        for (let i = 0; i < dPx.length; i += 4) {
            dPx[i] = dPx[i + 1] = dPx[i + 2] = 255;
            dPx[i + 3] = 255;
        }

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                if (px[idx] === 0) {
                    dPx[idx] = dPx[idx + 1] = dPx[idx + 2] = 0;
                    dPx[idx - 4] = dPx[idx - 3] = dPx[idx - 2] = 0;
                    dPx[idx + 4] = dPx[idx + 5] = dPx[idx + 6] = 0;
                    const topIdx = idx - w * 4;
                    dPx[topIdx] = dPx[topIdx + 1] = dPx[topIdx + 2] = 0;
                    const botIdx = idx + w * 4;
                    dPx[botIdx] = dPx[botIdx + 1] = dPx[botIdx + 2] = 0;
                }
            }
        }

        ctx.putImageData(dilatedImgData, 0, 0);
        return cvs;
    },

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
        const bdgOffsetX = Math.floor(grid.cellW * 0.10);
        const copyW = Math.floor(grid.cellW * 0.22);

        const badgeH = Math.floor(grid.cellH * 0.11);
        const BADGE_SCALE = 3;

        const tempCvs = this._tempBadgeCvs;
        tempCvs.width = copyW; tempCvs.height = badgeH;
        const tCtx = tempCvs.getContext('2d');
        tCtx.drawImage(snapshot, cell.sx + bdgOffsetX, cell.sy, copyW, badgeH, 0, 0, copyW, badgeH);

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
        let c1 = [0, 0, 0], c2 = theme ? [theme.actualR || theme.r, theme.actualG || theme.g, theme.actualB || theme.b] : [255, 255, 255], minL = 255, maxL = 0;
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

    prepareRewardCanvas(snapshot, card, scale) {
        const cvs = this._rewardCvs;
        cvs.width = Math.floor(card.w * scale);
        cvs.height = Math.floor(card.h * scale);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, card.x, card.y, card.w, card.h, 0, 0, cvs.width, cvs.height);
        return cvs;
    },

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

    prepareRewardOCRCanvas(video, width, height, scale) {
        const rCropY = Math.floor(height * 0.185);
        const rCropH = Math.floor(height * 0.255);
        const marginX = Math.floor(width * 0.08);
        const cropW = width - marginX * 2;
        const targetW = Math.floor(cropW * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = this._rewardCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        ctx.filter = "grayscale(100%) contrast(400%) brightness(1.3)";
        ctx.drawImage(video, marginX, rCropY, cropW, rCropH, 0, 0, targetW, targetH);
        ctx.filter = "none";
        return cvs;
    },

    prepareRewardNamesCanvas(video, width, height, scale) {
        const rCropY = Math.floor(height * 0.185);
        const rCropH = Math.floor(height * 0.255);
        const marginX = Math.floor(width * 0.08);
        const cropW = width - marginX * 2;
        const targetW = Math.floor(cropW * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = this._rewardNamesCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, marginX, rCropY, cropW, rCropH, 0, 0, targetW, targetH);

        const img = ctx.getImageData(0, 0, targetW, targetH);
        const px = img.data;

        const toHSV = (r, g, b) => {
            r /= 255; g /= 255; b /= 255;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
            let h = 0;
            if (d !== 0) {
                if (mx === r) h = ((g - b) / d) % 6;
                else if (mx === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6; if (h < 0) h += 1;
            }
            return [h, mx === 0 ? 0 : d / mx, mx];
        };

        const bins = new Array(36).fill(0);
        const hsum = new Array(36).fill(0);
        for (let i = 0; i < px.length; i += 4) {
            const [h, s, v] = toHSV(px[i], px[i + 1], px[i + 2]);
            if (v > 0.47 && s > 0.55) {
                const bi = Math.min(35, Math.floor(h * 36));
                bins[bi]++; hsum[bi] += h;
            }
        }
        let peak = 0;
        for (let i = 1; i < 36; i++) if (bins[i] > bins[peak]) peak = i;
        const Hd = bins[peak] >= 20 ? hsum[peak] / bins[peak] : null;

        for (let i = 0; i < px.length; i += 4) {
            const [h, s, v] = toHSV(px[i], px[i + 1], px[i + 2]);
            let isText;
            if (Hd === null) {
                isText = v > 0.78 && s < 0.45;
            } else {
                let hd = Math.abs(h - Hd); if (hd > 0.5) hd = 1 - hd;
                isText = v > 0.30 && s > 0.45 && hd < 0.125;
            }
            const val = isText ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = val;
        }
        ctx.putImageData(img, 0, 0);
        return cvs;
    },

    _rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0, s = max === 0 ? 0 : (d / max) * 100, v = max * 100;
        if (d !== 0) {
            if (max === r) h = 60 * (((g - b) / d) % 6);
            else if (max === g) h = 60 * (((b - r) / d) + 2);
            else h = 60 * (((r - g) / d) + 4);
            if (h < 0) h += 360;
        }
        return [h, s, v];
    },

    RIVEN_CARD_CROP: { x: 0.13, y: 0.50, w: 0.74, h: 0.40 },
    RIVEN_ITEM_DETAILS_CROP: { x: 0.33, y: 0.30, w: 0.34, h: 0.40 },

    _binarizeRivenText(px, targetW, targetH, opts = {}) {
        const W = 25;
        const C = opts.C ?? 18;
        const whiteMin = opts.whiteMin ?? 120;

        const L = new Uint8Array(targetW * targetH);
        for (let i = 0; i < L.length; i++) {
            const idx = i * 4;
            L[i] = Math.round(0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2]);
        }

        for (let y = 0; y < targetH; y++) {
            const rowOff = y * targetW;
            let sum = 0, count = 0;
            for (let x = 0; x <= W && x < targetW; x++) { sum += L[rowOff + x]; count++; }

            for (let x = 0; x < targetW; x++) {
                const oldX = x - W - 1, newX = x + W;
                if (oldX >= 0) { sum -= L[rowOff + oldX]; count--; }
                if (newX < targetW) { sum += L[rowOff + newX]; count++; }

                const avg = sum / count;
                const idx = (rowOff + x) * 4;
                const val = L[rowOff + x];
                const r = px[idx], g = px[idx + 1], b = px[idx + 2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                const s = mx === 0 ? 0 : (mx - mn) / mx;

                let isText = false;
                if (val > avg + C) {
                    const isLavender = (b > r && r > g && s > 0.12 && s < 0.45);
                    const isWhite    = (s < 0.18 && val > whiteMin);
                    if (isLavender || isWhite) isText = true;
                }
                if (r > 90 && r - g > 30 && r - b > 30) isText = true;

                px[idx] = px[idx + 1] = px[idx + 2] = isText ? 0 : 255;
            }
        }
    },

    prepareRivenCardCanvases(video, scale, crop) {
        const width = video.videoWidth || video.width || 1920;
        const height = video.videoHeight || video.height || 1080;

        const C = crop || this.RIVEN_CARD_CROP;
        const cropX = Math.floor(width * C.x);
        const cropW = Math.floor(width * C.w);
        const cropY = Math.floor(height * C.y);
        const cropH = Math.floor(height * C.h);

        const S = 2;
        const targetW = Math.floor(cropW * scale * S);
        const targetH = Math.floor(cropH * scale * S);

        const cvs = this._rivenCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.filter = "none";
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

        const rawData = ctx.getImageData(0, 0, targetW, targetH);
        const statsZoneStart = Math.floor(targetH * 0.38);
        const minClusterW = Math.floor(targetW * 0.06);

        const findClusters = (binPx) => {
            const colCount = new Int32Array(targetW);
            for (let y = statsZoneStart; y < targetH; y++) {
                const rowOff = y * targetW;
                for (let x = 0; x < targetW; x++) if (binPx[(rowOff + x) * 4] === 0) colCount[x]++;
            }
            const colThresh = Math.max(2, Math.floor((targetH - statsZoneStart) * 0.015));
            const gapTol = Math.floor(targetW * 0.045);
            const clusters = [];
            let start = -1, lastActive = -1;
            for (let x = 0; x < targetW; x++) {
                if (colCount[x] >= colThresh) { if (start === -1) start = x; lastActive = x; }
                else if (start !== -1 && x - lastActive > gapTol) { clusters.push([start, lastActive]); start = -1; }
            }
            if (start !== -1) clusters.push([start, lastActive]);
            return clusters.filter(c => (c[1] - c[0]) >= minClusterW);
        };

        const brightPx = new Uint8ClampedArray(rawData.data);
        this._binarizeRivenText(brightPx, targetW, targetH, { C: 18, whiteMin: 120 });
        const dimPx = new Uint8ClampedArray(rawData.data);
        this._binarizeRivenText(dimPx, targetW, targetH, { C: 10, whiteMin: 65 });

        const byWidthDesc = (a, b) => (b[1] - b[0]) - (a[1] - a[0]);
        const brightClusters = findClusters(brightPx).sort(byWidthDesc);
        const dimClusters = findClusters(dimPx).sort(byWidthDesc);

        const overlaps = (a, b) => !(a[1] < b[0] || b[1] < a[0]);
        const center = brightClusters[0] || null;
        const side = center ? (dimClusters.find(c => !overlaps(c, center)) || null) : null;

        const plan = [];
        if (center) plan.push({ range: center, binPx: brightPx });
        if (side) plan.push({ range: side, binPx: dimPx });
        if (!plan.length) (dimClusters.length ? dimClusters : [[0, targetW - 1]]).forEach(r => plan.push({ range: r, binPx: dimPx }));

        const pad = Math.floor(6 * scale);
        const out = [];
        for (const { range, binPx } of plan) {
            const [cx0, cx1] = range;
            let minY = 0, maxY = targetH - 1;
            const rowCount = new Int32Array(targetH);
            for (let y = 0; y < targetH; y++) {
                let c = 0;
                const rowOff = y * targetW;
                for (let x = cx0; x <= cx1; x++) { if (binPx[(rowOff + x) * 4] === 0) c++; }
                rowCount[y] = c;
            }
            const rowThresh = Math.max(2, Math.floor((cx1 - cx0) * 0.02));
            while (minY < maxY && rowCount[minY] < rowThresh) minY++;
            while (maxY > minY && rowCount[maxY] < rowThresh) maxY--;

            const bx0 = Math.max(0, cx0 - pad), by0 = Math.max(0, minY - pad);
            const bx1 = Math.min(targetW - 1, cx1 + pad), by1 = Math.min(targetH - 1, maxY + pad);
            const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
            if (bw < 40 || bh < 30) continue;

            ctx.putImageData(new ImageData(binPx, targetW, targetH), 0, 0);
            const oc = document.createElement("canvas");
            oc.width = bw;
            oc.height = bh;
            oc.getContext("2d").putImageData(ctx.getImageData(bx0, by0, bw, bh), 0, 0);
            out.push(oc);
        }

        if (globalThis.dumpRivenCrops) this._dumpRivenCrops(out.length ? out : [cvs]);

        return out.length ? out : [cvs];
    },

    _dumpRivenCrops(canvases) {
        let host = document.getElementById("__rivenDump");
        if (!host) {
            host = document.createElement("div");
            host.id = "__rivenDump";
            host.style.cssText = "position:fixed;top:0;left:0;z-index:999999;background:#000;padding:4px;display:flex;gap:6px;border:2px solid lime";
            document.body.appendChild(host);
        }
        host.innerHTML = "";
        canvases.forEach((c, i) => {
            const clone = document.createElement("canvas");
            clone.width = c.width;
            clone.height = c.height;
            clone.getContext("2d").drawImage(c, 0, 0);
            clone.style.cssText = "outline:1px solid magenta;max-height:180px;height:auto";
            clone.title = `card ${i} — ${c.width}x${c.height}`;
            host.appendChild(clone);
            console.log(`[rivenDump] card ${i}: ${c.width}x${c.height}`, c.toDataURL());
        });
    },

    determineContext(headerText) {
        const text = headerText.toUpperCase();
        
        const hasInv = /INVEN|TORY|1NVENT|INV|VENT|SELL|TARIO/.test(text);
        const hasMods = /MODS|MOD|M0DS|MOOS|MDDS|MDS|M0D5|M0D|MOO|MD|FICADORES|AGRIETADO|KUVA|KUYVA|CICLO|CICLAR|ATRIBU/.test(text);

        if (/DETAIL|DETALL/.test(text)) return "ITEM_DETAILS";
        if (hasMods) return "INVENTORY_MODS";
        if (hasInv) return "INVENTORY";
        if (/RELI|ELIC|REFI|NEME/.test(text)) return "RELICS";
        if (/REWA|WARD|ARDS|FISSU|FISSI|FISR|F5UR|FSUR|FI55|F1SS|FISS|FISU|VOID|V0ID|V01D/.test(text)) return "REWARD";
        return "UNKNOWN";
    },

     buildAutoGrid(snapshot, gridZone, theme, calibData) {
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

                const cx = sx + finalCellW / 2;
                const cy = sy + finalCellH * 0.82;

                cellRects.push({ r: ri, c: ci, sx, sy, cx, cy });
            }
        }

        console.log(`[buildAutoGrid] Snapped perfect ${rows}x${cols} grid to calibrated zone: cellW=${finalCellW}, cellH=${finalCellH}`);
        return { cellRects, cellW: finalCellW, cellH: finalCellH, cols, rows };
    },

    extractBadgeByColor(snapshot, cell, cellW, cellH, theme) {
        const safeW = Math.round(cellW * 0.35);
        const padTop = 12;
        const startY = Math.max(0, cell.sy - padTop);
        const safeH = Math.round(cellH * 0.25) + padTop;

        const tempCvs = document.createElement("canvas");
        tempCvs.width = safeW;
        tempCvs.height = safeH;
        const tCtx = tempCvs.getContext("2d", { willReadFrequently: true });
        tCtx.drawImage(snapshot, cell.sx, startY, safeW, safeH, 0, 0, safeW, safeH);

        this.applyClusteringThreshold(tCtx, safeW, safeH, theme);

        const imgData = tCtx.getImageData(0, 0, safeW, safeH);
        const px = imgData.data;



        const visited = new Uint8Array(safeW * safeH);
        const components = [];

        const scanW = safeW;
        const scanH = safeH;

        for (let y = 0; y < scanH; y++) {
            for (let x = 0; x < scanW; x++) {
                const idx = y * safeW + x;
                if (px[idx * 4] === 0 && !visited[idx]) {
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

        if (components.length === 0) {
            return null;
        }

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

        let globalMinY = safeH;
        for (const comp of components) {
            if (!comp.erased && comp.pixels.length >= 8 && comp.minY < globalMinY) {
                globalMinY = comp.minY;
            }
        }

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

        const activeComponents = components.filter(c => !c.erased);
        if (activeComponents.length === 0) {
            return null;
        }

        activeComponents.sort((a, b) => a.minX - b.minX);

        let splitIdx = -1;
        let maxGap = 0;
        for (let i = 0; i < activeComponents.length - 1; i++) {
            const gap = activeComponents[i+1].minX - activeComponents[i].maxX;
            if (gap > maxGap) {
                maxGap = gap;
                splitIdx = i;
            }
        }

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

        if (!hasDigits || digitMinX >= digitMaxX || digitMinY >= digitMaxY) {
            return null;
        }

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
        bCtx.imageSmoothingEnabled = true;
        bCtx.imageSmoothingQuality = "high";
        bCtx.drawImage(tempCvs, cropStartX, cropStartY, digitW, digitH, 0, 0, badgeCvs.width, badgeCvs.height);

        const bImgData = bCtx.getImageData(0, 0, badgeCvs.width, badgeCvs.height);
        const bPx = bImgData.data;
        for (let i = 0; i < bPx.length; i += 4) {
            const luma = bPx[i] * 0.299 + bPx[i + 1] * 0.587 + bPx[i + 2] * 0.114;
            const val = luma < 180 ? 0 : 255;
            bPx[i] = bPx[i + 1] = bPx[i + 2] = val;
        }
        bCtx.putImageData(bImgData, 0, 0);

        badgeCvs.bestY = startY + cropStartY;
        badgeCvs.bestOffset = cropStartY;
        badgeCvs.cropX = cell.sx + cropStartX;
        badgeCvs.cropY = startY + cropStartY;
        badgeCvs.cropW = digitW;
        badgeCvs.cropH = digitH;

        return badgeCvs;
    },
};
