import { VisionService } from "./vision.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { regionLuma } from "../../utils/vision/frame_hash.js";
import { tituloHaCambiado, FRANJA_CATEGORIA_VIDEO } from "../../utils/vision/context_latch.js";

export async function leeCategoriaInventario(escaner, video, worker1) {
    const hash = regionLuma(video, FRANJA_CATEGORIA_VIDEO);
    if (escaner._categoriaHash && !tituloHaCambiado(hash, escaner._categoriaHash)) {
        return escaner._categoriaTexto;
    }
    const lienzo = VisionService.lienzo("categoria");
    const factor = 2160 / video.videoHeight;
    lienzo.width = Math.round(video.videoWidth * FRANJA_CATEGORIA_VIDEO.w * factor);
    lienzo.height = Math.round(video.videoHeight * FRANJA_CATEGORIA_VIDEO.h * factor);
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(
        video,
        video.videoWidth * FRANJA_CATEGORIA_VIDEO.x,
        video.videoHeight * FRANJA_CATEGORIA_VIDEO.y,
        video.videoWidth * FRANJA_CATEGORIA_VIDEO.w,
        video.videoHeight * FRANJA_CATEGORIA_VIDEO.h,
        0, 0, lienzo.width, lienzo.height
    );
    const imgData = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    const pix = imgData.data;
    for (let i = 0; i < pix.length; i += 4) {
        const luma = 0.299 * pix[i] + 0.587 * pix[i + 1] + 0.114 * pix[i + 2];
        const v = luma > 140 ? 0 : 255;
        pix[i] = pix[i + 1] = pix[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    const { data } = await OCRRepository.recognize(worker1, lienzo, {}, { text: true });
    escaner._categoriaHash = hash;
    escaner._categoriaTexto = (data.text || "").toUpperCase();
    return escaner._categoriaTexto;
}

export const RESCATE_CABECERA_MS = 3000;

/**
 * El OCR de la cabecera con sus dos pasadas de rescate. Lee y escribe el estado del escáner
 * (`latchedContext` y `_ultimoRescate`).
 * @returns {{ headerText: string, pasadas: number }}
 */
export async function leeCabeceraOCR(escaner, video, virtualCanvas, worker1, franjaQuieta) {
    VisionService.prepareVirtualCanvas(video, virtualCanvas);
    const headerTheme = VisionService.finalizeVirtualCanvas(virtualCanvas);
    const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });
    let headerText = headerData.text || "";
    let pasadas = 1;

    const sinContexto = () => VisionService.determineContext(headerText) === "UNKNOWN";
    const enFinDeMision = escaner.latchedContext === "MISSION_COMPLETE";
    const rescate = sinContexto() && (franjaQuieta || enFinDeMision || Date.now() - (escaner._ultimoRescate || 0) >= RESCATE_CABECERA_MS);
    if (rescate) escaner._ultimoRescate = Date.now();

    if (rescate && headerTheme && !enFinDeMision) {
        pasadas++;
        const alt = VisionService.lienzo("cabeceraTema");
        VisionService.prepareVirtualCanvas(video, alt);
        const altCtx = alt.getContext("2d", { willReadFrequently: true });
        VisionService.applyThemeDistanceThreshold(altCtx, alt.width, alt.height, headerTheme);
        const { data: altData } = await OCRRepository.recognize(worker1, alt, {}, { text: true });
        const altText = altData.text || "";
        if (VisionService.determineContext(altText) !== "UNKNOWN") {
            console.log(`[SCAN] Header rescatado por binarización de tema: "${altText.trim().slice(0, 60)}"`);
            headerText = altText;
        }
    }

    // Tercer intento: el título CENTRADO. MISSION COMPLETE no cae en el recorte izquierdo
    if (rescate && sinContexto()) {
        pasadas++;
        const centro = VisionService.lienzo("cabeceraCentrada");
        VisionService.prepareCenterHeaderCanvas(video, centro);
        const cCtx = centro.getContext("2d", { willReadFrequently: true });
        const cTheme = VisionService.detectThemeFromSnapshot(centro, 0, 0, centro.width, centro.height, { sinRecuerdo: true });
        VisionService.applyThemeDistanceThreshold(cCtx, centro.width, centro.height, cTheme);
        const { data: cData } = await OCRRepository.recognize(worker1, centro, {}, { text: true });
        const cText = cData.text || "";
        if (VisionService.determineContext(cText) !== "UNKNOWN") {
            console.log(`[SCAN] Contexto por título centrado: "${cText.trim().slice(0, 60)}"`);
            headerText = cText;
        }
    }
    return { headerText, pasadas };
}
