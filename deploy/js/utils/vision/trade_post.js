/**
 * TRADING POST: six slots on top (what you give) and six below (what you get), measured on full screen video
 * (2560×1440). The panel is centered and scales with the height.
 */
const PASO = 0.2354, LADO = 0.2028, PRIMERA = -0.5882;
const FILA = { doy: 0.1931, recibo: 0.6243 };
// max channel deviation on the icon: an occupied slot ~60, an empty one ~1.3
export const TEXTURA_OCUPADA = 10;

export function casillaTradeo(lado, i, W, H) {
    const aspecto = W / H;
    const x = 0.5 + ((PRIMERA + i * PASO) - LADO / 2) / aspecto, w = LADO / aspecto;
    const y = FILA[lado], h = LADO;
    // margin for ~15 px shifts: slots are 46 px apart
    return {
        casilla: { x, y, w, h },
        icono: { x: x + w * 0.1, y: y + h * 0.08, w: w * 0.8, h: h * 0.55 },
        rotulo: { x: x - w * 0.07, y: y + h * 0.66, w: w * 1.14, h: h * 0.36 },
        // "✓ 77" top left: the platinum amount, which the label does not say. Starts after the ✓, read as a digit it
        // turned 80 into 20
        cantidad: { x: x + w * 0.13, y: y - h * 0.03, w: w * 0.36, h: h * 0.19 },
    };
}

// INVENTORY/TRADE: right of the grid is the OFFERED panel, with items at the same step that added 2 columns.
// The grid ends at 0.693 of the width and the panel starts at 0.736
export const ANCHO_REJILLA_TRADEO = 0.715;

// with a dialog open the screen dims: the "TRADING POST" label drops from 190 to ~40 brightness
export const BRILLO_CON_DIALOGO = 100;

export const esTradeoHecho = (texto) => /TRADE\s*WAS\s*SUCCESS|INTERCAMBIO.{0,40}[EÉ]XITO/i.test(String(texto || ""));

/** The dialog is centered and scales with the height; it grows up and down with the item list. */
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
 * The arcane the label names, or null. `tradables` is { slug: [EN name, ES name, max rank] }. The first line
 * and the first two together are tried: the rank diamonds line goes below.
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
 * The confirmation list ("You are offering: … will receive from X the following: …"), or null. Whatever is
 * not a prime, arcane or platinum goes in as "otro".
 */
export function leeDialogoTradeo(texto, opciones = {}) {
    const lineas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const i = lineas.findIndex((l) => /OFFERING/i.test(l)), j = lineas.findIndex((l) => /WILL\s*RECEIVE/i.test(l));
    if (i < 0 || j < i) return null;
    const k = lineas.findIndex((l, n) => n >= j && /FOLLOWING/i.test(l));
    const fin = lineas.findIndex((l, n) => n > k && /CANCEL|^OK\b/i.test(l));
    // the dialog edge and the cursor leave loose letters at the ends ("T Ayatan Piv Sculpture I") and some one
    // letter lines ("b")
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
 * What is in a slot, or null when not recognized. `matchPrime` takes the text and returns the parts catalog
 * match (OCRService.getValidItemMatch).
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
