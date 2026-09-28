/**
 * TRADING POST: seis casillas arriba (lo que das) y seis abajo (lo que recibes), medidas en vídeo a
 * pantalla completa (2560×1440). El panel va centrado y escala con el alto.
 */
const PASO = 0.2354, LADO = 0.2028, PRIMERA = -0.5882;
const FILA = { doy: 0.1931, recibo: 0.6243 };
// Desviación del máximo de canal en el icono: medido, casilla ocupada ~60 y vacía ~1,3.
export const TEXTURA_OCUPADA = 10;

export function casillaTradeo(lado, i, W, H) {
    const aspecto = W / H;
    const x = 0.5 + ((PRIMERA + i * PASO) - LADO / 2) / aspecto, w = LADO / aspecto;
    const y = FILA[lado], h = LADO;
    // Margen para desplazamientos de ~15 px: entre casillas hay 46 px vacíos.
    return {
        casilla: { x, y, w, h },
        icono: { x: x + w * 0.1, y: y + h * 0.08, w: w * 0.8, h: h * 0.55 },
        rotulo: { x: x - w * 0.07, y: y + h * 0.66, w: w * 1.14, h: h * 0.36 },
        // "✓ 77" arriba a la izquierda: la cantidad de platino, que el rótulo no dice. Empieza tras
        // el ✓, que leído como dígito convertía 80 en 20.
        cantidad: { x: x + w * 0.13, y: y - h * 0.03, w: w * 0.36, h: h * 0.19 },
    };
}

// INVENTORY/TRADE: a la derecha de la rejilla va el panel OFFERED, con ítems al mismo paso que colaban 2 columnas
// más. Medido a 2517×1425: la rejilla acaba en 0,693 del ancho y el panel empieza en 0,736.
export const ANCHO_REJILLA_TRADEO = 0.715;

// Con un diálogo abierto la pantalla se oscurece: el rótulo "TRADING POST" baja de 190 a 37-41 de brillo.
export const BRILLO_CON_DIALOGO = 100;

export const esTradeoHecho = (texto) => /TRADE\s*WAS\s*SUCCESS|INTERCAMBIO.{0,40}[EÉ]XITO/i.test(String(texto || ""));

/** El diálogo va centrado y escala con el alto; crece hacia arriba y abajo con la lista de ítems. */
export function dialogoTradeo(W, H) {
    const mitad = (0.285 * H) / W;
    return { x: 0.5 - mitad, y: 0.28, w: 2 * mitad, h: 0.46 };
}

const normaliza = (s) => String(s || "").toUpperCase().replaceAll(/[^A-Z]/g, "");

function levenshtein(a, b) {
    const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let diag = fila[0];
        fila[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const arriba = fila[j];
            fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = arriba;
        }
    }
    return fila[b.length];
}

const parecido = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/**
 * El arcano que nombra el rótulo, o null. `tradables` es { slug: [nombre EN, nombre ES, rango máx] }.
 * Se prueban la primera línea y las dos primeras juntas: debajo va la línea de rombos del rango.
 */
export function arcanoDelRotulo(texto, tradables) {
    const lineas = String(texto || "").split("\n").map(normaliza).filter((l) => l.length >= 4);
    const candidatos = [lineas[0], (lineas[0] || "") + (lineas[1] || "")].filter(Boolean);
    let mejor = null, segundo = 0;
    for (const [slug, [en, es, maxRank]] of Object.entries(tradables || {})) {
        const s = Math.max(...candidatos.flatMap((c) => [parecido(c, normaliza(en)), parecido(c, normaliza(es))]));
        if (!mejor || s > mejor.s) { segundo = mejor?.s ?? 0; mejor = { s, slug, name: en, maxRank }; }
        else if (s > segundo) segundo = s;
    }
    return mejor && mejor.s >= 0.85 && mejor.s - segundo >= 0.08 ? { slug: mejor.slug, name: mejor.name, maxRank: mejor.maxRank } : null;
}

/**
 * La lista de la confirmación ("You are offering: … will receive from X the following: …"), o null.
 * Lo que no es prime, arcano ni platino entra como "otro".
 */
export function leeDialogoTradeo(texto, opciones = {}) {
    const lineas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const i = lineas.findIndex((l) => /OFFERING/i.test(l)), j = lineas.findIndex((l) => /WILL\s*RECEIVE/i.test(l));
    if (i < 0 || j < i) return null;
    const k = lineas.findIndex((l, n) => n >= j && /FOLLOWING/i.test(l));
    const fin = lineas.findIndex((l, n) => n > k && /CANCEL|^OK\b/i.test(l));
    // El borde del diálogo y el cursor dejan letras sueltas en los extremos ("T Ayatan Piv Sculpture I")
    // y alguna línea de una sola ("b").
    const otro = (l) => {
        const palabras = l.replaceAll(/[^A-Za-z0-9' -]/g, " ").trim().split(/\s+/);
        while (palabras.length && palabras[0].length < 2) palabras.shift();
        while (palabras.length && palabras.at(-1).length < 2) palabras.pop();
        const name = palabras.join(" ");
        return name.replaceAll(" ", "").length >= 4 ? { tipo: "otro", name, qty: 1 } : null;
    };
    const items = (ls) => ls.map((l) => leeCasillaTradeo(l, opciones) || otro(l)).filter(Boolean);
    return { doy: items(lineas.slice(i + 1, j)), recibo: k < 0 ? [] : items(lineas.slice(k + 1, fin < 0 ? undefined : fin)) };
}

/**
 * Qué hay en una casilla, o null si no se reconoce. `matchPrime` recibe el texto y devuelve el
 * match del catálogo de piezas (OCRService.getValidItemMatch).
 */
export function leeCasillaTradeo(texto, { tradables, matchPrime } = {}) {
    const t = String(texto || "");
    const cantidad = Number(/(?:^|\s)(\d+)\s*[X×]\s/i.exec(t)?.[1] || /[X×]\s?(\d+)\b/i.exec(t)?.[1] || 1);
    if (/PLAT[I1L]NUM|PLATINO/i.test(t)) return { tipo: "platino", name: "Platinum", qty: Number(/(\d[\d,.]*)/.exec(t)?.[1]?.replaceAll(/[,.]/g, "") || 0) };
    const arcano = arcanoDelRotulo(t, tradables);
    if (arcano) return { tipo: "arcano", ...arcano, qty: cantidad };
    const prime = matchPrime?.(t.replaceAll(/\s+/g, " ").trim().toUpperCase());
    return prime?.isPrime ? { tipo: "prime", name: prime.originalName, qty: cantidad } : null;
}
