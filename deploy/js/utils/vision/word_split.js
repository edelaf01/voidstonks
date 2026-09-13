// splits fused OCR words using catalog vocabulary and dynamic programming
export function splitFusedWord(token, vocab, { minLargo = 3, pareceConocida = null } = {}) {
    const n = token.length;
    // existing words are left alone so prefix mode does not split "PRIMED" into "PRIME"
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
    let fin = n, resto = null;
    if (!mejor[n] || mejor[n].palabras < 2) {
        fin = -1;
        for (let i = n - 1; i >= Math.max(4, minLargo); i--) if (mejor[i]) { fin = i; break; }
        if (fin < 0 || mejor[fin].palabras < 1) {
            if (pareceConocida?.(token)) return null;
            for (let i = minLargo; i <= n - 4; i++) {
                if (vocab.has(token.slice(i))) return [token.slice(0, i), token.slice(i)];
            }
            return null;
        }
        resto = token.slice(fin);
    }
    const salida = [];
    for (let i = fin; i > 0; i = mejor[i].desde) salida.unshift(mejor[i].palabra);
    if (resto) salida.push(resto);
    return salida.length ? salida : null;
}

export function catalogVocab(items) {
    return new Set(items.flatMap((i) => i.originalName.toUpperCase().split(/\s+/)));
}

export function pareceDelVocab(vocab, similitud, umbral = 0.85) {
    const palabras = [...vocab].filter((v) => v.length >= 4);
    return (token) => palabras.some((v) => Math.abs(v.length - token.length) <= 2 && similitud(token, v) >= umbral);
}

function reparte(w, trozos, largo) {
    const { x0, x1 } = w.bbox;
    let usado = 0;
    return trozos.map((p) => {
        const a = x0 + (x1 - x0) * (usado / largo);
        usado += p.length;
        return { ...w, text: p, bbox: { ...w.bbox, x0: a, x1: x0 + (x1 - x0) * (usado / largo) } };
    });
}

function cortaPorCaja(texto, vocab) {
    const limpio = texto.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
    if (!limpio || vocab.has(limpio)) return null;
    const trozos = [];
    let ini = 0;
    for (let i = 1; i < texto.length; i++) {
        const prev = texto.slice(ini, i).replace(/[^A-Za-z0-9]+$/, "").slice(-1);
        if (!/[a-z]/.test(prev) || !/[A-Z]/.test(texto[i])) continue;
        trozos.push(texto.slice(ini, i));
        ini = i;
    }
    if (!trozos.length) return null;
    trozos.push(texto.slice(ini));
    return trozos;
}

export function splitFusedWords(words, vocab, { minLargo = 9, pareceConocida = null } = {}) {
    const porCaja = words.flatMap((w) => {
        const trozos = cortaPorCaja(w.text, vocab);
        return trozos ? reparte(w, trozos, w.text.length) : [w];
    });
    return porCaja.flatMap((w) => {
        const t = w.text.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        const trozos = t.length >= minLargo && !vocab.has(t) && splitFusedWord(t, vocab, { pareceConocida });
        return trozos ? reparte(w, trozos, t.length) : [w];
    });
}
