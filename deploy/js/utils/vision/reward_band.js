import { detectPlausibleRewardBand } from "./plausibility.js";
import { detectCardRow } from "./reward_cards.js";
import { franjaDeRotulo } from "./reward_preprocess.js";

/**
 * Dónde están las cards de recompensa dentro del frame.
 *
 * La detección corre sobre un downscale barato: solo necesita VER la banda de texto, no leerla,
 * y el frame completo cuesta un getImageData de 2560x1440 por intento. El rect vuelve a
 * coordenadas del frame al salir.
 *
 * Vive fuera de scanner.service.js porque es una etapa con entrada y salida propias —frame ->
 * geometría— y porque así un test puede recorrer la MISMA cadena que la app: toda la geometría
 * de recompensas se mide en fracciones del recorte, así que un test que se invente el recorte
 * no mide nada de lo que pasa en vivo.
 *
 * @param prev  canvas de la llamada anterior (se reutiliza: uno nuevo por frame deja backing
 *              stores que el navegador libera mucho más despacio que el heap normal).
 */
export function localizaBandaRecompensas(frame, width, height, prev = null) {
    const DETECT_W = 720; // 480 dejaba la fila de nombres bajo minBandH salvo a 1080p exactos
    let det = detectaEn(frame, width, height, DETECT_W, prev);
    if (!det.band) {
        // El juego PEQUEÑO dentro del encuadre —el caso para el que existe todo esto— es
        // justamente el que ninguna de las dos detecciones ve: el rótulo se encoge con él, así
        // que a 720 px cae bajo minBandH (6 px) y su ancho no llega al 8 % del FRAME que exige
        // minCardW, medido contra el frame entero y no contra la banda. Medido sobre el frame
        // sintético de 2560x1440: con el juego al 70 % del encuadre no se detecta nada ni
        // subiendo la resolución, y se cae al recorte fijo 18,5-44 %, que también está medido
        // sobre el frame y por tanto ya no cae sobre las cards.
        // Solo corre cuando el intento normal no vio nada: el camino calibrado no cambia.
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
 * Los recortes que se le van a ofrecer al OCR, en orden de preferencia.
 *
 * Son DOS porque fallan en sitios distintos y ninguno de los dos vale solo. Medido sobre 7
 * capturas reales × 5 resoluciones (135 recompensas): la banda detectada acierta 79 y el
 * recorte fijo 78, pero quedarse con la mejor de las dos sube a 117. La banda se cuela cuando
 * las manchas de arte la anclan bajo los rótulos (una captura daba 0 de 3 a TODAS las
 * resoluciones); el fijo se cae cuando el juego no está donde el porcentaje dice.
 *
 * `minimo` es cuántas recompensas hacen falta para dar la lectura por completa y no probar el
 * siguiente: la detección ya ha contado las cards, así que leer menos nombres que cards es la
 * señal de que ese recorte se dejó algo. Sin banda no hay con qué comparar y basta con leer una.
 */
export function candidatosDeRecorte(banda, rotulo = null) {
    const cands = [];
    if (banda?.cropRect) {
        cands.push({ nombre: "banda", cropRect: banda.cropRect, columnas: banda.columnas,
            minimo: Math.max(1, banda.cardCount || 1) });
    }
    // El recorte calibrado (18,5-44 % del alto): su geometría no depende de que la detección
    // haya acertado. Las columnas SÍ se le pasan si las hay: dicen dónde están las tarjetas a lo
    // ANCHO del frame y eso vale para cualquier recorte vertical. Sin ellas parseRewards pierde
    // el rescate del componente y devolvía la pieza equivocada — "Zephyr Prime Blueprint" por
    // "Zephyr Prime Neuroptics Blueprint", que es otra pieza y se da de alta igual.
    // El mismo mínimo que la banda: las cards que contó la detección no dependen de qué recorte
    // se use para leerlas, y sin eso una lectura incompleta (2 de 3) daba la escalera por buena.
    cands.push({ nombre: "fijo", cropRect: null, columnas: banda?.columnas,
        minimo: Math.max(1, banda?.cardCount || 1) });
    // Y el calibrado CEÑIDO a la franja del rótulo. El calibrado contiene la tarjeta entera y el
    // arte impide que Tesseract segmente el texto aunque la máscara lo conserve (ver
    // franjaDeRotulo). Va el último: solo se paga si los otros dos no leen.
    if (rotulo) {
        cands.push({ nombre: "rotulo", cropRect: rotulo, columnas: banda?.columnas,
            minimo: Math.max(1, banda?.cardCount || 1) });
    }
    return cands;
}

/**
 * El mismo recorte pero CEÑIDO a la franja del rótulo, en coordenadas del frame.
 *
 * Devuelve un cropRect para usar como un candidato más de la escalera: al ir por el camino
 * normal, las dos pasadas de OCR comparten geometría y no hay nada más que tocar.
 * Se mide sobre un dibujo a media escala: localizar la franja no necesita leerla.
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
    // Un poco de aire arriba: la 1ª línea de un rótulo de dos puede asomar de la franja.
    const y0 = cropY + Math.max(0, franja.y0 - (franja.y1 - franja.y0) * 0.3) / escala;
    const y1 = cropY + franja.y1 / escala;
    return { x: 0, y: Math.round(y0), w: width, h: Math.round(y1 - y0) };
}
