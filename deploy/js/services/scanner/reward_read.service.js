// reads rewards of a frame with Tesseract or PaddleOCR: crop, OCR and parse
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { columnasEnRecorte } from "../../utils/vision/reward_cards.js";
import { rawWords } from "../../utils/vision/ocr_words.js";
import { montaTiras, repartePorTramos } from "../../utils/vision/ocr_montage.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";
import { labelFullyRead } from "../../utils/vision/name_lines.js";
import { collectWords } from "../../utils/vision/ocr_words.js";
import { hasComponentSiblings } from "../../utils/inventory/component_siblings.js";

async function conPaddle(frame, width, height, scale, cropRect, columnas) {
    const colorCvs = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, "COLOR", cropRect);
    const words = await PaddleRepository.recognizeWordsWithBoxes(colorCvs);
    const cols = columnasEnRecorte(columnas, width, cropRect);
    const foundItems = OCRService.parseRewards({ words, imageW: colorCvs.width, columnas: cols });
    const rawOcr = words.map((w) => w.text).join(" ");
    console.log(`[REWARD] Paddle: ${words.length} palabras -> ${foundItems.length} ítems`);
    return { rawOcr, namesRaw: "", foundItems, ocrCanvas: colorCvs, namesCanvas: null };
}

export async function leeRotulosMissionComplete(frame, celdas) {
    if (!PaddleRepository.listo() || !celdas.length) return null;
    const tiras = celdas.map((c) => ({
        clave: `r${c.row}c${c.col}`,
        sx: c.x, sy: c.y + Math.round(c.h * 0.55), sw: c.w, sh: Math.round(c.h * 0.45),
    }));
    try {
        const salida = new Map();
        // 2x, not 1.5x: over the art, 1.5x read "PRIME IMB" for "Limbo Prime"
        for (const { canvas, tramos } of montaTiras(frame, tiras, { hueco: 10, escala: 2 })) {
            const res = await PaddleRepository.recognizeLines(canvas);
            for (const [clave, suyas] of repartePorTramos(res, tramos)) {
                salida.set(clave, suyas.map((l) => l.text).join(" ").toUpperCase());
            }
        }
        return salida;
    } catch (e) {
        console.warn("[MC] motor preciso falló, sigo con el clásico:", e);
        return null;
    }
}

export async function leeCasillaMissionComplete(worker, frame, cell, accent, cellCvs, preciso) {
    let data = null, raw = preciso || "";
    if (!preciso) {
        VisionService.prepareMissionCompleteCellCanvas(frame, cell, accent, cellCvs);
        ({ data } = await OCRRepository.recognize(worker, cellCvs, {}, { text: true, blocks: true }));
        raw = (data.text || "").toUpperCase();
    }
    raw = raw.replaceAll(/\s+/g, " ").trim();
    const motor = preciso ? "preciso" : "clásico";
    const relic = OCRService.getRelicMatch(raw);
    const match = relic ? null : OCRService.getValidItemMatch(raw);
    console.log(`[MC] r${cell.row}c${cell.col} ${motor}: "${raw}" → ${relic ? `${relic} ×${cell.qty} (reliquia)` : match?.isPrime ? `${match.originalName} ×${cell.qty}` : "sin match"}`);
    if (relic) return { name: relic, reliquia: true, raw, motor };
    if (!match?.isPrime) return { name: null, reliquia: false, raw, motor };
    if (!preciso && hasComponentSiblings(OCRService.cachedDbItems, match.originalName)) {
        const { completo, cobertura } = labelFullyRead(cellCvs, collectWords(data));
        if (!completo) {
            console.log(`[MC] r${cell.row}c${cell.col}: descarto "${match.originalName}" — lo leído explica el ${Math.round(cobertura * 100)}% de la tinta del rótulo`);
            return { name: null, reliquia: false, raw, motor };
        }
    }
    return { name: match.originalName, reliquia: false, raw, motor };
}

export async function leeRecompensas(frame, width, height, scale, preset, cropRect, columnas, motor = "ambos") {
    if (motor !== "clasico" && motorActivo() === MOTOR_PRECISO && PaddleRepository.listo()) {
        const red = await conPaddle(frame, width, height, scale, cropRect, columnas)
            .catch((e) => { console.warn("[REWARD] motor preciso falló, sigo con el clásico:", e); return null; });
        if (red?.foundItems.length) return red;
    }
    if (motor === "preciso") return { rawOcr: "", namesRaw: "", foundItems: [], ocrCanvas: null, namesCanvas: null };

    const ocrCanvas = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, preset, cropRect);
    console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height} (preset ${preset})`);

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

    const namesCanvas = VisionService.prepareRewardNamesCanvas(frame, width, height, scale, cropRect);
    let metaRes, namesRes;
    if (namesCanvas) {
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

    const mergedWords = [...rawWords(namesRes.data), ...rawWords(data)];
    const cols = columnasEnRecorte(columnas, width, cropRect);
    const foundItems = OCRService.parseRewards({ words: mergedWords, imageW: ocrCanvas.width, columnas: cols });
    console.log(`[REWARD] Items found: ${foundItems.length}`, foundItems.map(i => i.name));

    return { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas };
}
