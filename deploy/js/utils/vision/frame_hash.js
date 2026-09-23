// cheap image hashes to detect screen changes and skip OCR while screen is still

let tinyCvs = null;

function tinyCtx() {
    if (!tinyCvs) {
        tinyCvs = document.createElement("canvas");
        tinyCvs.width = 16;
        tinyCvs.height = 9;
    }
    return tinyCvs.getContext("2d", { willReadFrequently: true });
}

function hashFromTiny(ctx) {
    const d = ctx.getImageData(0, 0, 16, 9).data;
    let hash = "";
    for (let i = 0; i < d.length; i += 4) {
        const avg = Math.floor((d[i] + d[i + 1] + d[i + 2]) / 3);
        hash += avg.toString(16).padStart(2, "0");
    }
    return hash;
}

export function videoRegionHash(video, crop) {
    const ctx = tinyCtx();
    ctx.drawImage(video,
        Math.floor(video.videoWidth * crop.x), Math.floor(video.videoHeight * crop.y),
        Math.floor(video.videoWidth * crop.w), Math.floor(video.videoHeight * crop.h),
        0, 0, 16, 9);
    return hashFromTiny(ctx);
}

export function canvasRegionHash(canvas, rect) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, 16, 9);
    return hashFromTiny(ctx);
}

export function smallCanvasHash(canvas) {
    const ctx = tinyCtx();
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 16, 9);
    return hashFromTiny(ctx);
}

let miniCvs = null;
let regionCvs = null;

function lumaDe(ctx, w, h) {
    const px = ctx.getImageData(0, 0, w, h).data;
    const luma = new Uint8Array(w * h);
    for (let i = 0; i < luma.length; i++) luma[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    return luma;
}

export function miniaturaLuma(video, w, h) {
    if (!miniCvs) miniCvs = document.createElement("canvas");
    if (miniCvs.width !== w || miniCvs.height !== h) { miniCvs.width = w; miniCvs.height = h; }
    const ctx = miniCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, w, h);
    return { cvs: miniCvs, luma: lumaDe(ctx, w, h) };
}

export function regionLuma(source, rect) {
    const W = source.videoWidth || source.width, H = source.videoHeight || source.height;
    if (!regionCvs) regionCvs = document.createElement("canvas");
    if (regionCvs.width !== rect.cols || regionCvs.height !== rect.filas) { regionCvs.width = rect.cols; regionCvs.height = rect.filas; }
    const ctx = regionCvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, Math.floor(W * rect.x), Math.floor(H * rect.y), Math.floor(W * rect.w), Math.floor(H * rect.h), 0, 0, rect.cols, rect.filas);
    return lumaDe(ctx, rect.cols, rect.filas);
}

export function fraccionCambiada(a, b, umbral = 24) {
    if (!a || !b || a.length !== b.length) return 1;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > umbral) n++;
    return n / a.length;
}

export function compareHashes(hash1, hash2, tolerance = 18) {
    if (!hash1 || !hash2) return false;
    if (hash1.length !== hash2.length) return false;
    let diff = 0;
    for (let i = 0; i < hash1.length; i += 2) {
        diff += Math.abs(
            parseInt(hash1.substring(i, i + 2), 16) - parseInt(hash2.substring(i, i + 2), 16),
        );
    }
    return diff / (hash1.length / 2) < tolerance;
}
