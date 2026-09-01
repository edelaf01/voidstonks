/**
 * Un intento completo de leer las recompensas de un frame: recorte -> OCR -> parseo.
 *
 * Fuera de scanner.service.js porque es una etapa con entrada y salida propias y porque aquí
 * conviven los DOS motores: Tesseract (binariza y lee en dos pasadas) y PaddleOCR (una red de
 * detección + reconocimiento que localiza el texto ella misma). Quien decide cuántos intentos
 * hacer y con qué recorte es processRewards; esto solo ejecuta uno.
 */
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { PaddleRepository } from "../../repositories/paddle.repository.js";
import { columnasEnRecorte } from "../../utils/vision/reward_cards.js";
import { motorActivo, MOTOR_PRECISO } from "./ocr_engine.service.js";

/**
 * Lectura con PaddleOCR, que el usuario elige en el HUD del escáner (ocr_engine.service.js).
 *
 * Se salta ENTERA la maquinaria de binarización —presets, máscaras por color de tema, escalera
 * de umbrales— porque la red detecta el texto por su cuenta sobre el recorte a COLOR. Es el
 * mismo motor que ya usa la vía de foto, donde está medido sobre estas capturas: 20/20 con 0
 * falsos en ~0,65 s por imagen, frente a 2,5-3,7 s del pipeline de Tesseract, y con un modelo
 * más ligero (4,8 MB contra los 7,5 de wasm + 4 de idioma). Ver MAINTENANCE_REWARD_PHOTO_OCR.md.
 */
async function conPaddle(frame, width, height, scale, cropRect, columnas) {
    const colorCvs = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, "COLOR", cropRect);
    const words = await PaddleRepository.recognizeWordsWithBoxes(colorCvs);
    const cols = columnasEnRecorte(columnas, width, cropRect);
    const foundItems = OCRService.parseRewards({ words, imageW: colorCvs.width, columnas: cols });
    const rawOcr = words.map((w) => w.text).join(" ");
    console.log(`[REWARD] Paddle: ${words.length} palabras -> ${foundItems.length} ítems`);
    return { rawOcr, namesRaw: "", foundItems, ocrCanvas: colorCvs, namesCanvas: null };
}

// Devuelve { rawOcr, namesRaw, foundItems, ocrCanvas, namesCanvas }.
// `frame`: canvas congelado de processRewards, no el <video>.
export async function leeRecompensas(frame, width, height, scale, preset, cropRect, columnas) {
    // El motor de red no necesita ni preset ni binarización: un intento le basta. Solo se usa
    // si YA está cargado —quien lee frames en vivo no puede esperar a que bajen 4,8 MB— y si no
    // devuelve nada se sigue con el clásico, que no depende de nada externo. Misma red de
    // seguridad que la vía de foto: un CDN caído no puede dejar el escáner sin leer.
    if (motorActivo() === MOTOR_PRECISO && PaddleRepository.listo()) {
        const red = await conPaddle(frame, width, height, scale, cropRect, columnas)
            .catch((e) => { console.warn("[REWARD] motor preciso falló, sigo con el clásico:", e); return null; });
        if (red?.foundItems.length) return red;
    }

    const ocrCanvas = VisionService.prepareRewardOCRCanvas(frame, width, height, scale, preset, cropRect);
    console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height} (preset ${preset})`);

    // Antes esto iba tras un `if (globalThis.OpenCVEngine?.isReady)` que NUNCA se cumplía:
    // ningún módulo publica ese global (OpenCVEngine se importa como clase), así que la
    // binarización de recompensas siempre ha sido esta, y la calibración de la pasada de
    // nombres está afinada sobre ella. Enchufar OpenCV aquí es un cambio de OCR, no una
    // limpieza: haría falta medirlo contra las capturas de tests/_fixtures.
    // Canvas is already grayscale from CSS filter.
    // Invert: bright=text → black(0), dark=background → white(255)
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

    // 2ª pasada: NOMBRES por máscara de color del tema. El grayscale funde el color del nombre
    // con el fondo/ilustración dorada y Tesseract lee basura; el filtro por color del tema lo aísla.
    // Mismo recorte/escala que ocrCanvas -> las cajas de palabra comparten coordenadas, así que
    // parseRewards (que separa columnas por X) fusiona nombres (color) + Owned/Crafted (grayscale).
    // Las DOS pasadas corren EN PARALELO (workers distintos) -> no suman latencia frente a una sola.
    // prepareRewardNamesCanvas devuelve null si su máscara salió densa (= ruido, no letras):
    // en ese caso NO se corre la pasada de nombres — su OCR inyectaría decenas de palabras
    // basura en mergedWords (anclas espurias tipo "Ris") sin aportar ningún nombre real.
    const namesCanvas = VisionService.prepareRewardNamesCanvas(frame, width, height, scale, cropRect);
    let metaRes, namesRes;
    if (namesCanvas) {
        // Se lanza la creación del 2º worker pero NO se espera: bloquear aquí metía
        // cientos de ms (arranque de una instancia WASM) justo en el primer frame de
        // recompensa, que es el que más corre prisa. Si aún no está, las dos pasadas
        // caen a workers[0] —secuenciales, algo más lentas pero sin frame perdido— y a
        // partir del siguiente frame ya hay paralelismo real.
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
