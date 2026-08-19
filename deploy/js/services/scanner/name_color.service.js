import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

/**
 * Elige el color del texto de los nombres para TODA una página del inventario
 * probando los colores candidatos de una celda hasta que uno lee un nombre que
 * existe en el catálogo.
 *
 * El criterio es una lectura válida, no un umbral: no hay nada que afinar mal
 * porque no se estima nada — o el OCR saca un nombre real de reliquia/parte prime,
 * o ese color no era el texto. Se prueban unas pocas celdas porque la primera puede
 * traer el nombre cortado, estar vacía (ya no vienen prefiltradas) o ser un ítem que el
 * matcher no resuelve.
 *
 * Por qué a nivel de página y no por celda: ver utils/name_color.js.
 *
 * Devuelve [r,g,b], o null si ninguno lee nada reconocible (entonces cada celda
 * mide el suyo, como antes).
 */
export async function electPageNameColor(worker, snapshot, activeCells, cellW, textSrcY, textSrcH, theme) {
    if (!worker) return null;
    for (const { cell } of activeCells.slice(0, 6)) {
        const cands = VisionService.nameBandColorCandidates(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH);
        for (const col of cands) {
            const cvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, col);
            const words = await OCRService.extractCellText(worker, cvs);
            if (!words || !words.length) continue;
            if (OCRService.getRelicMatch(words) || OCRService.getValidItemMatch(words)) {
                console.log(`[INV] Color de nombre de la página: rgb(${col.join(",")}) — leyó "${words.join(" ")}"`);
                return col;
            }
        }
    }
    console.warn("[INV] Ningún color candidato produjo un nombre del catálogo — se mide por celda.");
    return null;
}
