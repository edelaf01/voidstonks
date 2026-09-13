import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

// two hits: a color that only catches the letter edges reads one cell and fails the rest, and it
// is cached for the whole session
const HITS_NEEDED = 2;
const MISSES_ALLOWED = 2;

/**
 * Picks the name text color for a whole inventory page. Candidates come from the vote of every
 * cell (utils/vision/name_color.js); the first that reads a real catalog name in two cells wins.
 * Returns [r,g,b], or null and each cell measures its own.
 */
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

/**
 * Binarized name band of one cell (black text on white). With no ink under the page color, the
 * color is measured in the cell itself, so "no ink" only means an empty cell.
 * @returns { cvs, ink, ownColor }
 */
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

/**
 * Rereads a cell blanking the art above the name: with three-line names the art enters the band
 * and on light themes has the text color. The name is anchored at the bottom, so blanking from
 * the top never removes a whole line. `legible` is the scanner's unreadable-read filter.
 * @returns {{ relicMatch, bestItem, words, corte }}
 */
export async function readCellCuttingArt(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme, pageColor, legible) {
    for (const corte of [0.15, 0.25, 0.35]) {
        const cvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, pageColor);
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cvs.width, Math.round(cvs.height * corte));
        const words = await OCRService.extractCellText(worker, cvs);
        if (!words?.length || !legible(words)) continue;
        const relicMatch = OCRService.getRelicMatch(words);
        const bestItem = relicMatch ? null : OCRService.getValidItemMatch(words);
        if (relicMatch || bestItem) return { relicMatch, bestItem, words, corte };
    }
    return null;
}
