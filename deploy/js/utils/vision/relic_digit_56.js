import { segmentDigits, NW, NH } from "./badge_digit_ocr.js";

/**
 * ¿El último dígito del código de una reliquia es un 5 o un 6? Tesseract los confunde en la
 * fuente de los nombres ("Lith A5" apuntada como "Lith A6"), y como las dos reliquias existen el
 * matcher no puede saberlo. Las plantillas de los badges no valen (92 % sobre esta fuente); estas
 * son la media de 50 cincos y 54 seises reales recortados de las páginas grabadas
 * (24×32, 16 niveles). Validado dejando fuera cada muestra: con margen ≥ 0,15 decide en 95 de 104
 * sin fallar ninguna; por debajo se abstiene y manda el OCR.
 */
const PLANTILLA_5 = "0004ceeeeeeeeeeeeeeeec32004effffffffffffffffff7200dfffffffffffffffffffd200efffffffffffffffffffd200efffff322222222222222200efffeb222222222222222201efffe7221111112222222202efffe7210000000000000002ffffd4210000000000000005ffffd3210000000000000006ffffc3210000000000000008ffffd420000110000000002bfffffdddddddddeed210004cffffffedddddddeeeea1004dffffffedddddddeeeeed116effffff4000000aeeeeeeb17effff321000000007deeee429ffd42110000000008deeeb0122222110000000001adeee11222222100000001117deee11222222211111111115eeee11222222211112222224eeee12222222222222222225efff16fe4222222222222226efffefffe722222111112229ffff8ffffd2222111111113efffe4dffff321111000000cefff827fffffc110000001bdeefe422efffeeed10019deeeeee321119eeeeddddddddeeeed3221111aeedddddddddeeee111200111104ddddddddd3100001";
const PLANTILLA_6 = "00000000113bcdee6332111000111111cdfffffffff73332001111cdffffffffffffa43300118effffffffffffffa4330003eeeeee93100111a61113004deeeeb31000001111111100deeeec200000001111111104eeee8200000000111111110beeee2100000000111111116eeeed2000000000111111119eeeea100000000011111111deeed7100000000011111111eeeed7100000000011111111eeeeeb2000bceeeeffd53332eeeeee9aceeeeeeeffffc433eeeeeeeea2100006ccdffe44eeeeee720000000015ccded4eeeeee2000000000116ccdd9eeeec60000000000111bccdceeeec500000000001115ccddeeeec500000000001113ccdddeeec610000000001112ccddbeeee910000000001113ccdd6eeeed20000000001114ccdd2deeee21000000001119ccdd06eeee8200000000113ccdde00deeeea1000000011bccdfb00aeeeee920000001ccdeff60006eeeeeed8219bcdffff740000adeeeeeeeeeefffff733000001ceeeeeeeeeffff443300000000acdeeeeef7332111";
export const MARGEN_56 = 0.15;

const nivel = (p, i) => parseInt(p[i], 16) / 15;

/** Correlación (-1..1) del glifo normalizado de segmentDigits contra una plantilla. */
function correlacion(bmp, plantilla) {
    let s = 0;
    for (let i = 0; i < NW * NH; i++) s += (bmp[i] ? 1 : -1) * (nivel(plantilla, i) * 2 - 1);
    return s / (NW * NH);
}

/**
 * Binariza un recorte RGBA a color (texto claro sobre fondo oscuro) al formato que segmenta
 * segmentDigits: dígitos negros (R=0) sobre blanco. Umbral a medio camino entre el máximo y la
 * media del canal máximo, que es lo que separa el trazo del fondo en estas celdas.
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
 * @param canvasLike recorte RGBA de la PALABRA del código ("A5"), a color
 * @returns {{ digito: "5"|"6"|null, margen: number }} null si no hay glifo o el margen no llega
 */
export function distingue56(canvasLike) {
    const comps = segmentDigits(binarizaTexto(canvasLike));
    if (!comps.length) return { digito: null, margen: 0 };
    const ultimo = comps.sort((a, b) => a.x - b.x).at(-1);
    const c5 = correlacion(ultimo.bmp, PLANTILLA_5), c6 = correlacion(ultimo.bmp, PLANTILLA_6);
    const margen = Math.abs(c5 - c6);
    return { digito: margen >= MARGEN_56 ? (c5 > c6 ? "5" : "6") : null, margen };
}

/** "Lith A5" -> "Lith A6" y viceversa; null si el código no acaba en 5/6. */
export function alternativa56(nombre) {
    const m = /^(.*\d*)([56])$/.exec(nombre || "");
    return m ? `${m[1]}${m[2] === "5" ? "6" : "5"}` : null;
}

/**
 * Corrige el 5/6 de una reliquia ya casada. Solo actúa si la otra reliquia existe, si entre las
 * palabras leídas hay una que es el código (con su caja) y si el glifo decide con margen.
 *
 * @param nombre   lo que devolvió getRelicMatch
 * @param words    palabras OCR con bbox de la casilla
 * @param recorta  (bbox) => canvasLike RGBA del recorte, o null
 * @param existe   (nombre) => true si esa reliquia está en el catálogo
 * @returns {{ nombre: string, cambiado: boolean, margen?: number }}
 */
export function corrige56(nombre, words, recorta, existe) {
    const otra = alternativa56(nombre);
    if (!otra || !existe(otra)) return { nombre, cambiado: false };
    const codigo = nombre.split(" ").pop().toUpperCase();
    const limpia = (w) => String(w?.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    // La palabra del código tal como se leyó: puede traer el otro dígito, por eso se compara sin él.
    const palabra = (words || []).find((w) => w?.bbox && limpia(w).slice(0, -1) === codigo.slice(0, -1) && /[56]$/.test(limpia(w)));
    if (!palabra) return { nombre, cambiado: false };
    const recorte = recorta(palabra.bbox);
    if (!recorte) return { nombre, cambiado: false };
    const { digito, margen } = distingue56(recorte);
    if (!digito || digito === codigo.at(-1)) return { nombre, cambiado: false, margen };
    return { nombre: otra, cambiado: true, margen };
}
