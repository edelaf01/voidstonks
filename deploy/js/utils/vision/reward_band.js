import { detectPlausibleRewardBand } from "./plausibility.js";
import { detectCardRow } from "./reward_cards.js";
import { franjaDeRotulo } from "./reward_preprocess.js";

export function localizaBandaRecompensas(frame, width, height, prev = null) {
    const DETECT_W = 720;
    let det = detectaEn(frame, width, height, DETECT_W, prev);
    if (!det.band) {
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

// offers both crops because detected band slips on art and fixed fails when game moves
export function candidatosDeRecorte(banda, rotulo = null) {
    const cands = [];
    if (banda?.cropRect) {
        cands.push({ nombre: "banda", cropRect: banda.cropRect, columnas: banda.columnas,
            minimo: Math.max(1, banda.cardCount || 1) });
    }
    cands.push({ nombre: "fijo", cropRect: null, columnas: banda?.columnas,
        minimo: Math.max(1, banda?.cardCount || 1) });
    if (rotulo) {
        cands.push({ nombre: "rotulo", cropRect: rotulo, columnas: banda?.columnas,
            minimo: Math.max(1, banda?.cardCount || 1) });
    }
    return cands;
}

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
    const y0 = cropY + Math.max(0, franja.y0 - (franja.y1 - franja.y0) * 0.3) / escala;
    const y1 = cropY + franja.y1 / escala;
    return { x: 0, y: Math.round(y0), w: width, h: Math.round(y1 - y0) };
}
