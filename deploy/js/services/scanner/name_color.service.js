import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

// two hits: a color that only catches letter edges reads one cell and fails the rest
const HITS_NEEDED = 2;
const MISSES_ALLOWED = 2;

export async function electPageNameColor(worker, snapshot, activeCells, cellW, textSrcY, textSrcH, theme) {
    if (!worker || !activeCells.length) return null;

    const cands = VisionService.pageNameColorCandidates(
        snapshot, activeCells.map(a => a.cell), cellW, textSrcY, textSrcH);
    const sample = activeCells.slice(0, HITS_NEEDED + MISSES_ALLOWED + 2);

    let single = null;
    for (const col of cands) {
        let hits = 0, misses = 0;
        for (const { cell } of sample) {
            const cvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, col);
            const words = await OCRService.extractCellText(worker, cvs);
            const read = words?.length && (OCRService.getRelicMatch(words) || OCRService.getValidItemMatch(words));
            if (read) {
                if (++hits >= HITS_NEEDED) {
                    console.log(`[INV] Color de nombre de la página: rgb(${col.join(",")}) — ${hits} celdas leídas, la última "${words.join(" ")}"`);
                    return col;
                }
            } else if (++misses >= MISSES_ALLOWED) break;
        }
        if (hits && !single) single = col;
    }
    if (single) {
        console.warn(`[INV] Color de nombre rgb(${single.join(",")}) con una sola confirmación — la página puede leerse a medias.`);
        return single;
    }
    console.warn("[INV] Ningún color candidato produjo un nombre del catálogo — se mide por celda.");
    return null;
}

const MIN_INK = 20;

function countInk(cvs) {
    const px = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
    let ink = 0;
    for (let p = 0; p < px.length; p += 4) if (px[p] < 55) ink++;
    return ink;
}

export function cellNameMask(snapshot, cell, cellW, textSrcY, textSrcH, theme, pageColor) {
    const crop = (col) => VisionService.cropThemeBinarized(
        snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, col);
    let cvs = crop(pageColor);
    let ink = countInk(cvs);
    if (ink >= MIN_INK || !pageColor) return { cvs, ink, ownColor: false };
    cvs = crop(null);
    ink = countInk(cvs);
    return { cvs, ink, ownColor: ink >= MIN_INK };
}

export function hasInk(ink) {
    return ink >= MIN_INK;
}

export function readCellWithOwnColor(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme) {
    return OCRService.extractCellText(worker, VisionService.cropThemeBinarized(
        snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, null));
}
