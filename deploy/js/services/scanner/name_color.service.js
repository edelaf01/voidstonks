import { VisionService } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";

// Confirmaciones necesarias para dar por bueno un color. Con UNA bastaba, y ahí estaba
// el fallo: un color que solo pilla el borde oscuro de las letras deja glifos huecos que
// el OCR acierta en la celda de turno y falla en el resto de la página. Como el color se
// cachea para toda la sesión, esa única lectura afortunada envenenaba todas las páginas
// siguientes (visto en vivo: rgb(153,31,35) sobre nombres naranjas, 1 de 18 celdas legible).
const HITS_NEEDED = 2;
// Y con dos fallos se abandona el candidato: si el color no aísla el nombre, insistir en
// más celdas solo gasta pasadas de OCR.
const MISSES_ALLOWED = 2;

/**
 * Elige el color del texto de los nombres para TODA una página del inventario.
 *
 * Los candidatos salen del VOTO de todas las celdas (ver utils/vision/name_color.js) y
 * aquí se confirman leyendo: gana el primero que saque un nombre real del catálogo en
 * dos celdas distintas. El criterio es una lectura válida, no un umbral: o el OCR saca
 * un nombre de reliquia/parte prime, o ese color no era el texto.
 *
 * Devuelve [r,g,b], o null si ninguno lee nada reconocible (entonces cada celda mide el
 * suyo, como antes).
 */
export async function electPageNameColor(worker, snapshot, activeCells, cellW, textSrcY, textSrcH, theme) {
    if (!worker || !activeCells.length) return null;

    const cands = VisionService.pageNameColorCandidates(
        snapshot, activeCells.map(a => a.cell), cellW, textSrcY, textSrcH);
    // Se muestrean más celdas que confirmaciones hacen falta: una puede venir con el
    // nombre cortado, estar vacía (ya no vienen prefiltradas) o ser un ítem que el
    // matcher no resuelve.
    const sample = activeCells.slice(0, HITS_NEEDED + MISSES_ALLOWED + 2);

    let single = null; // color que solo convenció a una celda: mejor que nada si nadie llega a dos
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

// Por debajo de esto el recorte no tiene texto: una celda vacía sale toda blanca (tinta 0)
// y una con nombre da ~6000, así que el corte solo deja fuera lo verdaderamente vacío.
const MIN_INK = 20;

function countInk(cvs) {
    const px = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
    let ink = 0;
    for (let p = 0; p < px.length; p += 4) if (px[p] < 55) ink++;
    return ink;
}

/**
 * Máscara binarizada de la banda de nombre de UNA celda (texto NEGRO sobre BLANCO).
 *
 * Si con el color de la página no queda tinta, vuelve a medir el color EN LA CELDA: el
 * color de página lo vota el conjunto y puede no aislar el nombre en una concreta (arte
 * del mismo tono, tinte de misión sobre esa card). Así "sin tinta" solo significa celda
 * vacía cuando tampoco la encuentra su propio color.
 *
 * @returns { cvs, ink, ownColor } — ownColor: si la máscara salió del color de la celda
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

/** ¿Hay tinta suficiente en la máscara para intentar leerla? */
export function hasInk(ink) {
    return ink >= MIN_INK;
}

/** Lee la banda de nombre de una celda binarizando con el color medido EN ella. */
export function readCellWithOwnColor(worker, snapshot, cell, cellW, textSrcY, textSrcH, theme) {
    return OCRService.extractCellText(worker, VisionService.cropThemeBinarized(
        snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme, null));
}
