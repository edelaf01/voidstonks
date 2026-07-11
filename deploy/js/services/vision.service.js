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
    { name: "Default", r: 227, g: 128, b: 20 },
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

        return { width, height, scale };
    },

    finalizeVirtualCanvas(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const theme = this.detectThemeFromSnapshot(canvas, 0, 0, canvas.width, canvas.height);
        this.applyClusteringThreshold(ctx, canvas.width, canvas.height, theme);
        return theme;
    },

    applyThemeDistanceThreshold(ctx, w, h, theme, maxDist = 130) {
        const tR = theme.actualR ?? theme.r, tG = theme.actualG ?? theme.g, tB = theme.actualB ?? theme.b;
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const d = Math.abs(px[i] - tR) + Math.abs(px[i + 1] - tG) + Math.abs(px[i + 2] - tB);
            px[i] = px[i + 1] = px[i + 2] = d < maxDist ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
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

    _hintCvs: null,
    hasRivenTextHint(video) {
        const C = this.RIVEN_ITEM_DETAILS_CROP;
        if (!this._hintCvs) {
            this._hintCvs = document.createElement("canvas");
            this._hintCvs.width = 64;
            this._hintCvs.height = 36;
        }
        const ctx = this._hintCvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video,
            Math.floor(video.videoWidth * C.x), Math.floor(video.videoHeight * C.y),
            Math.floor(video.videoWidth * C.w), Math.floor(video.videoHeight * C.h),
            0, 0, 64, 36);
        const d = ctx.getImageData(0, 0, 64, 36).data;
        let lavender = 0;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const s = mx === 0 ? 0 : (mx - mn) / mx;
            if (b > r && r > g && s > 0.10 && s < 0.5 && mx > 80) lavender++;
        }
        return lavender >= 25;
    },


    _binarizeRivenTextDual(src, brightPx, dimPx, targetW, targetH) {
        const W = 25;
        const L = new Uint8Array(targetW * targetH);
        for (let i = 0; i < L.length; i++) {
            const idx = i * 4;
            L[i] = Math.round(0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]);
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
                const r = src[idx], g = src[idx + 1], b = src[idx + 2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                const s = mx === 0 ? 0 : (mx - mn) / mx;
                const isLavender = (b > r && r > g && s > 0.12 && s < 0.45);
                const red = (r > 90 && r - g > 30 && r - b > 30);
                const brightText = red || (val > avg + 18 && (isLavender || (s < 0.18 && val > 120)));
                const dimText = red || (val > avg + 10 && (isLavender || (s < 0.18 && val > 65)));
                brightPx[idx] = brightPx[idx + 1] = brightPx[idx + 2] = brightText ? 0 : 255;
                brightPx[idx + 3] = 255;
                dimPx[idx] = dimPx[idx + 1] = dimPx[idx + 2] = dimText ? 0 : 255;
                dimPx[idx + 3] = 255;
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

        // s=1.5: text ends ~25 px tall, Tesseract's sweet spot
        const S = 1.5;
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
        const gapTol = Math.floor(targetW * 0.045);
        const runLo = Math.max(3, Math.round(targetH * 0.0046));
        const runHi = Math.round(targetH * 0.046);

        const glyphRunsPerCol = (binPx) => {
            const counts = new Int32Array(targetW);
            for (let x = 0; x < targetW; x++) {
                let run = 0, n = 0;
                for (let y = statsZoneStart; y < targetH; y++) {
                    if (binPx[(y * targetW + x) * 4] === 0) { run++; continue; }
                    if (run >= runLo && run <= runHi) n++;
                    run = 0;
                }
                if (run >= runLo && run <= runHi) n++;
                counts[x] = n;
            }
            return counts;
        };

        const clusterRanges = (counts) => {
            const clusters = [];
            let start = -1, lastActive = -1;
            for (let x = 0; x < targetW; x++) {
                if (counts[x] >= 3) { if (start === -1) start = x; lastActive = x; }
                else if (start !== -1 && x - lastActive > gapTol) { clusters.push([start, lastActive]); start = -1; }
            }
            if (start !== -1) clusters.push([start, lastActive]);
            return clusters.filter(c => (c[1] - c[0]) >= minClusterW);
        };

        const mass = (counts, [x0, x1]) => {
            let s = 0;
            for (let x = x0; x <= x1; x++) s += counts[x];
            return s;
        };

        const splitWide = (rg, counts) => {
            const [x0, x1] = rg;
            const w = x1 - x0 + 1;
            if (w <= targetW * 0.38) return [rg];
            const k = Math.max(5, Math.floor(targetW * 0.01));
            const sm = new Float32Array(w);
            for (let i = 0; i < w; i++) {
                let s = 0, n = 0;
                for (let j = Math.max(0, i - (k >> 1)); j <= Math.min(w - 1, i + (k >> 1)); j++) { s += counts[x0 + j]; n++; }
                sm[i] = s / n;
            }
            const lo = Math.floor(w * 0.25), hi = Math.floor(w * 0.75);
            let cut = lo;
            for (let i = lo; i < hi; i++) if (sm[i] < sm[cut]) cut = i;
            let leftMax = 1, rightMax = 1;
            for (let i = 0; i < cut; i++) leftMax = Math.max(leftMax, sm[i]);
            for (let i = cut; i < w; i++) rightMax = Math.max(rightMax, sm[i]);
            if (sm[cut] <= 0.35 * leftMax && sm[cut] <= 0.35 * rightMax) {
                return [[x0, x0 + cut - 1], [x0 + cut + 1, x1]];
            }
            return [rg];
        };

        if (!this._brightBuf || this._brightBuf.length !== rawData.data.length) {
            this._brightBuf = new Uint8ClampedArray(rawData.data.length);
            this._dimBuf = new Uint8ClampedArray(rawData.data.length);
        }
        const brightPx = this._brightBuf;
        const dimPx = this._dimBuf;
        this._binarizeRivenTextDual(rawData.data, brightPx, dimPx, targetW, targetH);

        const bruns = glyphRunsPerCol(brightPx);
        const druns = glyphRunsPerCol(dimPx);

        const maskFor = (rg) => (mass(bruns, rg) >= 0.55 * mass(druns, rg) ? brightPx : dimPx);

        const plan = [];
        const bclusters = clusterRanges(bruns);
        if (!bclusters.length) {
            const dcl = [];
            clusterRanges(druns).forEach(rg => dcl.push(...splitWide(rg, druns)));
            (dcl.length ? dcl : [[0, targetW - 1]]).slice(0, 2)
                .forEach(rg => plan.push({ range: rg, binPx: dimPx }));
        } else {
            let center = bclusters[0];
            for (const rg of bclusters) if (mass(bruns, rg) > mass(bruns, center)) center = rg;

            const parts = splitWide(center, druns);
            if (parts.length === 2) {
                parts.forEach(rg => plan.push({ range: rg, binPx: maskFor(rg) }));
            } else {
                plan.push({ range: center, binPx: brightPx });
                const margin = Math.floor(targetW * 0.015);
                const rem = Int32Array.from(druns);
                for (let x = Math.max(0, center[0] - margin); x <= Math.min(targetW - 1, center[1] + margin); x++) rem[x] = 0;
                const scand = clusterRanges(rem);
                if (scand.length) {
                    let side = scand[0];
                    for (const rg of scand) if (mass(rem, rg) > mass(rem, side)) side = rg;
                    if (mass(rem, side) >= 0.22 * mass(bruns, center)) {
                        plan.push({ range: side, binPx: dimPx });
                    }
                }
                plan.sort((a, b) => a.range[0] - b.range[0]);
            }
        }

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
            if (!this._rivenOutCvs) this._rivenOutCvs = [];
            let oc = this._rivenOutCvs[out.length];
            if (!oc) { oc = document.createElement("canvas"); this._rivenOutCvs[out.length] = oc; }
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
        const hasMods = /MODS|MOD|M0DS|MOOS|MDDS|MDS|M0D5|M0D|MOO|MD|FICADORES|AGRIETADO|KUVA|KUYVA|CICLO|CICLAR|ATRIBU/.test(text) ||
            /\/\s*[MNHW][O0DQC][DO0B][S5$]/.test(text);

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
            return this._applyRowPhase(snapshot, gridZone, { cellRects, cellW, cellH, cols, rows });
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
        return this._applyRowPhase(snapshot, gridZone, { cellRects, cellW: finalCellW, cellH: finalCellH, cols, rows });
    },

    detectRowPhase(snapshot, gridZone, rowTops, cellH) {
        const { x: zx, y: zy, w: zw, h: zh } = gridZone;
        const ctx = snapshot.getContext("2d", { willReadFrequently: true });
        const data = ctx.getImageData(zx, zy, zw, zh).data;

        const bright = new Float32Array(zh);
        let totalBright = 0;
        for (let y = 0; y < zh; y++) {
            let cnt = 0;
            const rowOff = y * zw * 4;
            for (let x = 0; x < zw; x += 4) {
                const i = rowOff + x * 4;
                const mx = Math.max(data[i], data[i + 1], data[i + 2]);
                if (mx > 185) cnt++;
            }
            bright[y] = cnt;
            totalBright += cnt;
        }
        if (totalBright < zh) return 0;

        const band = (a, b) => {
            let s = 0;
            const y0 = Math.max(0, Math.round(a));
            const y1 = Math.min(zh - 1, Math.round(b));
            for (let y = y0; y <= y1; y++) s += bright[y];
            return s;
        };

        const half = Math.floor(cellH / 2);
        let bestDy = 0;
        let bestScore = -Infinity;
        for (let dy = -half; dy <= half; dy += 2) {
            let score = 0;
            for (const top of rowTops) {
                const t = top - zy + dy;
                score += band(t + cellH * 0.58, t + cellH * 0.92);
                score -= 2 * band(t - cellH * 0.04, t + cellH * 0.04);
            }
            if (score > bestScore) { bestScore = score; bestDy = dy; }
        }
        return Math.abs(bestDy) <= 4 ? 0 : bestDy;
    },

    _applyRowPhase(snapshot, gridZone, grid) {
        const rowTops = [...new Set(grid.cellRects.filter(c => c.c === 0).map(c => c.sy))];
        const dy = this.detectRowPhase(snapshot, gridZone, rowTops, grid.cellH);
        grid.phaseShift = dy;
        if (dy === 0) return grid;
        console.log(`[buildAutoGrid] Row phase shift: ${dy}px (scroll clampado, p.ej. final de lista) — realineando filas.`);
        for (const cell of grid.cellRects) { cell.sy += dy; cell.cy += dy; }
        grid.cellRects = grid.cellRects.filter(c => c.sy >= 0 && c.sy + grid.cellH <= snapshot.height);
        return grid;
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

        const srcData = tCtx.getImageData(0, 0, safeW, safeH).data;
        const srcLuma = new Float32Array(safeW * safeH);
        for (let p = 0; p < srcLuma.length; p++) {
            srcLuma[p] = 0.299 * srcData[p * 4] + 0.587 * srcData[p * 4 + 1] + 0.114 * srcData[p * 4 + 2];
        }

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

        let maxAvgLuma = 0;
        for (const comp of components) {
            if (comp.erased) continue;
            let sum = 0;
            for (const idx of comp.pixels) sum += srcLuma[idx];
            comp.avgLuma = sum / comp.pixels.length;
            if (comp.avgLuma > maxAvgLuma) maxAvgLuma = comp.avgLuma;
        }
        if (maxAvgLuma > 0) {
            for (const comp of components) {
                if (comp.erased) continue;
                if (comp.avgLuma < maxAvgLuma * 0.5) {
                    for (const pixelIdx of comp.pixels) {
                        px[pixelIdx * 4] = 255;
                        px[pixelIdx * 4 + 1] = 255;
                        px[pixelIdx * 4 + 2] = 255;
                    }
                    comp.erased = true;
                    comp.hardErased = true;
                }
            }
        }

        const isDigitShaped = (c) => {
            const ar = c.width / c.height;
            return ar <= 0.92 && c.height >= safeH * 0.20 && c.height <= safeH * 0.80;
        };
        for (const comp of components) {
            if (comp.erased) continue;
            if (!isDigitShaped(comp)) {
                for (const pixelIdx of comp.pixels) {
                    px[pixelIdx * 4] = 255;
                    px[pixelIdx * 4 + 1] = 255;
                    px[pixelIdx * 4 + 2] = 255;
                }
                comp.erased = true;
            }
        }

        const hasHigherDigit = components.some(c => !c.erased && c.minY <= safeH * 0.55);
        if (hasHigherDigit) {
            for (const comp of components) {
                if (comp.erased) continue;
                if (comp.minY > safeH * 0.55) {
                    for (const pixelIdx of comp.pixels) {
                        px[pixelIdx * 4] = 255;
                        px[pixelIdx * 4 + 1] = 255;
                        px[pixelIdx * 4 + 2] = 255;
                    }
                    comp.erased = true;
                    comp.hardErased = true;
                }
            }
        }

        if (!components.some(c => !c.erased)) {
            for (const comp of components) {
                if (comp.width > 18 && comp.height <= 3) continue;
                if (comp.hardErased) continue;
                comp.erased = false;
                for (const pixelIdx of comp.pixels) {
                    px[pixelIdx * 4] = 0; px[pixelIdx * 4 + 1] = 0; px[pixelIdx * 4 + 2] = 0;
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

    disambiguate69(badgeCvs, digits) {
        if (!/[69]/.test(digits)) return digits;
        const w = badgeCvs.width, h = badgeCvs.height;
        const ctx = badgeCvs.getContext("2d", { willReadFrequently: true });
        const px = ctx.getImageData(0, 0, w, h).data;
        const isBlack = (i) => px[i * 4] === 0;

        const labels = new Int32Array(w * h).fill(-1);
        const blobs = [];
        for (let start = 0; start < w * h; start++) {
            if (!isBlack(start) || labels[start] !== -1) continue;
            const id = blobs.length;
            const queue = [start];
            labels[start] = id;
            let qi = 0, minX = w, maxX = 0, minY = h, maxY = 0, area = 0;
            while (qi < queue.length) {
                const cur = queue[qi++];
                const cx = cur % w, cy = (cur - cx) / w;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                area++;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        const n = ny * w + nx;
                        if (isBlack(n) && labels[n] === -1) { labels[n] = id; queue.push(n); }
                    }
                }
            }
            blobs.push({ minX, maxX, minY, maxY, area });
        }

        const digitBlobs = blobs
            .filter(b => b.area >= 30 && (b.maxY - b.minY) >= h * 0.3)
            .sort((a, b) => a.minX - b.minX);
        if (digitBlobs.length !== digits.length) return digits;

        let out = "";
        for (let i = 0; i < digits.length; i++) {
            const ch = digits[i];
            if (ch !== "6" && ch !== "9") { out += ch; continue; }
            const b = digitBlobs[i];
            const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;

            const seen = new Uint8Array(bw * bh);
            const idxOf = (x, y) => (y - b.minY) * bw + (x - b.minX);
            const stack = [];
            const trySeed = (x, y) => {
                if (!isBlack(y * w + x) && !seen[idxOf(x, y)]) { seen[idxOf(x, y)] = 1; stack.push(y * w + x); }
            };
            for (let x = b.minX; x <= b.maxX; x++) { trySeed(x, b.minY); trySeed(x, b.maxY); }
            for (let y = b.minY; y <= b.maxY; y++) { trySeed(b.minX, y); trySeed(b.maxX, y); }
            while (stack.length) {
                const cur = stack.pop();
                const cx = cur % w, cy = (cur - cx) / w;
                if (cx + 1 <= b.maxX) trySeed(cx + 1, cy);
                if (cx - 1 >= b.minX) trySeed(cx - 1, cy);
                if (cy + 1 <= b.maxY) trySeed(cx, cy + 1);
                if (cy - 1 >= b.minY) trySeed(cx, cy - 1);
            }

            let holeArea = 0, holeYSum = 0;
            for (let y = b.minY; y <= b.maxY; y++) {
                for (let x = b.minX; x <= b.maxX; x++) {
                    if (!isBlack(y * w + x) && !seen[idxOf(x, y)]) { holeArea++; holeYSum += y; }
                }
            }
            if (holeArea < bh) { out += ch; continue; }

            const holeCy = holeYSum / holeArea;
            const centerY = (b.minY + b.maxY) / 2;
            const margin = bh * 0.06;
            if (holeCy > centerY + margin) out += "6";
            else if (holeCy < centerY - margin) out += "9";
            else out += ch;
        }
        return out;
    },
};
