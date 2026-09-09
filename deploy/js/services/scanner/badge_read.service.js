// reads inventory cell quantity badge: theme color first, brightness only when no digit comes out
import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

export const relojBadges = { ms: 0, n: 0 };

export async function leeCantidadBadge(snapshot, cell, cellW, cellH, theme) {
    const t0 = performance.now();
    try {
        return await leeBadge(snapshot, cell, cellW, cellH, theme);
    } finally {
        relojBadges.ms += performance.now() - t0;
        relojBadges.n++;
    }
}

async function leeBadge(snapshot, cell, cellW, cellH, theme) {
    const porColor = await OCRService.extractCellQuantity(null,
        VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme));
    if (/\d/.test(porColor.raw || "")) return porColor;

    const porBrillo = await OCRService.extractCellQuantity(null,
        VisionService.extractBadgeBright(snapshot, cell, cellW, cellH));
    return /\d/.test(porBrillo.raw || "") ? porBrillo : porColor;
}
