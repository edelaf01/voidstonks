import { segmentDigits, NW, NH } from "./badge_digit_ocr.js";

/**
 * Is the last digit of a relic code a 5 or a 6? Tesseract mixes them up in the name font ("Lith A5" noted
 * as "Lith A6"), and since both relics exist the matcher cannot tell. The badge templates do not work on this
 * font; these are the mean of real fives and sixes cropped from recorded pages (24×32, 16 levels). Below the
 * margin it abstains and the OCR decides.
 */
const PLANTILLA_5 = "0004ceeeeeeeeeeeeeeeec32004effffffffffffffffff7200dfffffffffffffffffffd200efffffffffffffffffffd200efffff322222222222222200efffeb222222222222222201efffe7221111112222222202efffe7210000000000000002ffffd4210000000000000005ffffd3210000000000000006ffffc3210000000000000008ffffd420000110000000002bfffffdddddddddeed210004cffffffedddddddeeeea1004dffffffedddddddeeeeed116effffff4000000aeeeeeeb17effff321000000007deeee429ffd42110000000008deeeb0122222110000000001adeee11222222100000001117deee11222222211111111115eeee11222222211112222224eeee12222222222222222225efff16fe4222222222222226efffefffe722222111112229ffff8ffffd2222111111113efffe4dffff321111000000cefff827fffffc110000001bdeefe422efffeeed10019deeeeee321119eeeeddddddddeeeed3221111aeedddddddddeeee111200111104ddddddddd3100001";
const PLANTILLA_6 = "00000000113bcdee6332111000111111cdfffffffff73332001111cdffffffffffffa43300118effffffffffffffa4330003eeeeee93100111a61113004deeeeb31000001111111100deeeec200000001111111104eeee8200000000111111110beeee2100000000111111116eeeed2000000000111111119eeeea100000000011111111deeed7100000000011111111eeeed7100000000011111111eeeeeb2000bceeeeffd53332eeeeee9aceeeeeeeffffc433eeeeeeeea2100006ccdffe44eeeeee720000000015ccded4eeeeee2000000000116ccdd9eeeec60000000000111bccdceeeec500000000001115ccddeeeec500000000001113ccdddeeec610000000001112ccddbeeee910000000001113ccdd6eeeed20000000001114ccdd2deeee21000000001119ccdd06eeee8200000000113ccdde00deeeea1000000011bccdfb00aeeeee920000001ccdeff60006eeeeeed8219bcdffff740000adeeeeeeeeeefffff733000001ceeeeeeeeeffff443300000000acdeeeeef7332111";
export const MARGEN_56 = 0.15;

const nivel = (p, i) => parseInt(p[i], 16) / 15;

/** Correlation (-1..1) of the segmentDigits normalized glyph against a template. */
function correlacion(bmp, plantilla) {
    let s = 0;
    for (let i = 0; i < NW * NH; i++) s += (bmp[i] ? 1 : -1) * (nivel(plantilla, i) * 2 - 1);
    return s / (NW * NH);
}

/**
 * Binarizes an RGBA color crop (light text on dark background) to the format segmentDigits splits: black
 * digits (R=0) on white. Threshold halfway between the max and the mean of the max channel, which is what
 * splits stroke from background in these cells.
 */
export function binarizaTexto(canvasLike) {
    const { width, height, data } = canvasLike;
    const n = width * height, v = new Uint8Array(n);
    let mx = 0, suma = 0;
    for (let i = 0; i < n; i++) { v[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); if (v[i] > mx) mx = v[i]; suma += v[i]; }
    const umbral = (mx + suma / n) / 2;
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { const b = v[i] > umbral ? 0 : 255; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = b; out[i * 4 + 3] = 255; }
    return { width, height, data: out };
}

/**
 * @param canvasLike RGBA color crop of the code WORD ("A5")
 * @returns {{ digito: "5"|"6"|null, margen: number }} null when there is no glyph or the margin falls short
 */
export function distingue56(canvasLike) {
    const comps = segmentDigits(binarizaTexto(canvasLike));
    if (!comps.length) return { digito: null, margen: 0 };
    const ultimo = comps.sort((a, b) => a.x - b.x).at(-1);
    const c5 = correlacion(ultimo.bmp, PLANTILLA_5), c6 = correlacion(ultimo.bmp, PLANTILLA_6);
    const margen = Math.abs(c5 - c6);
    return { digito: margen >= MARGEN_56 ? (c5 > c6 ? "5" : "6") : null, margen };
}

/** "Lith A5" -> "Lith A6" and back; null when the code does not end in 5/6. */
export function alternativa56(nombre) {
    const m = /^(.*\d*)([56])$/.exec(nombre || "");
    return m ? `${m[1]}${m[2] === "5" ? "6" : "5"}` : null;
}

/**
 * Fixes the 5/6 of an already matched relic. Only acts if the other relic exists, if among the words read
 * there is one that is the code (with its box) and if the glyph decides with margin.
 *
 * @param nombre   what getRelicMatch returned
 * @param words    OCR words of the cell, with bbox
 * @param recorta  (bbox) => RGBA canvasLike of the crop, or null
 * @param existe   (nombre) => true when that relic is in the catalog
 * @returns {{ nombre: string, cambiado: boolean, margen?: number }}
 */
export function corrige56(nombre, words, recorta, existe) {
    const otra = alternativa56(nombre);
    if (!otra || !existe(otra)) return { nombre, cambiado: false };
    const codigo = nombre.split(" ").pop().toUpperCase();
    const limpia = (w) => String(w?.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    // the code word as it was read: it can carry the other digit, hence compared without it
    const palabra = (words || []).find((w) => w?.bbox && limpia(w).slice(0, -1) === codigo.slice(0, -1) && /[56]$/.test(limpia(w)));
    if (!palabra) return { nombre, cambiado: false };
    const recorte = recorta(palabra.bbox);
    if (!recorte) return { nombre, cambiado: false };
    const { digito, margen } = distingue56(recorte);
    if (!digito || digito === codigo.at(-1)) return { nombre, cambiado: false, margen };
    return { nombre: otra, cambiado: true, margen };
}
