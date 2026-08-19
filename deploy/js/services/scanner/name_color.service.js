import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

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
