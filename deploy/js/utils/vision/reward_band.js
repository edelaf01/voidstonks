import { detectPlausibleRewardBand } from "./plausibility.js";
import { detectCardRow } from "./reward_cards.js";
import { franjaDeRotulo } from "./reward_preprocess.js";

/**
 * Where the reward cards are in the frame. Detection runs on a cheap downscale: it only has to SEE the text
 * band, not read it. The rect goes back to frame coordinates on the way out.
 *
 * Apart from scanner.service.js so a test can walk the SAME chain as the app: all reward geometry is in crop
 * fractions, and a test that makes up the crop measures nothing of what happens live.
 *
 * @param prev  canvas from the previous call (reused: one per frame leaves backing stores the browser frees
 *              much slower than the normal heap).
 */
export function localizaBandaRecompensas(frame, width, height, prev = null) {
    const DETECT_W = 720; // 480 left the name row under minBandH except at exactly 1080p
    let det = detectaEn(frame, width, height, DETECT_W, prev);
    if (!det.band) {
        // the game SMALL inside the frame, the case all this exists for, is the one neither detection sees: the
        // label shrinks with it under minBandH at 720 px and its width misses the 8 % of the FRAME minCardW asks for.
        // Only runs when the normal try saw nothing: the calibrated path does not change
        det = detectaEn(frame, width, height, Math.min(width, 1440), det.cvs, { minCardW: 0.03 });
        if (det.band) console.log("[REWARD] Banda rescatada en el 2º intento (juego pequeño en el encuadre)");
    }
    const { band, bandSource, detScale, cvs } = det;
    return {
        cropRect: band ? {
            x: band.x / detScale, y: band.y / detScale,
            w: band.w / detScale, h: band.h / detScale,
        } : null,
        columnas: band?.columnas,
        cardCount: band?.cardCount ?? 0,
        bandSource,
        cvs,
    };
}

function detectaEn(frame, width, height, anchoDet, prev, opts = {}) {
    const detScale = anchoDet / width;
    const cvs = prev || document.createElement("canvas");
    cvs.width = anchoDet;
    cvs.height = Math.round(height * detScale);
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(frame, 0, 0, cvs.width, cvs.height);
    const img = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const plausible = detectPlausibleRewardBand(img, opts);
    const cardRow = plausible ? null : detectCardRow(img);
    return {
        band: plausible || cardRow,
        bandSource: plausible ? "plausibility" : (cardRow ? "card_row" : null),
        detScale,
        cvs,
    };
}

/**
 * Crops offered to the OCR, by preference. TWO because they fail in different places and neither works
 * alone: the detected band slips when art blobs anchor it under the labels, the fixed one fails when the
 * game is not where the percentage says.
 *
 * `minimo` is how many rewards make the read complete so the next is not tried: the detection already
 * counted the cards, so fewer names than cards means that crop missed something. Without a band there is
 * nothing to compare and one read is enough.
 */
export function candidatosDeRecorte(banda, rotulo = null) {
    const cands = [];
    if (banda?.cropRect) {
        cands.push({ nombre: "banda", cropRect: banda.cropRect, columnas: banda.columnas,
            minimo: Math.max(1, banda.cardCount || 1) });
    }
    // the calibrated crop (18.5-44 % of the height) does not depend on the detection being right. Columns DO go
    // with it when there are any: they say where the cards are across the frame width, valid for any vertical
    // crop, and without them parseRewards loses the component rescue. Same minimum as the band: the cards the
    // detection counted do not depend on which crop reads them
    cands.push({ nombre: "fijo", cropRect: null, columnas: banda?.columnas,
        minimo: Math.max(1, banda?.cardCount || 1) });
    // and the calibrated one NARROWED to the label strip: the art keeps Tesseract from segmenting the text even
    // when the mask keeps it (see franjaDeRotulo). Last, only paid when the other two fail
    if (rotulo) {
        cands.push({ nombre: "rotulo", cropRect: rotulo, columnas: banda?.columnas,
            minimo: Math.max(1, banda?.cardCount || 1) });
    }
    return cands;
}

/**
 * The same crop NARROWED to the label strip, in frame coordinates: a cropRect for one more rung of the
 * ladder, so both OCR passes share geometry. Measured on a half scale drawing: finding the strip does not
 * need reading it.
 */
let _rotuloCvs = null;
export function recorteDelRotulo(video, width, height, cropRect = null) {
    const marginX = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
    const cropY = cropRect ? Math.floor(cropRect.y) : Math.floor(height * 0.185);
    const cropH = cropRect ? Math.floor(cropRect.h) : Math.floor(height * 0.255);
    const cropX = (cropRect ? Math.floor(cropRect.x) : 0) + marginX;
    const cropW = (cropRect ? cropRect.w : width) - marginX * 2;
    if (cropW <= 0 || cropH <= 0) return null;
    const escala = Math.min(1, 900 / cropW);
    const tw = Math.max(1, Math.round(cropW * escala)), th = Math.max(1, Math.round(cropH * escala));
    const cvs = _rotuloCvs ||= document.createElement("canvas");
    cvs.width = tw; cvs.height = th;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, tw, th);
    const franja = franjaDeRotulo(ctx.getImageData(0, 0, tw, th).data, tw, th);
    if (!franja) return null;
    // some room on top: the 1st line of a two line label can stick out of the strip
    const y0 = cropY + Math.max(0, franja.y0 - (franja.y1 - franja.y0) * 0.3) / escala;
    const y1 = cropY + franja.y1 / escala;
    return { x: 0, y: Math.round(y0), w: width, h: Math.round(y1 - y0) };
}
