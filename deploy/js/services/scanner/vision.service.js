import { OpenCVRepository } from "../../repositories/opencv.repository.js";
import { detectInventoryGrid } from "../../utils/vision/grid_detect.js";
import { maxChannelInvert } from "../../utils/vision/channel_max.js";
import { digitosPorAncla } from "../../utils/vision/badge_anchor.js";
import { accentMask } from "../../utils/vision/mission_complete_grid.js";
import { labelTop } from "../../utils/vision/label_band.js";
import { NAME_TEXT_COLORS, snapToThemeTextColor, rampCoreColor, bandInkHistogram, rankPageNameColors } from "../../utils/vision/name_color.js";
import { themeTextMask } from "../../utils/vision/theme_mask.js";
import { inkRunRatio } from "../../utils/vision/ink_runs.js";
import { maxChannelPreset } from "../../utils/vision/reward_preprocess.js";
// re-exported: several modules and tests import them from here
export { NAME_TEXT_COLORS, snapToThemeTextColor };

// Filming the game screen with a phone makes the browser's free autofocus, exposure and white
// balance hunt and blur frames: continuous modes keep them steady. Tried one by one, since most
// browsers throw on an unsupported constraint.
export async function applyBestCameraConstraints(stream) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track || !track.getCapabilities) return;
    let caps;
    try { caps = track.getCapabilities(); } catch { return; }
    if (!caps) return;

    const wanted = {};
    if (caps.focusMode?.includes("continuous")) wanted.focusMode = "continuous";
    if (caps.exposureMode?.includes("continuous")) wanted.exposureMode = "continuous";
    if (caps.whiteBalanceMode?.includes("continuous")) wanted.whiteBalanceMode = "continuous";
    if (Object.keys(wanted).length === 0) return;

    try {
        await track.applyConstraints({ advanced: [wanted] });
    } catch (e) {
        console.warn("[Vision] Camera constraints not applied:", e);
    }
}



import { eligeTema } from "../../utils/vision/theme_vote.js";

// name band upscale: 2x loses low contrast themes, 3x costs 20 % more per cell for the same reads
const CELL_UPSCALE = 2.5;

const FRAMES_PARA_CAMBIAR_TEMA = 3;
import { WF_THEMES, WF_THEMES_VOTABLES } from "../../utils/vision/wf_themes.js";
export { WF_THEMES };


// quantized color histogram (15-bit key) reused across calls; safe because its users are fully
// synchronous
const COLOR_HIST = new Uint32Array(32768);

// component labeling buffers, reused for the same reason; they grow to the largest crop
let LABELS = new Int32Array(0);
let STACK = new Int32Array(0);
const scratchLabels = (n) => {
    if (LABELS.length < n) LABELS = new Int32Array(n);
    LABELS.fill(-1, 0, n);
    return LABELS;
};
const scratchStack = (n) => {
    if (STACK.length < n) STACK = new Int32Array(n);
    return STACK;
};

export const VisionService = {
    _sharedCvs: document.createElement("canvas"),
    _themeCvs: document.createElement("canvas"),
    // { name, n }: frames in a row a different theme has been winning
    _temaRacha: null,
    _tempBadgeCvs: document.createElement("canvas"),
    _badgeCvs: document.createElement("canvas"),
    _relicSelectionCvs: document.createElement("canvas"),
    _rewardCvs: document.createElement("canvas"),
    _rewardNamesCvs: document.createElement("canvas"),
    _rivenCvs: document.createElement("canvas"),
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
                    const cnt = contours.get(i);
                    const r = cv.boundingRect(cnt);
                    cnt.delete();
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

        // only the top-left title area: the background art and sparks skewed the K-means threshold
        const hCropW = Math.floor(width * 0.45);
        const hCropH = Math.floor(height * 0.12);

        canvas.width = Math.floor(hCropW * scale);
        canvas.height = Math.floor(hCropH * scale);

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, hCropW, hCropH, 0, 0, canvas.width, canvas.height);

        return { width, height, scale };
    },

    /**
     * Centered title crop, for screens without a top-left title. Only MISSION COMPLETE so far: the left
     * crop reads "WARFRAME MIS".
     */
    prepareCenterHeaderCanvas(video, canvas) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = 1080 / height;

        const sx = Math.floor(width * 0.28);
        const sw = Math.floor(width * 0.44);
        const sh = Math.floor(height * 0.12);

        canvas.width = Math.floor(sw * scale);
        canvas.height = Math.floor(sh * scale);

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, sx, 0, sw, sh, 0, 0, canvas.width, canvas.height);

        return { width, height, scale };
    },

    /**
     * Crops a MISSION COMPLETE cell keeping only theme colored text: in gray the name blends with the
     * icon art. Icon art is gray/blue and mod names are white, so neither enters the mask.
     */
    prepareMissionCompleteCellCanvas(frame, cell, accent, canvas) {
        const fCtx = frame.getContext("2d", { willReadFrequently: true });
        const cellImg = fCtx.getImageData(cell.x, cell.y, cell.w, cell.h);
        const { mask } = accentMask(cellImg, accent, { x: 0, y: 0, w: cell.w, h: cell.h });
        // only the label: on gold themes the icon art passes the mask (utils/vision/label_band.js)
        mask.fill(0, 0, labelTop(mask, cell.w, cell.h) * cell.w);

        if (!this._mcMaskCvs) this._mcMaskCvs = document.createElement("canvas");
        const small = this._mcMaskCvs;
        small.width = cell.w; small.height = cell.h;
        const sCtx = small.getContext("2d", { willReadFrequently: true });
        const out = sCtx.createImageData(cell.w, cell.h);
        for (let i = 0; i < mask.length; i++) {
            const v = mask[i] ? 0 : 255; // black text on white, as Tesseract expects
            out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
            out.data[i * 4 + 3] = 255;
        }
        sCtx.putImageData(out, 0, 0);

        // upscaled to ~360 px a side: small cells lose 2-3 line names
        const k = Math.max(2, Math.round(360 / Math.max(1, cell.w)));
        canvas.width = cell.w * k;
        canvas.height = cell.h * k;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
        return canvas;
    },

    /**
     * Inverted grayscale crop of a frame zone, not binarized: the squad panel and pause menu are light
     * text on a dark panel. `zoom` applies over the 1080p normalization. The canvas is cached by
     * `cacheKey` here so callers do not touch the DOM.
     */
    _cropCvs: {},

    prepareCropForOCR(video, crop, zoom, cacheKey) {
        const canvas = this._cropCvs[cacheKey] ||= document.createElement("canvas");
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = (1080 / height) * zoom;

        const sx = Math.floor(width * crop.x);
        const sy = Math.floor(height * crop.y);
        const sw = Math.floor(width * crop.w);
        const sh = Math.floor(height * crop.h);

        canvas.width = Math.max(1, Math.floor(sw * scale));
        canvas.height = Math.max(1, Math.floor(sh * scale));

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        maxChannelInvert(ctx, canvas.width, canvas.height);  // not grayscale(): see channel_max.js
        return canvas;
    },

    /** Like prepareCropForOCR but not inverted: for PaddleOCR, which reads color. */
    prepareCropColorForOCR(video, crop, zoom, cacheKey) {
        const canvas = this._cropCvs[cacheKey] ||= document.createElement("canvas");
        const width = video.videoWidth;
        const height = video.videoHeight;
        const scale = (1080 / height) * zoom;

        const sx = Math.floor(width * crop.x);
        const sy = Math.floor(height * crop.y);
        const sw = Math.floor(width * crop.w);
        const sh = Math.floor(height * crop.h);

        canvas.width = Math.max(1, Math.floor(sw * scale));
        canvas.height = Math.max(1, Math.floor(sh * scale));

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas;
    },

    // theme detection and header threshold apart from the draw: only paid when the header changed
    finalizeVirtualCanvas(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const theme = this.detectThemeFromSnapshot(canvas, 0, 0, canvas.width, canvas.height);
        this.applyClusteringThreshold(ctx, canvas.width, canvas.height, theme);
        return theme; // the caller reuses it for the header binarization retry
    },

    // Alternative header binarization by distance to the theme color: K-means fails when the background
    // is light and close to the theme color. The header text is always the theme color.
    applyThemeDistanceThreshold(ctx, w, h, theme, maxDist = 130) {
        // no theme, no distance: the centered MISSION COMPLETE title gives no reliable theme
        if (!theme) return;
        const tR = theme.actualR ?? theme.r, tG = theme.actualG ?? theme.g, tB = theme.actualB ?? theme.b;
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
            const d = Math.abs(px[i] - tR) + Math.abs(px[i + 1] - tG) + Math.abs(px[i + 2] - tB);
            px[i] = px[i + 1] = px[i + 2] = d < maxDist ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    /**
     * Active UI theme by weighted vote: each pixel votes for its closest theme with weight
     * 1 / (distance + 1)^4, so a few exact text pixels beat a large mismatched background.
     */
    detectThemeFromSnapshot(snapshot, sampleX, sampleY, sampleW, sampleH) {
        const cvs = this._themeCvs;
        cvs.width = sampleW; cvs.height = sampleH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(snapshot, sampleX, sampleY, sampleW, sampleH, 0, 0, sampleW, sampleH);

        const px = ctx.getImageData(0, 0, sampleW, sampleH).data;

        const voto = eligeTema(px, WF_THEMES_VOTABLES);

        // the guard goes before the log, or it announced themes it then dropped
        if (!voto) {
            const estable = globalThis.state?.lastStableTheme;
            console.log(`[VisionService] Sin tema fiable — se mantiene ${estable ? estable.name : "ninguno"}`);
            return estable || null;
        }

        const estable = globalThis.state?.lastStableTheme;
        if (estable && estable.name !== voto.tema.name) {
            this._temaRacha = this._temaRacha?.name === voto.tema.name
                ? { name: voto.tema.name, n: this._temaRacha.n + 1 }
                : { name: voto.tema.name, n: 1 };
            if (this._temaRacha.n < FRAMES_PARA_CAMBIAR_TEMA) {
                console.log(`[VisionService] ${voto.tema.name} (${voto.afinidad.toFixed(3)}) ${this._temaRacha.n}/${FRAMES_PARA_CAMBIAR_TEMA} — se mantiene ${estable.name}`);
                return estable;
            }
        } else {
            this._temaRacha = null;
        }

        const { tema, actualR, actualG, actualB, afinidad } = voto;
        console.log(`[VisionService] Theme detected: ${tema.name} (afinidad: ${afinidad.toFixed(3)}, catalog: rgb(${tema.r},${tema.g},${tema.b}), actual: rgb(${actualR},${actualG},${actualB}))`);

        const result = { name: tema.name, r: tema.r, g: tema.g, b: tema.b, actualR, actualG, actualB };

        if (globalThis.state) {
            globalThis.state.lastStableTheme = result;
        }

        return result;
    },



    /** Find rows/cols of inventory items from theme pixel density projections. */
    detectInventoryGrid(mask, maskW, maskH) {
        const rowDensity = new Float32Array(maskH);
        for (let y = 0; y < maskH; y++)
            for (let x = 0; x < maskW; x++) rowDensity[y] += mask[y * maskW + x];

        const rowMax = Math.max(...rowDensity);
        if (rowMax < 10) return null;

        // min distance of 1/6.5 of the screen, so card details do not make duplicate row peaks
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

    /**
     * Name band crop in color (not binarized), scaled `S`x, for PaddleOCR.
     */
    cropColor(sourceCvs, sx, sy, sw, sh, S = 2) {
        const cvs = document.createElement("canvas");
        cvs.width = Math.round(sw * S); cvs.height = Math.round(sh * S);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        return cvs;
    },

    /** Otsu threshold over a 256-bin luma histogram and its total. */
    _otsuThreshold(hist, total) {
        let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, maxV = 0, thr = 0;
        for (let i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            const wF = total - wB; if (!wF) break;
            sumB += i * hist[i];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const v = wB * wF * (mB - mF) * (mB - mF);
            if (v > maxV) { maxV = v; thr = i; }
        }
        return thr;
    },

    /**
     * Quantity badge by brightness, not theme color: number and checkmark are the brightest thing in the
     * corner, and a raised Otsu threshold isolates them whole. The box fits the digit height so
     * segmentDigits keeps it. Returns black digits on white at 3x for readBadgeDigits.
     */
    extractBadgeBright(snapshot, cell, cellW, cellH) {
        const S = 3;
        // 0.62 leaves room for 3+ digits: at 0.40 the third digit fell outside
        const w = Math.round(cellW * 0.62), h = Math.round(cellH * 0.17);
        const sx = cell.sx, sy = Math.max(0, cell.sy + Math.round(cellH * 0.08));
        // recycled like the name crops: the caller reads its pixels right away
        const cvs = this._ringCanvas(w * S, h * S);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(snapshot, sx, sy, w, h, 0, 0, cvs.width, cvs.height);
        const im = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const px = im.data, N = px.length / 4;
        const lum = new Float32Array(N), hist = new Uint32Array(256);
        for (let i = 0; i < N; i++) {
            const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
            lum[i] = l; hist[Math.min(255, Math.max(0, Math.round(l)))]++;
        }
        const thr = Math.max(this._otsuThreshold(hist, N) + 15, 110);
        for (let i = 0; i < N; i++) {
            const v = lum[i] >= thr ? 0 : 255;
            px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
        }
        ctx.putImageData(im, 0, 0);
        return cvs;
    },

    // crop canvases recycled by size: the GC frees canvas backing stores slowly and each cell asks for
    // ~1.4 MB. Six per ring cover 2 OCR workers plus the debug overlay.
    _cropRings: new Map(),
    _ringCanvas(w, h) {
        const key = `${w}x${h}`;
        // 2-3 sizes in use, changing with the resolution: past 8 the index is rebuilt
        if (!this._cropRings.has(key) && this._cropRings.size >= 8) this._cropRings.clear();
        let ring = this._cropRings.get(key);
        if (!ring) {
            ring = { i: 0, cvs: [] };
            this._cropRings.set(key, ring);
        }
        let cvs = ring.cvs[ring.i];
        if (!cvs) {
            cvs = document.createElement("canvas");
            cvs.width = w; cvs.height = h;
            ring.cvs[ring.i] = cvs;
        }
        ring.i = (ring.i + 1) % 6;
        return cvs;
    },

    cropThemeBinarized(sourceCvs, sx, sy, sw, sh, theme, nameColorHint, scale) {
        const S = scale || CELL_UPSCALE;
        const cvs = this._ringCanvas(sw * S, sh * S);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const px = imgData.data;

        // Binarization by the auto-detected text color, theme independent: rejects item art of another
        // color. Measures (1) background = color mode, (2) text = mode of the pixels far from it, and
        // marks as ink only what is close to the text color.
        const QKEY = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const UNQ = (k) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];

        // (1) background = color mode
        COLOR_HIST.fill(0);
        let bgKey = 0, bgCount = -1;
        for (let i = 0; i < px.length; i += 4) {
            const key = QKEY(px[i], px[i + 1], px[i + 2]);
            const c = ++COLOR_HIST[key];
            if (c > bgCount) { bgCount = c; bgKey = key; }
        }
        const [bgR, bgG, bgB] = UNQ(bgKey);

        // (2) text color measured only in the bottom strip: the name sits at the bottom and item art enters
        // from the top
        const bgTolSq = 45 * 45;
        const txTolSq = 66 * 66;
        const cw = cvs.width, ch = cvs.height;
        const bandY0 = Math.floor(ch * 0.45); // bottom strip (~second name line)
        const bgLum = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;

        let txR, txG, txB;
        if (nameColorHint) {
            // page name color (voted over every cell): only checks this cell has enough ink of it
            [txR, txG, txB] = nameColorHint;
            const bandTotal = (ch - bandY0) * cw;
            // only whether there is enough ink: with a name it is reached in the first rows
            const needed = bandTotal * 0.008;
            let near = 0;
            for (let y = bandY0; y < ch && near < needed; y++) {
                for (let x = 0; x < cw; x++) {
                    const i = (y * cw + x) * 4;
                    const dr = px[i] - txR, dg = px[i + 1] - txG, db = px[i + 2] - txB;
                    if (dr * dr + dg * dg + db * db < txTolSq) near++;
                }
            }
            if (near < needed) {
                for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
                ctx.putImageData(imgData, 0, 0);
                return cvs;
            }
        } else {
            COLOR_HIST.fill(0);
            let bandTotal = 0, candidates = 0;
            for (let y = bandY0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                    bandTotal++;
                    const i = (y * cw + x) * 4;
                    const dr = px[i] - bgR, dg = px[i + 1] - bgG, db = px[i + 2] - bgB;
                    if (dr * dr + dg * dg + db * db <= bgTolSq) continue; // background
                    // same brightness bar as the ink below: a color the binarization drops cannot be the text
                    if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < bgLum + 12) continue;
                    candidates++;
                    COLOR_HIST[QKEY(px[i], px[i + 1], px[i + 2])]++;
                }
            }
            // no ink in the bottom strip (empty cell): all white
            if (!candidates || candidates < bandTotal * 0.01) {
                for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
                ctx.putImageData(imgData, 0, 0);
                return cvs;
            }
            const bins = [];
            for (let key = 0; key < COLOR_HIST.length; key++) {
                if (COLOR_HIST[key]) bins.push({ col: UNQ(key), count: COLOR_HIST[key] });
            }
            // not the mode: on a rescaled frame the stroke is mostly antialias. rampCoreColor returns its core
            // (utils/vision/name_color.js)
            const core = rampCoreColor(bins, [bgR, bgG, bgB]);
            if (!core) {
                for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255;
                ctx.putImageData(imgData, 0, 0);
                return cvs;
            }
            // snap to the exact theme name color (NAME_TEXT_COLORS) when close
            [txR, txG, txB] = snapToThemeTextColor(...core);
        }

        // ink = close to the text color, far from the background and bright enough over it
        for (let i = 0; i < px.length; i += 4) {
            const drBg = px[i] - bgR, dgBg = px[i + 1] - bgG, dbBg = px[i + 2] - bgB;
            if (drBg * drBg + dgBg * dgBg + dbBg * dbBg <= bgTolSq) {
                px[i] = px[i + 1] = px[i + 2] = 255;
                continue;
            }
            const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
            if (lum < bgLum + 12) {
                px[i] = px[i + 1] = px[i + 2] = 255;
                continue;
            }
            const dr = px[i] - txR, dg = px[i + 1] - txG, db = px[i + 2] - txB;
            const isText = dr * dr + dg * dg + db * db < txTolSq;
            px[i] = px[i + 1] = px[i + 2] = isText ? 0 : 255;
        }

        // despeckle: drops isolated 1x1 video compression dots
        const w = cvs.width, h = cvs.height;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                if (px[idx] === 0) {
                    if (px[idx - 4] === 255 && px[idx + 4] === 255 && px[idx - w * 4] === 255 && px[idx + w * 4] === 255) {
                        px[idx] = px[idx + 1] = px[idx + 2] = 255;
                    }
                }
            }
        }

        // keep only letters: on textured backgrounds the stars share the text color, but letters are tall
        // connected components. Small ones are erased unless they touch a text one (i/j dots, accents).
        const N = w * h;
        // reused buffers (2 x 1.4 MB per cell); safe because the function is synchronous
        const label = scratchLabels(N);
        const stack = scratchStack(N);
        // "is text" bar against the crop height (1-3 lines): at 3x a letter is 45-68 px of 426 and a
        // compression blob at most 7
        const H_TEXT = Math.max(12, Math.round(h * 0.06));
        const NEAR_Y = Math.round(h * 0.12);
        const comps = []; // { minX, maxX, minY, maxY, isText }
        for (let p = 0; p < N; p++) {
            if (px[p * 4] !== 0 || label[p] !== -1) continue;
            // 4-connected flood fill of the ink component starting at p
            let sp = 0; stack[sp++] = p; label[p] = comps.length;
            let minX = w, maxX = 0, minY = h, maxY = 0;
            while (sp > 0) {
                const q = stack[--sp];
                const qx = q % w, qy = (q / w) | 0;
                if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
                if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
                if (qx > 0 && px[(q - 1) * 4] === 0 && label[q - 1] === -1) { label[q - 1] = comps.length; stack[sp++] = q - 1; }
                if (qx < w - 1 && px[(q + 1) * 4] === 0 && label[q + 1] === -1) { label[q + 1] = comps.length; stack[sp++] = q + 1; }
                if (qy > 0 && px[(q - w) * 4] === 0 && label[q - w] === -1) { label[q - w] = comps.length; stack[sp++] = q - w; }
                if (qy < h - 1 && px[(q + w) * 4] === 0 && label[q + w] === -1) { label[q + w] = comps.length; stack[sp++] = q + w; }
            }
            comps.push({ minX, maxX, minY, maxY, isText: (maxY - minY + 1) >= H_TEXT });
        }
        const texts = comps.filter(c => c.isText);
        const keep = comps.map(c => {
            if (c.isText) return true;
            for (const t of texts) {
                const xOverlap = c.minX <= t.maxX && c.maxX >= t.minX;
                const yGap = c.maxY < t.minY ? t.minY - c.maxY : (c.minY > t.maxY ? c.minY - t.maxY : 0);
                if (xOverlap && yGap <= NEAR_Y) return true;
            }
            return false;
        });
        // no text component (pure art or noise): erase nothing and let the OCR return empty
        if (texts.length > 0) {
            for (let p = 0; p < N; p++) {
                if (px[p * 4] === 0 && !keep[label[p]]) {
                    px[p * 4] = px[p * 4 + 1] = px[p * 4 + 2] = 255;
                }
            }
        }

        // dynamic name band: keep only the bottom cluster of text lines and drop same colored art above a gap
        if (texts.length > 0) {
            const rowInk = new Int32Array(h);
            let maxRow = 0;
            for (let y = 0; y < h; y++) {
                let cnt = 0; const off = y * w * 4;
                for (let x = 0; x < w; x++) if (px[off + x * 4] === 0) cnt++;
                rowInk[y] = cnt;
                if (cnt > maxRow) maxRow = cnt;
            }
            const rowThr = Math.max(2, maxRow * 0.08);
            const maxGap = Math.round(h * 0.10); // art-to-name gap > gap between lines
            let bottom = -1, top = -1, gap = 0;
            for (let y = h - 1; y >= 0; y--) {
                if (rowInk[y] >= rowThr) { if (bottom < 0) bottom = y; top = y; gap = 0; }
                else if (bottom >= 0 && ++gap > maxGap) break;
            }
            if (top >= 0) {
                const pad = Math.round(h * 0.02);
                const y0 = Math.max(0, top - pad), y1 = Math.min(h - 1, bottom + pad);
                for (let y = 0; y < h; y++) {
                    if (y >= y0 && y <= y1) continue;
                    const off = y * w * 4;
                    for (let x = 0; x < w; x++) { const i = off + x * 4; px[i] = px[i + 1] = px[i + 2] = 255; }
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        return cvs;
    },

    /**
     * Name color candidates for a whole page, voted by its cells (rankPageNameColors): measuring every
     * cell breaks the art/name tie a single cell decides by luck.
     */
    pageNameColorCandidates(sourceCvs, cells, cellW, sy, sh, max) {
        const histograms = cells.map(cell =>
            bandInkHistogram(this._nameBandImageData(sourceCvs, cell.sx, cell.sy + sy, cellW, sh)));
        return rankPageNameColors(histograms, max);
    },

    // crops like cropThemeBinarized, so colors are measured on the pixels that get binarized
    _nameBandImageData(sourceCvs, sx, sy, sw, sh) {
        const S = CELL_UPSCALE;
        const cvs = this._ringCanvas(sw * S, sh * S);
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sourceCvs, sx, sy, sw, sh, 0, 0, cvs.width, cvs.height);
        return ctx.getImageData(0, 0, cvs.width, cvs.height);
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





    applyClusteringThreshold(ctx, w, h, theme) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = imgData.data;
        const PASO = 8; // one sample every two pixels
        const c1 = [0, 0, 0], c2 = theme ? [theme.actualR || theme.r, theme.actualG || theme.g, theme.actualB || theme.b] : [255, 255, 255];
        let minL = 255, maxL = 0;
        for (let i = 0; i < px.length; i += PASO) {
            const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (l < minL) { minL = l; c1[0] = px[i]; c1[1] = px[i + 1]; c1[2] = px[i + 2]; }
            if (!theme && l > maxL) { maxL = l; c2[0] = px[i]; c2[1] = px[i + 1]; c2[2] = px[i + 2]; }
        }
        for (let iter = 0; iter < 4; iter++) {
            let s1r = 0, s1g = 0, s1b = 0, s2r = 0, s2g = 0, s2b = 0, n1 = 0, n2 = 0;
            for (let i = 0; i < px.length; i += PASO) {
                const r = px[i], g = px[i + 1], b = px[i + 2];
                const d1 = Math.abs(r - c1[0]) + Math.abs(g - c1[1]) + Math.abs(b - c1[2]);
                const d2 = Math.abs(r - c2[0]) + Math.abs(g - c2[1]) + Math.abs(b - c2[2]);
                if (d1 < d2) { s1r += r; s1g += g; s1b += b; n1++; }
                else { s2r += r; s2g += g; s2b += b; n2++; }
            }
            if (n1 > 0) { c1[0] = s1r / n1; c1[1] = s1g / n1; c1[2] = s1b / n1; }
            if (n2 > 0) { c2[0] = s2r / n2; c2[1] = s2g / n2; c2[2] = s2b / n2; }
        }
        let l1 = 0.299 * c1[0] + 0.587 * c1[1] + 0.114 * c1[2], l2 = 0.299 * c2[0] + 0.587 * c2[1] + 0.114 * c2[2];
        let textC = l2 > l1 ? c2 : c1, bgC = l2 > l1 ? c1 : c2;
        let bgL = Math.min(l1, l2);
        for (let i = 0; i < px.length; i += 4) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            let dT = Math.abs(r - textC[0]) + Math.abs(g - textC[1]) + Math.abs(b - textC[2]);
            let dB = Math.abs(r - bgC[0]) + Math.abs(g - bgC[1]) + Math.abs(b - bgC[2]);
            let lum = 0.299 * r + 0.587 * g + 0.114 * b;
            // reject only what is very close to the background cluster or below it in brightness
            let isBgNoise = lum < bgL + 15 || dT >= dB * 1.05;
            px[i] = px[i + 1] = px[i + 2] = isBgNoise ? 255 : 0;
        }
        ctx.putImageData(imgData, 0, 0);
    },

    /**
     * Prepares canvas for relic selection detection (Right side of screen).
     */
    prepareRelicSelectionCanvas(video, scale) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        // starts where the grid ends (RELIC_GRID_CROP x 0.03 + w 0.57): at 0.5 the last grid column entered
        // and tracking picked that relic
        const rsCropX = Math.floor(width * 0.60);
        const rsCropY = Math.floor(height * 0.2);
        const rsCropW = width - rsCropX;
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
     * Releases the reward canvases: 0x0 frees the backing store (~4 MB at 1440p).
     */
    releaseRewardCanvases() {
        for (const cvs of [this._rewardCvs, this._rewardNamesCvs]) {
            if (cvs) { cvs.width = 0; cvs.height = 0; }
        }
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

    // filter ladder for the adaptive retry: LOW_LIGHT brightens dark photos, HIGH_GLARE lowers contrast
    // when glare burns the text
    prepareRewardOCRCanvas(video, width, height, scale, preset = "STANDARD", cropRect = null) {
        // cropRect from detectRewardBand: a webcam on an external monitor does not fill the frame; without
        // it, the fixed %
        const marginX = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
        const rCropY = cropRect ? Math.floor(cropRect.y) : Math.floor(height * 0.185);
        const rCropH = cropRect ? Math.floor(cropRect.h) : Math.floor(height * 0.255);
        const rCropXBase = cropRect ? Math.floor(cropRect.x) : 0;
        // inside the dark card bounds (Y 18.5% to 44%), trimming the empty sides
        const cropW = (cropRect ? cropRect.w : width) - marginX * 2;
        const targetW = Math.floor(cropW * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = this._rewardCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });

        ctx.drawImage(video, rCropXBase + marginX, rCropY, cropW, rCropH, 0, 0, targetW, targetH);
        maxChannelPreset(ctx, targetW, targetH, preset, WF_THEMES);
        return cvs;
    },

    // Same crop as prepareRewardOCRCanvas but isolates the name by color: in gray the player's UI color
    // blends with the gold art, so the dominant hue of saturated pixels is isolated. Owned/Crafted
    // come from the grayscale pass.
    prepareRewardNamesCanvas(video, width, height, scale, cropRect = null) {
        // same cropRect as prepareRewardOCRCanvas, so the word boxes share coordinates
        const marginX = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
        const rCropY = cropRect ? Math.floor(cropRect.y) : Math.floor(height * 0.185);
        const rCropH = cropRect ? Math.floor(cropRect.h) : Math.floor(height * 0.255);
        const rCropXBase = cropRect ? Math.floor(cropRect.x) : 0;
        const cropW = (cropRect ? cropRect.w : width) - marginX * 2;
        const targetW = Math.floor(cropW * scale);
        const targetH = Math.floor(rCropH * scale);

        const cvs = this._rewardNamesCvs;
        cvs.width = targetW;
        cvs.height = targetH;
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, rCropXBase + marginX, rCropY, cropW, rCropH, 0, 0, targetW, targetH);

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
            return [h, mx === 0 ? 0 : d / mx, mx]; // h, s, v in 0..1
        };

        // 1st pass: dominant hue of saturated, very bright pixels. A mission tint is saturated but of mid
        // brightness and covers most of the crop, so high v is required and huge bins are dropped.
        const totalPx = px.length / 4;
        const bins = new Array(36).fill(0);
        const hsum = new Array(36).fill(0);
        for (let i = 0; i < px.length; i += 4) {
            const [h, s, v] = toHSV(px[i], px[i + 1], px[i + 2]);
            if (v > 0.62 && s > 0.55) {
                const bi = Math.min(35, Math.floor(h * 36));
                bins[bi]++; hsum[bi] += h;
            }
        }
        // a mission tint covers large flat areas; name text never reaches ~18% of the crop
        const TINT_CAP = totalPx * 0.18;
        let peak = -1;
        for (let i = 0; i < 36; i++) {
            if (bins[i] > TINT_CAP) continue;
            if (peak < 0 || bins[i] > bins[peak]) peak = i;
        }
        const Hd = (peak >= 0 && bins[peak] >= 20) ? hsum[peak] / bins[peak] : null; // null = cream/light or tint only

        // 2nd pass: name text -> black, rest -> white. A hue mask denser than 22% is art or tint: falls back
        // to the neutral bright mask. buildMask writes over px, so later passes read `orig`.
        const orig = px.slice();
        const buildMask = (useHue, vMin = 0.78, sMax = 0.45) => {
            let textCount = 0;
            for (let i = 0; i < px.length; i += 4) {
                const [h, s, v] = toHSV(orig[i], orig[i + 1], orig[i + 2]);
                let isText;
                if (!useHue) {
                    isText = v > vMin && s < sMax;                 // bright text (cream/light, or tint rescue)
                } else {
                    let hd = Math.abs(h - Hd); if (hd > 0.5) hd = 1 - hd;
                    isText = v > 0.30 && s > 0.45 && hd < 0.125;   // ~±45°: saturated theme colored text
                }
                px[i] = px[i + 1] = px[i + 2] = isText ? 0 : 255;
                if (isText) textCount++;
            }
            return textCount / totalPx;
        };
        // mask ladder: theme hue -> loose neutral -> strict neutral. Real text never goes over ~6% of the crop.
        let density = buildMask(Hd !== null);
        if (Hd !== null && density > 0.22) density = buildMask(false); // the hue picked tint or art: redo neutral
        if (density > 0.10) density = buildMask(false, 0.85, 0.28);    // loose neutral caught tinted background: strict
        // if not even the strict mask isolates letters the pass only adds garbage words: null skips it.
        // Density does not tell text apart, so the mask most like text wins (ink_runs.js).
        const tramosPorTinta = (d) => inkRunRatio(d, targetW, targetH);
        const escalera = px.slice();
        img.data.set(orig);
        const tintaTema = themeTextMask(img, WF_THEMES);
        if (tramosPorTinta(escalera) >= tramosPorTinta(px)) {
            img.data.set(escalera);
        } else {
            density = tintaTema / totalPx;
        }
        if (density > 0.10) return null;
        ctx.putImageData(img, 0, 0);
        return cvs;
    },

    /**
     * Converts RGB [0-255] to HSV [H: 0-360, S: 0-100, V: 0-100].
     */
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

    // The Kuva reroll screen shows one centered card or two side by side; this wide band holds either
    // layout and prepareRivenCardCanvases splits it.
    RIVEN_CARD_CROP: { x: 0.13, y: 0.50, w: 0.74, h: 0.40 },
    // "Item Details" popup of a linked riven: one card, centered and higher than the reroll
    RIVEN_ITEM_DETAILS_CROP: { x: 0.33, y: 0.30, w: 0.34, h: 0.40 },

    // cheap pixel test for the linked riven popup (no header): counts lavender (#ac83d5) pixels in a
    // fixed rect at 64x36 before paying for OCR
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
        // ~2300 samples; card text takes a small but steady share of the rect
        return lavender >= 25;
    },


    // dual binarization in one pass: bright and dim masks share luma, moving average and color class,
    // byte identical to two _binarizeRivenText passes
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

    // Returns an array of 1-2 binarized, tightly-cropped card canvases (left-to-right).
    prepareRivenCardCanvases(video, scale, crop) {
        const width = video.videoWidth || video.width || 1920;
        const height = video.videoHeight || video.height || 1080;

        const C = crop || this.RIVEN_CARD_CROP;
        const cropX = Math.floor(width * C.x);
        const cropW = Math.floor(width * C.w);
        const cropY = Math.floor(height * C.y);
        const cropH = Math.floor(height * C.h);

        // S=1.5: text ends ~25 px tall, Tesseract's sweet spot
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

        // segmentation: column profile of glyph height runs (art makes tall blobs or 1-2 px dots), center
        // card by bright mass, split at an inner valley when too wide for one card, side card by
        // subtracting the center from the dim profile
        const rawData = ctx.getImageData(0, 0, targetW, targetH);
        const statsZoneStart = Math.floor(targetH * 0.38); // skips the decorative arrow on top
        const minClusterW = Math.floor(targetW * 0.06);    // the side roll is shrunk and narrow
        const gapTol = Math.floor(targetW * 0.045);
        const runLo = Math.max(3, Math.round(targetH * 0.0046)); // ~4px at tH 864
        const runHi = Math.round(targetH * 0.046);               // ~40px at tH 864

        // vertical glyph height runs [runLo, runHi] per column
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

        // a card takes at most ~32% of the band: a wider cluster is two cards, split at a real inner valley
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

        // buffers reused across scans, reallocated only on size change
        if (!this._brightBuf || this._brightBuf.length !== rawData.data.length) {
            this._brightBuf = new Uint8ClampedArray(rawData.data.length);
            this._dimBuf = new Uint8ClampedArray(rawData.data.length);
        }
        const brightPx = this._brightBuf;
        const dimPx = this._dimBuf;
        this._binarizeRivenTextDual(rawData.data, brightPx, dimPx, targetW, targetH);

        const bruns = glyphRunsPerCol(brightPx);
        const druns = glyphRunsPerCol(dimPx);

        // per range mask: bright where bright text dominates (new card)
        const maskFor = (rg) => (mass(bruns, rg) >= 0.55 * mass(druns, rg) ? brightPx : dimPx);

        const plan = [];
        const bclusters = clusterRanges(bruns);
        if (!bclusters.length) {
            // no bright card: dim clusters (valley split), at most 2
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
                // side card by subtraction: drop the center columns from the dim profile; the heaviest remaining
                // cluster is the old card
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
                plan.sort((a, b) => a.range[0] - b.range[0]); // left to right
            }
        }

        const pad = Math.floor(6 * scale);
        const out = [];
        for (const { range, binPx } of plan) {
            const [cx0, cx1] = range;
            // row tighten on this card's own binary
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
            // drops crops too small to be a card, relative to the working size
            if (bw < Math.max(40, targetW * 0.05) || bh < Math.max(30, targetH * 0.05)) continue;

            ctx.putImageData(new ImageData(binPx, targetW, targetH), 0, 0);
            // output canvases reused (max 2): the consumer uses them synchronously in the same scan
            if (!this._rivenOutCvs) this._rivenOutCvs = [];
            let oc = this._rivenOutCvs[out.length];
            if (!oc) { oc = document.createElement("canvas"); this._rivenOutCvs[out.length] = oc; }
            oc.width = bw;
            oc.height = bh;
            oc.getContext("2d").putImageData(ctx.getImageData(bx0, by0, bw, bh), 0, 0);
            out.push(oc);
        }

        // debug: globalThis.dumpRivenCrops = true shows the crops the OCR gets
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

    /**
     * Determines the UI context from OCR'd header text.
     */
    determineContext(headerText) {
        const text = headerText.toUpperCase();
        
        // Match INVENTORY and MODS even with OCR character substitutions
        const hasInv = /INVEN|TORY|1NVENT|INV|VENT|SELL|TARIO/.test(text);
        // also a pattern anchored after the header "/": OCR turns MODS into "NDDS", and the position keeps it
        // apart from "/SELL"
        const hasMods = /MODS|MOD|M0DS|MOOS|MDDS|MDS|M0D5|M0D|MOO|MD|FICADORES|AGRIETADO|KUVA|KUYVA|CICLO|CICLAR|ATRIBU/.test(text) ||
            /\/\s*[MNHW][O0DQC][DO0B][S5$]/.test(text);

        // first: its crop is the centered title and shares no words with the rest
        if (/M[I1L]SS?[I1L]ON\s*C[O0Q]MP|MIS[I1L][OÓ]N\s*C[O0Q]MPLET/.test(text)) return "MISSION_COMPLETE";

        if (/DETAIL|DETALL/.test(text)) return "ITEM_DETAILS"; // "Item Details" popup (linked riven, centered)
        if (hasMods) return "INVENTORY_MODS";
        if (hasInv) return "INVENTORY";
        if (/RELI|ELIC|REFI|NEME/.test(text)) return "RELICS";
        // only REWARDS: VOID and FISSURE also show on the star chart fissure list
        if (/REWA|WARD|ARDS/.test(text)) return "REWARD";
        return "UNKNOWN";
    },

    /**
     * Grid autodetection without manual calibration (grid_detect.js): returns calibData in the saved
     * calibration format, or null without confidence.
     */
    detectGridAutoCalib(snapshot, width, height) {
        try {
            const cvs = this._themeCvs;
            cvs.width = width; cvs.height = height;
            const ctx = cvs.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(snapshot, 0, 0, width, height);
            const img = ctx.getImageData(0, 0, width, height);
            const trace = {};
            const calib = detectInventoryGrid(img, { trace });
            // to check the phase before reading (grid_alignment.js), also with no grid, when another page's is
            // inherited
            this.ultimasBandas = trace.bands || null;
            if (calib) {
                console.log(`[VisionService] Auto-grid SIN calibración: ${calib.rows}r × ${calib.cols}c cellW=${calib.cellW} cellH=${calib.cellH} conf=${calib.confidence.toFixed(2)}`, calib.gridZone);
                // trace on success too: a plausible but misanchored geometry only shows in the bands
                console.log("[VisionService] Auto-grid traza:", JSON.stringify(trace));
                // attached so the debug overlay prints it
                calib.traceSummary = trace;
            } else {
                // why there was no detection this frame
                console.warn("[VisionService] Auto-grid sin señal:", trace.fail || "?", JSON.stringify(trace));
            }
            return calib;
        } catch (e) {
            console.warn("[VisionService] detectGridAutoCalib falló:", e);
            return null;
        }
    },

     buildAutoGrid(snapshot, gridZone, theme, calibData) {
        // manual or saved grid dimensions win
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

        // ultra-wide screens show more columns: the count comes from the zone aspect ratio
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

    /**
     * Row offset against the calibrated grid when the game clamps the scroll at the end of the list.
     */
    detectRowPhase() {
        // disabled: edge density could not tell name text from card art, and grid_detect.js already anchors
        // the rows on the name baseline
        return 0;
    },

    // applies detectRowPhase to a new grid and drops the cells left outside the frame
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

    /**
     * Quantity badge from the top-left of an inventory cell, by theme color clustering.
     */
    extractBadgeByColor(snapshot, cell, cellW, cellH, theme) {
        // badge search window: 0.50 fits three digits and _badgeToQty drops values >= 1000. A wider one let
        // a big white helmet take the K-means ink group.
        const safeW = Math.min(cellW, Math.round(cellW * 0.50));
        // start higher so the top of 6, 7 and 5 is not clipped; relative to cellH
        const padTop = Math.max(6, Math.round(cellH * 0.04));
        const startY = Math.max(0, cell.sy - padTop);
        const safeH = Math.round(cellH * 0.25) + padTop;

        // reused canvas: this runs per cell
        const tempCvs = this._tempBadgeCvs;
        // setting width/height reallocates the buffer even with the same value
        if (tempCvs.width !== safeW) tempCvs.width = safeW;
        if (tempCvs.height !== safeH) tempCvs.height = safeH;
        const tCtx = tempCvs.getContext("2d", { willReadFrequently: true });
        tCtx.drawImage(snapshot, cell.sx, startY, safeW, safeH, 0, 0, safeW, safeH);

        // source luma before binarizing: the faint blueprint pattern is dropped later by brightness
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

        // a stack, not a queue with shift(): only the pixel set matters, not the order
        if (!this._pilaBadge || this._pilaBadge.length < safeW * safeH) {
            this._pilaBadge = new Int32Array(safeW * safeH);
        }
        const pila = this._pilaBadge;

        for (let y = 0; y < safeH; y++) {
            for (let x = 0; x < safeW; x++) {
                const idx = y * safeW + x;
                if (px[idx * 4] === 0 && !visited[idx]) {
                    const compPixels = [];
                    let sp = 0;
                    pila[sp++] = idx;
                    visited[idx] = 1;
                    let minX = x, maxX = x, minY = y, maxY = y;

                    while (sp > 0) {
                        const current = pila[--sp];
                        compPixels.push(current);
                        const cx = current % safeW;
                        const cy = (current - cx) / safeW;

                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;

                        const x0 = cx > 0 ? cx - 1 : 0;
                        const x1 = cx < safeW - 1 ? cx + 1 : safeW - 1;
                        const y0 = cy > 0 ? cy - 1 : 0;
                        const y1 = cy < safeH - 1 ? cy + 1 : safeH - 1;
                        for (let ny = y0; ny <= y1; ny++) {
                            for (let nx = x0; nx <= x1; nx++) {
                                const n = ny * safeW + nx;
                                if (n !== current && px[n * 4] === 0 && !visited[n]) {
                                    visited[n] = 1;
                                    pila[sp++] = n;
                                }
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

        // erase horizontal border lines (selection box) to break merge bridges; thresholds relative to safeH
        const lineMinW = Math.max(6, safeH * 0.22);
        const lineMaxH = Math.max(2, safeH * 0.04);
        for (const comp of components) {
            if (comp.width > lineMinW && comp.height <= lineMaxH) {
                for (const pixelIdx of comp.pixels) {
                    px[pixelIdx * 4] = 255;
                    px[pixelIdx * 4 + 1] = 255;
                    px[pixelIdx * 4 + 2] = 255;
                }
                comp.erased = true;
            }
        }

        // which components are the number: anchored on the checkmark (utils/vision/badge_anchor.js)
        const elegidos = new Set(digitosPorAncla(components, safeW, safeH));
        for (let i = 0; i < components.length; i++) {
            if (elegidos.has(i)) continue;
            const comp = components[i];
            if (comp.erased) continue;
            for (const pixelIdx of comp.pixels) {
                px[pixelIdx * 4] = 255;
                px[pixelIdx * 4 + 1] = 255;
                px[pixelIdx * 4 + 2] = 255;
            }
            comp.erased = true;
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

        // absolute margin on purpose: segmentDigits recomputes each box, so it only changes the debug crop
        const padX = 8;
        const padY = 6;
        const cropStartX = Math.max(0, digitMinX - padX);
        const cropStartY = Math.max(0, digitMinY - padY);
        const cropEndX = Math.min(safeW - 1, digitMaxX + padX);
        const cropEndY = Math.min(safeH - 1, digitMaxY + padY);

        const digitW = cropEndX - cropStartX + 1;
        const digitH = cropEndY - cropStartY + 1;

        const SCALE = 4;
        // neither shared nor ringed: the badge is returned, some callers collect several, and its size
        // changes per cell
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

    /**
     * 6/9 disambiguation for badge digits: the glyphs only differ in where the closed loop is (bottom = 6,
     * top = 9). Takes the binarized badge and the OCR digits; changes nothing if blobs do not map 1:1.
     */
    disambiguate69(badgeCvs, digits) {
        if (!/[69]/.test(digits)) return digits;
        const w = badgeCvs.width, h = badgeCvs.height;
        const ctx = badgeCvs.getContext("2d", { willReadFrequently: true });
        const px = ctx.getImageData(0, 0, w, h).data;
        const isBlack = (i) => px[i * 4] === 0;

        // label black blobs (digits) with a pointer BFS
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

        // only digit shaped blobs, left to right, mapping 1:1 with the string
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

            // flood white from the bbox edge: unvisited white inside is the closed loop
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
            // no clear loop (broken or filled glyph): keep what the OCR said
            if (holeArea < bh) { out += ch; continue; }

            const holeCy = holeYSum / holeArea;
            const centerY = (b.minY + b.maxY) / 2;
            // conservative: only flip when the loop is clearly above or below (>15%); near the center it is
            // ambiguous and the consensus decides
            const margin = bh * 0.15;
            if (holeCy > centerY + margin) out += "6";
            else if (holeCy < centerY - margin) out += "9";
            else out += ch;
        }
        return out;
    },
};
