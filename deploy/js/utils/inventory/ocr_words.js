/**
 * Normalizes the OCR words before parseRewards uses them: splits glued ones, maps each token to the
 * closest catalog term and drops the rest.
 */
import { recoverClippedToken } from "../vision/clipped_token.js";
import { splitFusedWords, catalogVocab } from "../vision/word_split.js";

export function normalizeOCRWords(ocrData, ctx) {
    const metaTokens = ["OWNED", "CRAFTED", "FORJA", "PROPIO", "PRDPIO", "0WNED", "OWN", "OWED"];
    const validWords = [];
    const knownTokens = Array.from(ctx.knownParts);

    // "BOLTORPRIMESTOCK": the anchoring below needs the exact first word
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

        // OCR confusion aware similarity (similarityOCR), like getValidItemMatch; the BEST token wins, not the
        // first that passes
        let matchedToken = knownTokens.includes(text) ? text : null;
        if (!matchedToken) {
            // high threshold: a misread game token differs by look-alike glyphs ("FRO5T", "CAL1BAN"), a foreign
            // background word ("POST", "FRONT") does not, and at 0.72 "POST" became "FROST"
            const minScore = 0.85;
            let best = null, bestScore = 0, segundo = 0;
            for (const token of knownTokens) {
                const s = ctx.similarityOCR(text, token);
                if (s > bestScore) { segundo = bestScore; bestScore = s; best = token; }
                else if (s > segundo) segundo = s;
            }
            const cx = (w.bbox.x0 + w.bbox.x1) / 2 / (ocrData.imageW || 1);
            const dentro = ocrData.columnas?.some((c) => cx >= c.x0 && cx <= c.x1);   // on a card
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
 * Tokens in so many catalog names that they tell NOTHING apart (PRIME, BLUEPRINT).
 */
export function tokensSinInformacion(items, frac = 0.20, minMuestra = 20) {
    // "generic" is statistical and needs a sample: with three parts every token would be generic.
    // `state.itemsDatabase` fills from the API and can be half loaded
    if (items.length < minMuestra) return new Set();
    const cuenta = new Map();
    for (const item of items) {
        for (const t of new Set(item.searchWords)) cuenta.set(t, (cuenta.get(t) || 0) + 1);
    }
    return new Set([...cuenta.entries()].filter(([, c]) => c > items.length * frac).map(([t]) => t));
}

/**
 * Does the match rest on something OWN to the name? "BLUEPRINT" can come from the NEIGHBOUR card, and
 * if all that is left of the name is two letters there is no match. The only two letter base name in the
 * catalog is "Bo".
 */
export function tieneEvidenciaPropia(searchTokens, localWords, genericos) {
    return searchTokens.some((t) => t.length >= 3 && !genericos.has(t)
        && localWords.some((w) => w.text === t));
}
