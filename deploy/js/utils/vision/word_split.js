/**
 * Splits a token the OCR delivered with GLUED words ("BOLTORPRIMESTOCK") using the catalog vocabulary, not a
 * hand written list. On the fissure screen labels come without spaces and the parseRewards anchor looks for
 * the exact first word.
 *
 * Dynamic programming over the token positions: a partition into known words exists or not. The one with
 * FEWEST words wins, so a long name is not chopped into short fragments that happen to be in the vocabulary.
 */
export function splitFusedWord(token, vocab, { minLargo = 3 } = {}) {
    const n = token.length;
    // an existing word is left alone, otherwise prefix mode would split "PRIMED" into "PRIME"
    if (!n || vocab.has(token)) return null;
    const mejor = new Array(n + 1).fill(null);
    mejor[0] = { palabras: 0, desde: -1, palabra: "" };
    for (let i = 0; i < n; i++) {
        if (!mejor[i]) continue;
        for (let j = i + minLargo; j <= n; j++) {
            const trozo = token.slice(i, j);
            if (!vocab.has(trozo)) continue;
            const cand = { palabras: mejor[i].palabras + 1, desde: i, palabra: trozo };
            if (!mejor[j] || cand.palabras < mejor[j].palabras) mejor[j] = cand;
        }
    }
    // with no full partition the longest PREFIX that is one is taken: card art glues onto the end of the label
    // ("LAVOSTTMD" for "LAVOS")
    let fin = n, resto = null;
    if (!mejor[n] || mejor[n].palabras < 2) {
        fin = -1;
        // a 3 letter prefix is too weak a reason to split
        for (let i = n - 1; i >= Math.max(4, minLargo); i--) if (mejor[i]) { fin = i; break; }
        if (fin < 0 || mejor[fin].palabras < 1) return null;
        // the REST travels as its own token instead of being dropped: one of the glued words can be misread and
        // missing from the vocabulary ("PRIMEBIUEPRINT"), and the normalization knows glyph confusions. Art garbage
        // ("TTMD") just does not resolve against the catalog
        resto = token.slice(fin);
    }
    const salida = [];
    for (let i = fin; i > 0; i = mejor[i].desde) salida.unshift(mejor[i].palabra);
    if (resto) salida.push(resto);
    return salida.length ? salida : null;
}

/** Catalog vocabulary: every word of every name, uppercase. */
export function catalogVocab(items) {
    return new Set(items.flatMap((i) => i.originalName.toUpperCase().split(/\s+/)));
}

/** Splits a word box among its pieces, prorated by letters. */
function reparte(w, trozos, largo) {
    const { x0, x1 } = w.bbox;
    let usado = 0;
    return trozos.map((p) => {
        const a = x0 + (x1 - x0) * (usado / largo);
        usado += p.length;
        return { ...w, text: p, bbox: { ...w.bbox, x0: a, x1: x0 + (x1 - x0) * (usado / largo) } };
    });
}

/**
 * Splits at CASE CHANGES, only where the vocabulary confirms the joint. Network engines glue words keeping
 * the next one's capital ("LavosRrimeChassis"), but splitting at EVERY change also breaks words with a
 * misread capital ("ReceIver"). The WHOLE word tells them apart: "RECEIVER" is in the catalog and there is
 * nothing to split; "LAVOSRRIMECHASSIS" is not, and its pieces may be misread too, so the check is made
 * before splitting, not at each split.
 */
function cortaPorCaja(texto, vocab) {
    const limpio = texto.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
    if (!limpio || vocab.has(limpio)) return null;
    const trozos = [];
    let ini = 0;
    for (let i = 1; i < texto.length; i++) {
        // the previous lowercase can be followed by a symbol the OCR made up ("Lavos/R")
        const prev = texto.slice(ini, i).replace(/[^A-Za-z0-9]+$/, "").slice(-1);
        if (!/[a-z]/.test(prev) || !/[A-Z]/.test(texto[i])) continue;
        trozos.push(texto.slice(ini, i));
        ini = i;
    }
    if (!trozos.length) return null;
    trozos.push(texto.slice(ini));
    return trozos;
}

/**
 * Splits the glued words of an OCR word list, prorating the box by letters, as parseRewards' column grouping
 * needs.
 */
export function splitFusedWords(words, vocab, { minLargo = 9 } = {}) {
    const porCaja = words.flatMap((w) => {
        const trozos = cortaPorCaja(w.text, vocab);
        return trozos ? reparte(w, trozos, w.text.length) : [w];
    });
    return porCaja.flatMap((w) => {
        const t = w.text.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        const trozos = t.length >= minLargo && !vocab.has(t) && splitFusedWord(t, vocab);
        return trozos ? reparte(w, trozos, t.length) : [w];
    });
}
