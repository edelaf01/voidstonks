/**
 * Parte un token que el OCR entregó con las palabras PEGADAS ("BOLTORPRIMESTOCK") usando el
 * vocabulario del catálogo, no una lista escrita a mano.
 *
 * Pasa de verdad: en la pantalla de fisura los rótulos salen sin espacios y el anclaje de
 * parseRewards busca la primera palabra exacta, así que la tarjeta entera se perdía.
 *
 * Programación dinámica sobre las posiciones del token: o existe una partición en palabras
 * conocidas o no existe. Se prefiere la de MENOS palabras, que evita trocear un nombre largo
 * en fragmentos cortos que casualmente estén en el vocabulario.
 */
export function splitFusedWord(token, vocab, { minLargo = 3 } = {}) {
    const n = token.length;
    // Una palabra que ya existe no se toca: si no, el modo prefijo partiría "PRIMED" en "PRIME".
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
    // Sin partición completa se acepta el PREFIJO más largo que sí lo sea: el arte de la
    // tarjeta se pega al final del rótulo ("LAVOSTTMD" por "LAVOS") y sin esto la tarjeta
    // entera se perdía.
    let fin = n, resto = null;
    if (!mejor[n] || mejor[n].palabras < 2) {
        fin = -1;
        // Un prefijo de 3 letras es una razón demasiado floja para partir; con 4 ya hay
        // palabra reconocible detrás de la decisión.
        for (let i = n - 1; i >= Math.max(4, minLargo); i--) if (mejor[i]) { fin = i; break; }
        if (fin < 0 || mejor[fin].palabras < 1) return null;
        // El RESTO viaja como token aparte en vez de tirarse. Una de las dos palabras pegadas
        // puede venir mal leída y entonces no está en el vocabulario: "PRIMEBIUEPRINT" (l -> i)
        // solo casaba "PRIME", que no llega a la mitad del token, y se perdían las DOS —con
        // ellas la tarjeta entera, medido en una captura a 1080p. Devolviéndolo, "BIUEPRINT" se
        // lo queda la normalización, que sí sabe de confusiones de glifo. Si es basura del arte
        // ("TTMD"), no resuelve contra el catálogo y se cae allí: no cuesta nada.
        resto = token.slice(fin);
    }
    const salida = [];
    for (let i = fin; i > 0; i = mejor[i].desde) salida.unshift(mejor[i].palabra);
    if (resto) salida.push(resto);
    return salida.length ? salida : null;
}

/** Vocabulario del catálogo: todas las palabras de todos los nombres, en mayúsculas. */
export function catalogVocab(items) {
    return new Set(items.flatMap((i) => i.originalName.toUpperCase().split(/\s+/)));
}

/** Reparte la caja de una palabra entre sus trozos, a prorrata de las letras. */
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
 * Corta por CAMBIO DE CAJA, pero solo donde el vocabulario confirma la juntura.
 *
 * Los motores de red pegan palabras conservando la mayúscula de la siguiente
 * ("LavosRrimeChassis"), así que el cambio de caja marca dónde estaba el espacio. Pero cortar
 * en TODOS parte también las palabras con una mayúscula por error de lectura: medido, "Lex
 * Prime ReceIver" se convertía en "Rece Iver" y la pieza se perdía entera.
 *
 * Lo que separa los dos casos es la palabra ENTERA: "RECEIVER" está en el catálogo y no hay
 * nada que partir; "LAVOSRRIMECHASSIS" no, y sus trozos tampoco tienen por qué estarlo —vienen
 * mal leídos ("Rrime" por "Prime")—, así que exigir que la juntura la confirme el vocabulario
 * no vale: se comprueba antes de cortar, no en cada corte.
 */
function cortaPorCaja(texto, vocab) {
    const limpio = texto.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
    if (!limpio || vocab.has(limpio)) return null;
    const trozos = [];
    let ini = 0;
    for (let i = 1; i < texto.length; i++) {
        // La minúscula anterior puede llevar detrás un signo que el OCR se inventó ("Lavos/R").
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
 * Parte las palabras pegadas de una lista de palabras del OCR, repartiendo la caja a
 * prorrata de las letras — que es lo que necesita el agrupado por columnas de parseRewards.
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
