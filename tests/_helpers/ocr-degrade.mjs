/**
 * Modelo de cómo llega el texto DESTROZADO desde el OCR, para barrer el matcher sin capturas.
 *
 * No es ruido al azar: las averías que se ven en las capturas del usuario son de tres tipos y
 * cada una rompe el parseo por un sitio distinto.
 *
 *   - SUSTITUCIÓN entre glifos parecidos. La que más aparece y la que el matcher está pensado
 *     para absorber ("FRO5T", "CAL1BAN", "RECELVER").
 *   - PALABRA ILEGIBLE. La grave: al perder el componente, "Zephyr Prime Neuroptics Blueprint"
 *     se convierte en "Zephyr Prime Blueprint", que es OTRA pieza y se da de alta igual. Medido
 *     en una captura roja a 1440p: el OCR devolvió "noatoptics" (0.76 de parecido), por debajo
 *     del 0.85 con el que normalizeOCRWords descarta, así que la palabra no llegaba al rescate.
 *   - FUSIÓN de dos palabras contiguas ("CalibadPrimeBlueprint"), que se come el separador del
 *     que vive todo el reparto por columnas.
 *
 * Los grupos son los mismos que usa `similarityOCR` en ocr.service.js: si allí se cambian y aquí
 * no, este generador deja de producir el ruido que el matcher dice absorber.
 */
const GRUPOS = ["O0QDCG", "IL1T|J", "S5", "B8", "G6", "Z2", "UV", "NMH", "PF", "EF", "RT", "VY", "A4", "KR", "Q9"];
const MAPA = new Map();
for (const g of GRUPOS) for (const ch of g) MAPA.set(ch, g);

/** PRNG determinista: un fuzz que no se puede repetir no sirve para diagnosticar. */
export function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Sustituye letras por otras de su mismo grupo de confusión, con probabilidad `p` por letra. */
export function confunde(texto, rnd, p = 0.2) {
    let out = "";
    for (const ch of texto) {
        const g = MAPA.get(ch.toUpperCase());
        if (g && rnd() < p) {
            const alt = g[Math.floor(rnd() * g.length)];
            out += ch === ch.toLowerCase() ? alt.toLowerCase() : alt;
        } else out += ch;
    }
    return out;
}

/**
 * Degrada las palabras de UN rótulo.
 * @param {"limpio"|"confusion"|"pierde"|"funde"} averia
 * @param {number} [idx] qué palabra sufre la avería; por defecto una al azar que no sea PRIME.
 */
export function degradaRotulo(palabras, averia, rnd, idx = null) {
    const ws = [...palabras];
    const elegible = ws.map((w, i) => i).filter((i) => ws[i].toUpperCase() !== "PRIME");
    const i = idx ?? elegible[Math.floor(rnd() * elegible.length)];
    if (averia === "confusion") ws[i] = confunde(ws[i], rnd, 0.25);
    else if (averia === "pierde") ws.splice(i, 1);
    else if (averia === "funde" && i < ws.length - 1) ws.splice(i, 2, ws[i] + ws[i + 1]);
    return ws;
}
