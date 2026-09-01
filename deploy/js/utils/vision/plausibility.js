import { detectRewardBand } from "./grid_detect.js";
import { columnasDesdeCentros } from "./reward_cards.js";

/**
 * Is what the vision just detected believable? Both guards ask that for two detections, for the same reason:
 * a junk detection always beats "nothing detected", because whoever gets it trusts it and skips the
 * calibrated path that did work. Rejecting only costs going back to that path.
 */

/**
 * Plausibility guard for a SAVED (manual) grid calibration used as fallback when the auto grid gives no
 * signal this frame. Manual calibration derives the columns from the aspect ratio of the dragged box, so a
 * badly drawn box gives a junk grid, and not scanning beats scanning with it. A real inventory grid takes
 * ~11% of the width per cell and ~20% of the height per row, and its zone stays clear of the side panel
 * (~65% of the width).
 *
 * @returns {boolean} true when the calibration is implausible and must NOT be used.
 */
export function isImplausibleFallbackGrid(calib, frameW, frameH) {
    if (!calib || !frameW || !frameH) return true;
    const zone = calib.gridZone;
    if (!zone || !zone.w || !zone.h) return true;
    if (zone.w > frameW * 0.85) return true; // zone spills into the sell panel / full width
    if (calib.cellW && calib.cellW > frameW * 0.16) return true; // cells too wide (few columns)
    if (calib.cellH && calib.cellH > frameH * 0.28) return true; // rows too tall
    return false;
}

/**
 * Can this rect really be the rewards row? Reference: the fixed geometry the crop was calibrated with when
 * there is no detection (prepareRewardOCRCanvas): cards take 84 % of the width and 25.5 % of the height from
 * 18.5 %, a ~6:1 strip centered at 31 % height. Each cut leaves ample margin and drops what used to catch
 * live (chat, progress panel, loading screen, squad names).
 *
 * Rejecting only costs going back to the fixed crop: a false reject degrades to the usual behaviour, never
 * worse. Hence the strict cuts.
 */
export function isImplausibleRewardBand(rect, frameW, frameH) {
    if (!rect || !frameW || !frameH) return true;
    const { w, h, y = 0 } = rect;
    if (!w || !h) return true;
    if (w < frameW * 0.25) return true;  // the card row never fits in a quarter of the width
    if (h > frameH * 0.35) return true;  // that is not a name strip, it is half the HUD
    if (w / h < 2.5) return true;        // a name row is much wider than tall
    // the row lives in the TOP half (center at 31 %). Below are the squad names, the Steel Path bonus and the
    // kill feed, with MORE text than the item names together, and pickBest would keep the bottom HUD
    if ((y + h / 2) > frameH * 0.70) return true;
    return false;
}

/**
 * detectRewardBand with the guard on: returns null instead of an impossible crop, and keeps only the band
 * HEIGHT. The guard lives here because REWARD_DEFAULTS allows `minCards: 1` on purpose (a single reward is
 * legit), and that 1 lets any text blob through.
 *
 * The width is dropped because the detected rect wraps only the names it FOUND: when the edge signal catches
 * just one, the crop closes on that card and the other three never reach the OCR. The height is reliable and
 * is what the detection is for: with a webcam on a monitor the game does not fill the frame and the fixed
 * 18.5 %-44 % lands on empty background. The extra width is background the matcher drops and costs no
 * resolution.
 */
export function detectPlausibleRewardBand(img, opts = {}) {
    const rect = detectRewardBand(img, opts);
    // the guard judges the REAL detection, before widening: full width would always pass the "more than a
    // quarter" cut
    if (isImplausibleRewardBand(rect, img?.width, img?.height)) return null;
    // the columns travel even when the crop widens to full width: without them parseRewards loses its three per
    // card rescues (suffix, component and the in card token threshold)
    const cajas = rect.cardBoxes || [];
    const columnas = columnasDesdeCentros(cajas.map((b) => b.cx), img.width,
        Math.max(0, ...cajas.map((b) => b.x1 - b.x0)) * 2);
    return { ...rect, x: 0, w: img.width, columnas };
}
