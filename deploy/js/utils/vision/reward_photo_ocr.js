import { rawWords as palabrasCrudas } from "./ocr_words.js";

// longest side the image is normalized to before OCR
const MAX_SIDE = 1800;

const SCOUT_SIDE = 1500;

const PADDLE_SIDE = 1400;


// below this sharpness the image is washed out and edges are enhanced first
const BLUR_THRESHOLD = 9.5;

// fallback crops [top, bottom] as a fraction of the height, tight to wide; the one reading the most
// rewards wins
const ROI_MARGINS = [
    [0.20, 0.08],
    [0.32, 0.14],
    [0.45, 0.20],
];

const cleanToken = (t) => t.replace(/[^A-Za-z]/g, "").toUpperCase();

function fitSize(w, h, maxSide) {
    const k = maxSide / Math.max(w, h);
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// complementary preprocessings: each rescues rewards the others miss, so their results are MERGED
const MAIN_PASSES = [
    { name: "gray", filter: "grayscale(100%)", cvMode: null },
    { name: "cvsoft", filter: null, cvMode: "soft" },
    { name: "graycontrast", filter: "grayscale(100%) contrast(160%)", cvMode: null },
    { name: "unsharp", filter: "grayscale(100%)", cvMode: null, unsharp: true },
];

/** Edge enhancement by unsharp mask. A fixed [-1..9..-1] kernel raises numeric sharpness but ruins the OCR. */
function applyUnsharp(canvas, engine) {
    if (!engine?.isReady || typeof cv === "undefined") return;
    let src = null, blurred = null, out = null;
    try {
        src = cv.imread(canvas);
        blurred = new cv.Mat();
        out = new cv.Mat();
        cv.GaussianBlur(src, blurred, new cv.Size(0, 0), 2.0);
        cv.addWeighted(src, 2.2, blurred, -1.2, 0, out);
        cv.imshow(canvas, out);
    } catch {
    } finally {
        src?.delete();
        blurred?.delete();
        out?.delete();
    }
}

/** Scout preprocessings, cheapest first, until the anchor shows up. Gray alone fails with a saturated tint. */
const SCOUT_PASSES = [
    { name: "gray", filter: "grayscale(100%)", cvMode: null },
    { name: "graycontrast", filter: "grayscale(100%) contrast(160%)", cvMode: null },
    { name: "cvsoft", filter: null, cvMode: "soft" },
];

/**
 * Rough sharpness: mean |Δluma| between neighbour pixels on a 160 px thumbnail. Only for comparing frames
 * of the same burst.
 */
export function frameSharpness(source) {
    const W = source.naturalWidth || source.videoWidth || source.width;
    const H = source.naturalHeight || source.videoHeight || source.height;
    if (!W || !H) return 0;
    const tw = 160, th = Math.max(1, Math.round((H / W) * 160));
    const cvs = document.createElement("canvas");
    cvs.width = tw; cvs.height = th;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, tw, th);
    const d = ctx.getImageData(0, 0, tw, th).data;
    let sum = 0, n = 0;
    for (let y = 0; y < th; y++) {
        for (let x = 1; x < tw; x++) {
            const i = (y * tw + x) * 4, j = i - 4;
            const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            sum += Math.abs(a - b);
            n++;
        }
    }
    return n ? sum / n : 0;
}

function drawTo(src, sx, sy, sw, sh, tw, th, pass, engine) {
    const cvs = document.createElement("canvas");
    cvs.width = tw; cvs.height = th;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    if (pass.filter) ctx.filter = pass.filter;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    ctx.filter = "none";
    if (pass.unsharp) applyUnsharp(cvs, engine);
    if (pass.cvMode && engine?.isReady) engine.processForOCR(cvs, pass.cvMode);
    return cvs;
}

/**
 * Column grid filter: the cards are evenly spaced, so their X form an arithmetic progression and whatever
 * falls off it is an OCR false positive. With ≤2 items they are returned as is.
 */
export function filterByColumns(items) {
    if (items.length <= 2) return { kept: [...items], pitch: null };

    const xs = items.map((i) => i.xFrac);
    let best = null;

    for (let a = 0; a < xs.length; a++) {
        for (let b = a + 1; b < xs.length; b++) {
            const pitch = xs[b] - xs[a];
            if (pitch < 0.07 || pitch > 0.35) continue;

            for (const origin of xs) {
                const byColumn = new Map();
                for (const it of items) {
                    const k = Math.round((it.xFrac - origin) / pitch);
                    // tolerance relative to the step: absorbs the photo tilt
                    if (Math.abs(it.xFrac - (origin + k * pitch)) > pitch * 0.22) continue;
                    const prev = byColumn.get(k);
                    if (!prev || (it.ratio ?? 0) > (prev.ratio ?? 0)) byColumn.set(k, it);
                }
                const kept = [...byColumn.values()];
                // priorities: items kept > empty columns (penalizes the double step) > sum of ratios
                const ks = kept.map((it) => Math.round((it.xFrac - origin) / pitch));
                const span = ks.length ? Math.max(...ks) - Math.min(...ks) + 1 : 0;
                const holes = span - kept.length;
                const ratioSum = kept.reduce((s, it) => s + (it.ratio ?? 0), 0);
                const score = kept.length * 1000 - holes * 100 + ratioSum;
                if (!best || score > best.score) best = { score, pitch, kept };
            }
        }
    }

    if (!best) return { kept: [...items], pitch: null };
    return { kept: best.kept.sort((p, q) => p.xFrac - q.xFrac), pitch: best.pitch };
}

/**
 * Reassigns the quantity badges ("N Owned") to their reward. The badge sits at the corner of its card while
 * the name is centered, so it can be closer to the NEIGHBOUR name: each badge belongs to the column whose
 * width it falls in, not to the nearest name.
 */
export function assignBadges(items, pitch, words, imageW, nameRowY) {
    if (!items.length || !pitch || !words?.length || !nameRowY) return items;

    // badges sit ABOVE the name row; below are the squad "+5" and the HUD counters
    const numbers = words
        .filter((w) => /^\d{1,3}$/.test(w.text.trim()) && parseInt(w.text, 10) > 0)
        .map((w) => ({
            value: parseInt(w.text, 10),
            xFrac: (w.bbox.x0 + w.bbox.x1) / 2 / imageW,
            y: w.bbox.y1,
        }))
        .filter((n) => n.y < nameRowY);
    if (!numbers.length) return items;

    return items.map((it) => {
        if (it.owned || it.crafted) return it;
        // the badge is on the LEFT edge of its card: look from half a step to the left up to a bit right of the
        // name, same rule for every card so two never claim the same number
        const claim = (item, n) => {
            const rel = n.xFrac - item.xFrac;
            return rel >= -pitch * 0.55 && rel <= pitch * 0.15 ? Math.abs(rel + pitch * 0.2) : Infinity;
        };
        const mine = numbers
            .map((n) => ({ n, d: claim(it, n) }))
            .filter(({ n, d }) => d !== Infinity &&
                !items.some((other) => other !== it && claim(other, n) < d))
            .sort((a, b) => a.d - b.d);
        return mine.length ? { ...it, owned: mine[0].n.value } : it;
    });
}

/**
 * Text tilt measured IN THE IMAGE, not with the gyroscope: what hurts the OCR is the angle to the SCREEN,
 * not to gravity. Linear regression over the centers of the "PRIME" in the name row.
 *
 * Returns degrees (negative = row falling to the right) or null with no anchors.
 */
export function measureTextSkew(words) {
    // only the "PRIME": mixing rows (HUD, squad names) makes the regression invent an angle
    const pts = words
        .filter((w) => cleanToken(w.text) === "PRIME")
        .map((w) => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 }));
    if (pts.length < 3) return null;

    const n = pts.length;
    const mx = pts.reduce((acc, p) => acc + p.x, 0) / n;
    const my = pts.reduce((acc, p) => acc + p.y, 0) / n;
    const num = pts.reduce((acc, p) => acc + (p.x - mx) * (p.y - my), 0);
    const den = pts.reduce((acc, p) => acc + (p.x - mx) ** 2, 0);
    if (!den) return null;
    return Math.atan(num / den) * 180 / Math.PI;
}

/**
 * Finds the name row using "PRIME" as anchor: it is in almost every reward, always on that row, and never
 * in the HUD or the squad names. Returns { y, count } of the busiest row, or null with no anchor.
 */
export function findNameRowY(words, bucketSize = 0.02) {
    const buckets = new Map();
    for (const w of words) {
        if (cleanToken(w.text) !== "PRIME") continue;
        const key = Math.round(w.cy / bucketSize);
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let bestKey = null, bestCount = 0;
    for (const [key, count] of buckets) {
        if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    return bestKey === null ? null : { y: bestKey * bucketSize, count: bestCount };
}

/**
 * Reads the rewards from an image (HTMLImageElement, canvas or video).
 *
 * @param {CanvasImageSource & {naturalWidth?:number,videoWidth?:number,width?:number}} source
 * @param {object} deps - { ocrRepository, ocrService, opencvEngine }
 * @param {(label:string, pct:number)=>void} [onProgress]
 * @param {{skipIfNoAnchor?: boolean}} [opts] - skipIfNoAnchor: give up as soon as there is no anchor instead
 *        of falling back to whole image OCR (useful in a burst).
 * @returns {Promise<{items:Array, roi:object, ms:number, trace:string[]}>}
 */
export async function scanRewardPhoto(source, deps, onProgress, opts = {}) {
    const { ocrRepository, ocrService, opencvEngine, paddleRepository } = deps;
    const t0 = performance.now();
    const trace = [];
    const progress = (label, pct) => { if (onProgress) onProgress(label, pct); };

    const W = source.naturalWidth || source.videoWidth || source.width;
    const H = source.naturalHeight || source.videoHeight || source.height;
    if (!W || !H) return { items: [], roi: null, ms: 0, trace: ["fuente sin dimensiones"] };

    // fast path: PaddleOCR finds the text by itself over the whole image in one pass (no scout, crops or
    // preprocessings). If it fails or does not get the 4, the Tesseract path below goes on
    if (paddleRepository && !opts.skipPaddle) {
        try {
            progress(null, 40);
            const [tw, th] = fitSize(W, H, PADDLE_SIDE);
            const cvs = drawTo(source, 0, 0, W, H, tw, th, { filter: null }, opencvEngine);
            const words = await paddleRepository.recognizeWordsWithBoxes(cvs);
            const items = ocrService.parseRewards({ words, imageW: cvs.width })
                .filter((it) => typeof it.xPos === "number")
                .map((it) => ({ ...it, xFrac: it.xPos / cvs.width, from: "paddle" }));
            const skew = measureTextSkew(words);
            const { kept, pitch } = filterByColumns(items.sort((a, b) => a.xFrac - b.xFrac));
            trace.push(`paddle: ${items.length} → ${kept.length} (paso ${pitch ? pitch.toFixed(3) : "n/d"})`);
            if (kept.length >= 2) {
                // Y of the name row: median of the "PRIME" words. Ceiling that tells badges (above) from the rest
                const primeYs = words
                    .filter((w) => cleanToken(w.text) === "PRIME")
                    .map((w) => w.bbox.y0)
                    .sort((a, b) => a - b);
                const nameRowY = primeYs.length ? primeYs[Math.floor(primeYs.length / 2)] : 0;
                const withBadges = assignBadges(kept, pitch, words, cvs.width, nameRowY);
                return {
                    items: withBadges.map((it) => ({ ...it, xPos: it.xFrac * W })),
                    roi: { x: 0, y: 0, w: W, h: H, auto: false },
                    debugCanvas: cvs,
                    ms: Math.round(performance.now() - t0),
                    trace,
                    skew,
                    engine: "paddle",
                };
            }
        } catch (e) {
            trace.push(`paddle no disponible: ${String(e).slice(0, 60)}`);
        }
    }

    const runPasses = async (sx, sy, sw, sh, maxSide, passes) => {
        const [tw, th] = fitSize(sw, sh, maxSide);
        return Promise.all(passes.map(async (p, i) => {
            const cvs = drawTo(source, sx, sy, sw, sh, tw, th, p, opencvEngine);
            const worker = ocrRepository.workers[i % ocrRepository.workers.length] || ocrRepository.workers[0];
            const { data } = await ocrRepository.recognize(worker, cvs, {}, { blocks: true });
            const rawWords = palabrasCrudas(data);
            return {
                pass: p.name,
                width: cvs.width,
                canvas: cvs,
                items: ocrService.parseRewards({ words: rawWords, imageW: cvs.width }),
                words: rawWords.map((w) => ({
                    text: w.text,
                    cy: (w.bbox.y0 + w.bbox.y1) / 2 / cvs.height,
                    cx: (w.bbox.x0 + w.bbox.x1) / 2 / cvs.width,
                    hFrac: (w.bbox.y1 - w.bbox.y0) / cvs.height,
                })),
            };
        }));
    };

    progress(null, 20);
    let row = null, scoutPass = null, scoutResult = null;
    for (const pass of SCOUT_PASSES) {
        const scout = await runPasses(0, 0, W, H, SCOUT_SIDE, [pass]);
        row = findNameRowY(scout.flatMap((p) => p.words));
        scoutPass = pass.name;
        scoutResult = scout[0];
        // with 2+ hits the row is reliable; 1 is a last resort
        if (row && row.count >= 2) break;
    }
    trace.push(row ? `ancla PRIME y=${row.y.toFixed(3)} (${row.count}, ${scoutPass})` : "sin ancla PRIME");

    // the scout already OCRed the whole image: if the 4 come out of it, nothing else is needed
    if (scoutResult) {
        const merged = new Map();
        for (const it of scoutResult.items) {
            if (typeof it.xPos !== "number") continue;
            merged.set(it.name, { ...it, xFrac: it.xPos / scoutResult.width, from: `scout:${scoutPass}` });
        }
        const early = filterByColumns([...merged.values()].sort((a, b) => a.xFrac - b.xFrac));
        if (early.kept.length >= 4) {
            trace.push(`atajo: el scout ya leyó ${early.kept.length}`);
            return {
                items: early.kept.map((it) => ({ ...it, xPos: it.xFrac * W })),
                roi: { x: 0, y: 0, w: W, h: H, auto: false },
                debugCanvas: scoutResult.canvas,
                ms: Math.round(performance.now() - t0),
                trace,
            };
        }
    }

    // no anchor leaves only whole image OCR (slow); in a burst the next frame is better
    if (!row && opts.skipIfNoAnchor) {
        return { items: [], roi: null, ms: Math.round(performance.now() - t0), trace, skipped: true };
    }

    await ocrRepository.ensureSecondWorker?.().catch(() => {});

    const candidateRois = [];
    if (row && scoutResult) {
        // ROI from what the scout measured: the letter height gives the real UI scale, so a crop in "line heights"
        // fits any screen, distance and resolution
        const rowWords = scoutResult.words.filter((w) => Math.abs(w.cy - row.y) < 0.03);
        const heights = rowWords.map((w) => w.hFrac).filter((h) => h > 0).sort((a, b) => a - b);
        const lineH = heights.length ? heights[Math.floor(heights.length / 2)] : 0.02;

        // ~9 line heights above (art + badge) and ~3 below. Wider spreads the same 1800 px over more surface
        // and the text loses sharpness
        const yTop = Math.max(0, Math.round((row.y - lineH * 9) * H));
        const yBot = Math.min(H, Math.round((row.y + lineH * 3) * H));

        const xs = rowWords.map((w) => w.cx);
        let x0 = 0, x1 = W;
        if (xs.length >= 2) {
            const pad = 0.06; // room on the sides: the longest name can go past the seen range
            x0 = Math.max(0, Math.round((Math.min(...xs) - pad) * W));
            x1 = Math.min(W, Math.round((Math.max(...xs) + pad) * W));
        }
        if (yBot - yTop > H * 0.04 && x1 - x0 > W * 0.3) {
            candidateRois.push({ x: x0, y: yTop, w: x1 - x0, h: yBot - yTop, auto: true, up: lineH * 9, down: lineH * 3 });
        }
    }
    // fallback: wider margins (a three line name starts higher) and, last, the whole image
    if (row) {
        for (const [up, down] of ROI_MARGINS) {
            const yTop = Math.max(0, Math.round((row.y - up) * H));
            const yBot = Math.min(H, Math.round((row.y + down) * H));
            if (yBot - yTop > H * 0.08) candidateRois.push({ x: 0, y: yTop, w: W, h: yBot - yTop, auto: true, up, down });
        }
    }
    candidateRois.push({ x: 0, y: 0, w: W, h: H, auto: false });

    // a washed out photo gets edge enhancement first; otherwise the preprocessing that found the anchor leads
    const blurry = frameSharpness(source) < BLUR_THRESHOLD;
    const preferred = blurry ? "unsharp" : scoutPass;
    const ordered = [...MAIN_PASSES].sort((a, b) => (b.name === preferred) - (a.name === preferred));
    if (blurry) trace.push("imagen poco nítida: se realzan bordes primero");

    // serial, stopping at 4: parallel saturated the workers
    const evaluate = async (cand, passesToRun) => {
        const passes = await runPasses(cand.x, cand.y, cand.w, cand.h, MAX_SIDE, passesToRun);
        const merged = new Map();
        for (const p of passes) {
            for (const it of p.items) {
                if (typeof it.xPos !== "number") continue;
                // width fraction: passes can have different resolutions
                const c = { ...it, xFrac: it.xPos / p.width, from: p.pass };
                const prev = merged.get(it.name);
                if (!prev || (it.ratio ?? 0) > (prev.ratio ?? 0)) merged.set(it.name, c);
            }
        }
        const union = [...merged.values()].sort((a, b) => a.xFrac - b.xFrac);
        const { kept, pitch } = filterByColumns(union);
        const label = cand.auto ? `${cand.up.toFixed(2)}/${cand.down.toFixed(2)}` : "completa";
        trace.push(`roi ${label} (y=${cand.y} h=${cand.h}): unión ${union.length} → ${kept.length}`);
        return { roi: cand, kept, pitch, passes };
    };

    // as many simultaneous passes as workers: asking for more only queues them
    const workerCount = Math.max(1, ocrRepository.workers?.length || 1);
    const activePasses = ordered.slice(0, workerCount);

    let best = null;
    for (const [idx, cand] of candidateRois.entries()) {
        progress(null, 45 + idx * 12);
        const r = await evaluate(cand, activePasses);
        if (!best || r.kept.length > best.kept.length) best = r;
        if (best.kept.length >= 4) break; // the screen never shows more than 4
    }

    const { roi, kept, pitch, passes } = best;
    trace.push(`elegido: y=${roi.y} h=${roi.h} · paso=${pitch ? pitch.toFixed(3) : "n/d"} · ${kept.length} recompensas`);

    // xPos in original image coordinates: whoever paints badges does not know the ROI
    const items = kept.map((it) => ({ ...it, xPos: roi.x + it.xFrac * roi.w }));

    return {
        items,
        roi,
        debugCanvas: passes[0]?.canvas || null,
        ms: Math.round(performance.now() - t0),
        trace,
    };
}

/**
 * Scans a burst of frames and merges by CONSENSUS (an item gets in if it shows in 2+ frames): a blurred
 * frame does not ruin the shot and false positives, which rarely repeat, stay out.
 *
 * @param {() => (CanvasImageSource|null)} grabFrame - grabs a new frame
 * @param {object} deps - same as scanRewardPhoto
 * @param {object} [opts] - { frames = 3, delayMs = 120, budgetMs = 6000, onProgress }
 */
export async function scanRewardBurst(grabFrame, deps, opts = {}) {
    const { frames = 3, delayMs = 120, budgetMs = 6000, onProgress } = opts;
    const t0 = performance.now();
    const trace = [];
    const perFrame = [];

    // all frames are grabbed first so they are samples of the same moment
    const shots = [];
    for (let i = 0; i < frames; i++) {
        const source = grabFrame();
        if (!source) break;
        shots.push(source);
        // minimum pause: without it they would repeat the same defect
        if (i < frames - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    // sharpest first: spends the time budget on the good frames
    shots.sort((a, b) => frameSharpness(b) - frameSharpness(a));

    for (const [i, source] of shots.entries()) {
        if (onProgress) onProgress(null, 15 + (i / shots.length) * 70);

        const isLast = i === shots.length - 1;
        const res = await scanRewardPhoto(source, deps, null, { skipIfNoAnchor: !isLast });
        perFrame.push(res);
        trace.push(`frame ${i + 1}: ${res.items.length}${res.skipped ? " (sin ancla, descartado)" : ""} (${res.ms}ms)`);

        if (res.items.length >= 4) break; // the screen maximum: nothing more to gain

        // budget: each frame costs a full pipeline; past the limit answer with what there is
        if (performance.now() - t0 > budgetMs) {
            trace.push(`presupuesto agotado tras ${perFrame.length} frame(s)`);
            break;
        }
    }

    if (perFrame.length === 0) {
        return { items: [], roi: null, ms: 0, trace: ["sin fotogramas"], frames: 0 };
    }

    const votes = new Map();
    for (const res of perFrame) {
        for (const it of res.items) {
            const prev = votes.get(it.name);
            if (prev) {
                prev.count++;
                if ((it.ratio ?? 0) > (prev.item.ratio ?? 0)) prev.item = it;
            } else {
                votes.set(it.name, { count: 1, item: it });
            }
        }
    }

    const minVotes = perFrame.length >= 2 ? 2 : 1;
    let items = [...votes.values()].filter((v) => v.count >= minVotes).map((v) => v.item);

    // short consensus falls back to the best frame: a coherent read beats a list cut by consensus
    const bestFrame = perFrame.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    if (items.length < bestFrame.items.length) {
        trace.push(`consenso ${items.length} < mejor frame ${bestFrame.items.length}: se usa el frame`);
        items = bestFrame.items;
    }

    items.sort((a, b) => (a.xPos ?? 0) - (b.xPos ?? 0));
    trace.push(`consenso (≥${minVotes} de ${perFrame.length}): ${items.length}`);

    return {
        items,
        roi: bestFrame.roi,
        debugCanvas: bestFrame.debugCanvas,
        ms: Math.round(performance.now() - t0),
        trace,
        frames: perFrame.length,
    };
}
