import { detectRewardBand } from "./grid_detect.js";
import { columnasDesdeCentros } from "./reward_cards.js";

export function isImplausibleFallbackGrid(calib, frameW, frameH) {
    if (!calib || !frameW || !frameH) return true;
    const zone = calib.gridZone;
    if (!zone || !zone.w || !zone.h) return true;
    if (zone.w > frameW * 0.85) return true;
    if (calib.cellW && calib.cellW > frameW * 0.16) return true;
    if (calib.cellH && calib.cellH > frameH * 0.28) return true;
    return false;
}

export function isImplausibleRewardBand(rect, frameW, frameH) {
    if (!rect || !frameW || !frameH) return true;
    const { w, h, y = 0 } = rect;
    if (!w || !h) return true;
    if (w < frameW * 0.25) return true;
    if (h > frameH * 0.35) return true;
    if (w / h < 2.5) return true;
    if ((y + h / 2) > frameH * 0.70) return true;
    return false;
}

// width is dropped because wrapping only found cards cuts the remaining ones from OCR
export function detectPlausibleRewardBand(img, opts = {}) {
    const rect = detectRewardBand(img, opts);
    if (isImplausibleRewardBand(rect, img?.width, img?.height)) return null;
    const cajas = rect.cardBoxes || [];
    const columnas = columnasDesdeCentros(cajas.map((b) => b.cx), img.width,
        Math.max(0, ...cajas.map((b) => b.x1 - b.x0)) * 2);
    return { ...rect, x: 0, w: img.width, columnas };
}
