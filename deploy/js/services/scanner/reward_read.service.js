/**
 * One attempt to read the rewards of a frame: crop -> OCR -> parse, with either engine:
 * Tesseract (binarizes, two passes) or PaddleOCR (finds the text itself). processRewards decides
 * how many attempts and with which crop.
 */
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { columnasEnRecorte } from "../../utils/vision/reward_cards.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";

async function conPaddle(frame, width, height, scale, cropRect, columnas) {
    const colorCvs = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, "COLOR", cropRect);
    const words = await PaddleRepository.recognizeWordsWithBoxes(colorCvs);
    const cols = columnasEnRecorte(columnas, width, cropRect);
    const foundItems = OCRService.parseRewards({ words, imageW: colorCvs.width, columnas: cols });
    const rawOcr = words.map((w) => w.text).join(" ");
    console.log(`[REWARD] Paddle: ${words.length} palabras -> ${foundItems.length} ítems`);
    return { rawOcr, namesRaw: "", foundItems, ocrCanvas: colorCvs, namesCanvas: null };
}

// Returns { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas }. `frame` is the frozen canvas
// from processRewards, not the <video>.
export async function leeRecompensas(frame, width, height, scale, preset, cropRect, columnas) {
    // the network engine needs one attempt and only runs if already loaded; empty falls back to classic
    if (motorActivo() === MOTOR_PRECISO && PaddleRepository.listo()) {
        const red = await conPaddle(frame, width, height, scale, cropRect, columnas)
            .catch((e) => { console.warn("[REWARD] motor preciso falló, sigo con el clásico:", e); return null; });
        if (red?.foundItems.length) return red;
    }

    const ocrCanvas = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, preset, cropRect);
    console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height} (preset ${preset})`);

    // canvas is already grayscale from the CSS filter; invert: bright text -> black, dark -> white
    const ctx = ocrCanvas.getContext("2d", { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    const px = imgData.data;
    let textPixels = 0;
    for (let i = 0; i < px.length; i += 4) {
        const v = px[i] > 128 ? 0 : 255;
        if (v === 0) textPixels++;
        px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    const totalPx = px.length / 4;
    console.log(`[REWARD] Binarization: ${textPixels} text pixels / ${totalPx} total (${(100 * textPixels / totalPx).toFixed(2)}%)`);

    // 2nd pass: names by theme color mask, same crop and scale as ocrCanvas so the word boxes share
    // coordinates. Runs in parallel with the grayscale pass. null = dense mask (noise), no names pass.
    const namesCanvas = VisionService.prepareRewardNamesCanvas(frame, width, height, scale, cropRect);
    let metaRes, namesRes;
    if (namesCanvas) {
        // not awaited: until the 2nd worker exists both passes run on workers[0]
        OCRRepository.ensureSecondWorker().catch(() => { });
        const w0 = OCRRepository.workers[0];
        const w1 = OCRRepository.workers[1] || w0;
        [metaRes, namesRes] = await Promise.all([
            OCRRepository.recognize(w0, ocrCanvas, {}, { blocks: true }),
            OCRRepository.recognize(w1, namesCanvas, {}, { blocks: true }),
        ]);
    } else {
        console.log("[REWARD] Names pass skipped: noisy mask");
        metaRes = await OCRRepository.recognize(OCRRepository.workers[0], ocrCanvas, {}, { blocks: true });
        namesRes = { data: { text: "", words: [] } };
    }
    const data = metaRes.data;
    const rawOcr = data.text || "";
    console.log(`[REWARD] OCR raw (grayscale/badges): "${rawOcr.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);
    const namesRaw = namesRes.data?.text || "";
    console.log(`[REWARD] OCR raw (color/nombres): "${namesRaw.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);

    const mergedWords = [...(namesRes.data?.words || []), ...(data.words || [])];
    const cols = columnasEnRecorte(columnas, width, cropRect);
    const foundItems = OCRService.parseRewards({ words: mergedWords, imageW: ocrCanvas.width, columnas: cols });
    console.log(`[REWARD] Items found: ${foundItems.length}`, foundItems.map(i => i.name));

    return { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas };
}
