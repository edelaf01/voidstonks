/**
 * how OCR text arrives WRECKED, to sweep the matcher without captures; three kinds of damage, each breaking parsing elsewhere:
 * - SUBSTITUTION between similar glyphs ("FRO5T", "CAL1BAN", "RECELVER")
 * - UNREADABLE WORD: losing the component turns "Zephyr Prime Neuroptics Blueprint" into ANOTHER part
 * - MERGE of two adjacent words ("CalibadPrimeBlueprint"), which eats the separator the column split relies on
 * the groups are the ones `similarityOCR` uses in ocr.service.js, keep both in sync
 */
const GRUPOS = ["O0QDCG", "IL1T|J", "S5", "B8", "G6", "Z2", "UV", "NMH", "PF", "EF", "RT", "VY", "A4", "KR", "Q9"];
const MAPA = new Map();
for (const g of GRUPOS) for (const ch of g) MAPA.set(ch, g);

/** deterministic PRNG: a fuzz you cannot repeat does not help diagnose */
export function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** swaps letters for others in the same confusion group, with probability `p` per letter */
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
 * degrades the words of ONE label
 * @param {"limpio"|"confusion"|"pierde"|"funde"} averia
 * @param {number} [idx]
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
