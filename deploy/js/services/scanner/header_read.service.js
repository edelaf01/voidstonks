import { VisionService } from "./vision.service.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";

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
