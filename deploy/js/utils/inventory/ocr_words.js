/**
 * Normaliza las palabras que devuelve el OCR antes de que parseRewards las use: separa las que
 * llegan pegadas, mapea cada token al término del catálogo más parecido y descarta el resto.
 *
 * Vive fuera de ocr.service.js porque ese fichero está en su techo de tamaño y esto es una
 * etapa con entrada y salida propias, testeable sin arrastrar el servicio entero.
 */
import { recoverClippedToken } from "../vision/clipped_token.js";
import { splitFusedWords, catalogVocab } from "../vision/word_split.js";

export function normalizeOCRWords(ocrData, ctx) {
    const metaTokens = ["OWNED", "CRAFTED", "FORJA", "PROPIO", "PRDPIO", "0WNED", "OWN", "OWED"];
    const validWords = [];
    const knownTokens = Array.from(ctx.knownParts);

    // "BOLTORPRIMESTOCK": el anclaje de abajo pide la primera palabra exacta.
    ctx._vocabCache ||= catalogVocab(ctx.cachedDbItems);
    const palabras = splitFusedWords(ocrData.words, ctx._vocabCache);

    palabras.forEach(w => {
        let text = w.text.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        if (text.length < 1) return;

        if (metaTokens.includes(text) || /^\d+$/.test(text)) {
            validWords.push({
                text: text,
                x: (w.bbox.x0 + w.bbox.x1) / 2,
                y: (w.bbox.y0 + w.bbox.y1) / 2,
                raw: w.text
            });
            return;
        }

        // Normalización por similitud CONSCIENTE DE CONFUSIONES OCR (similarityOCR),
        // igual que getValidItemMatch — el parser de rewards se había quedado con la
        // Levenshtein plana a 0.75 y descartaba nombres con confusiones típicas
        // (p.ej. "CALIBAN" leído con li→ñ/h bajo el tinte rojo de fin de misión):
        // la palabra se tiraba y el ancla de la carta nunca llegaba a existir.
        // Se elige el MEJOR token (no el primero que pasa) para no colar un token
        // mediocre cuando existe otro más parecido.
        let matchedToken = knownTokens.includes(text) ? text : null;
        if (!matchedToken) {
            // Umbral alto sobre similarityOCR: un token del juego MAL LEÍDO difiere de
            // su forma real en sustituciones de glifo PARECIDO, que cuestan 0.4 cada
            // una — medido sobre casos reales queda en ~0.92-0.95 ("FRO5T", "STVANAX",
            // "RECELVER", "CAL1BAN"). Una palabra AJENA del fondo ("POST", "FRONT",
            // "ROST"…) difiere en letras SIN parecido o en longitud y no pasa de ~0.80.
            // Con el umbral viejo (0.72) "POST" se convertía en "FROST" y fabricaba un
            // ancla fantasma que robaba "Prime Chassis Blueprint" a la recompensa vecina.
            const minScore = 0.85;
            let best = null, bestScore = 0, segundo = 0;
            for (const token of knownTokens) {
                const s = ctx.similarityOCR(text, token);
                if (s > bestScore) { segundo = bestScore; bestScore = s; best = token; }
                else if (s > segundo) segundo = s;
            }
            const cx = (w.bbox.x0 + w.bbox.x1) / 2 / (ocrData.imageW || 1);
            const dentro = ocrData.columnas?.some((c) => cx >= c.x0 && cx <= c.x1);   // en tarjeta
            matchedToken = (bestScore >= minScore || (best && text.length >= (dentro ? 5 : 6)
                && ctx.editDistance(text, best) === 1 && bestScore - segundo >= 0.12)) ? best : null;
            if (!matchedToken) {
                matchedToken = recoverClippedToken(
                    text, knownTokens, (a, b) => ctx.similarityOCR(a, b));
            }
        }

        if (matchedToken) {
            validWords.push({
                text: matchedToken,
                x: (w.bbox.x0 + w.bbox.x1) / 2,
                y: (w.bbox.y0 + w.bbox.y1) / 2,
                raw: w.text
            });
        }
    });
    return validWords;
}

/**
 * Tokens que salen en tantos nombres del catálogo que no distinguen NADA.
 *
 * Medido sobre el catálogo real: PRIME 99,7 % y BLUEPRINT 54,4 %, y el siguiente ya está en el
 * 9,6 % — el corte no es delicado, hay un abismo entre los dos grupos.
 */
export function tokensSinInformacion(items, frac = 0.20, minMuestra = 20) {
    // "Genérico" es una afirmación estadística y necesita muestra: con un catálogo de tres
    // piezas, CUALQUIER token sale en más del 20 % y se declararían genéricos todos — con lo
    // que ninguna coincidencia tendría evidencia propia y el escáner dejaría de casar nada.
    // Pasa de verdad: `state.itemsDatabase` se llena desde la API y puede estar a medias.
    if (items.length < minMuestra) return new Set();
    const cuenta = new Map();
    for (const item of items) {
        for (const t of new Set(item.searchWords)) cuenta.set(t, (cuenta.get(t) || 0) + 1);
    }
    return new Set([...cuenta.entries()].filter(([, c]) => c > items.length * frac).map(([t]) => t));
}

/**
 * ¿La coincidencia se sostiene en algo PROPIO del nombre?
 *
 * "BLUEPRINT" sale en más de la mitad del catálogo y lo puede estar poniendo la tarjeta VECINA
 * (la ventana del ancla llega hasta 0,26·W). Si lo único que queda del nombre son dos letras, no
 * hay coincidencia: hay dos caracteres. Medido en una captura a 540p, un "Bo" de ruido del arte
 * daba "Bo Prime Blueprint" con ratio 1,00 tomando prestado el BLUEPRINT del Forma de al lado —y
 * el alta es automática y de suma, así que inventar cuesta más que perder. El único nombre base
 * de dos letras del catálogo es "Bo".
 */
export function tieneEvidenciaPropia(searchTokens, localWords, genericos) {
    return searchTokens.some((t) => t.length >= 3 && !genericos.has(t)
        && localWords.some((w) => w.text === t));
}
