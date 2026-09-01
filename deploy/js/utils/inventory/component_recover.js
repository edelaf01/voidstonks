/**
 * Rescues the REAL part when the label loses its component word: "Ash Prime Chassis Blueprint" reads as
 * "Ash Prime Blueprint", which also exists, so the auto add would log what did NOT drop.
 *
 * Bare blueprints are legit ("Caliban Prime Blueprint"): what decides is whether a component-like token
 * stayed in the SAME column.
 */
const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

/**
 * @param nombre    the matched item, e.g. "Gyre Prime Blueprint"
 * @param palabras  texts read in its column
 * @param existe    (name) => bool, against the real catalog
 * @param similar   (a, b) => 0..1, OCR confusion aware similarity
 */
export function recuperaComponente(nombre, palabras, existe, similar, umbral = 0.6) {
    const base = /^(.+ Prime) Blueprint$/.exec(nombre);
    if (!base) return nombre;
    let mejor = null, mejorPunt = umbral;
    for (const w of palabras) {
        // digits stay: they are half the confusions `similar` undoes (S↔5, A↔4, O↔0)
        const t = (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        if (!t) continue;
        for (const comp of COMPONENTES) {
            // also against the token's SUFFIX: network engines glue the previous word with no capital left
            // ("VorunaPimethassis" for "Voruna Prime Chassis") and the component ends up last
            const s = Math.max(similar(t, comp), t.length > comp.length ? similar(t.slice(-comp.length), comp) : 0);
            if (s > mejorPunt && existe(`${base[1]} ${comp[0]}${comp.slice(1).toLowerCase()} Blueprint`)) {
                mejorPunt = s; mejor = comp;
            }
        }
    }
    return mejor ? `${base[1]} ${mejor[0]}${mejor.slice(1).toLowerCase()} Blueprint` : nombre;
}

/**
 * Rescues the name when the FIRST word is unreadable but the rest is read.
 *
 * The catalog is closed: the tail that WAS read ("PRIME BLUEPRINT", "PRIME NEUROPTICS BLUEPRINT"...) prunes
 * it to the parts sharing that shape, and against THOSE the mangled first word can be told apart. No tail,
 * no attempt. The margin over the second, not the score, separates a rescue from art noise.
 */
export function recuperaPorSufijo(palabras, catalogo, similar,
    { umbralCola = 0.6, umbralBase = 0.45, margen = 0.12, minLargoBase = 4 } = {}) {
    const tokens = palabras.map((w) => (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "")).filter(Boolean);
    if (!tokens.length) return null;

    // parts grouped by their TAIL (the tokens after the base name); a one-token tail is not enough:
    // "Forma Blueprint" is read, not guessed
    const porCola = new Map();
    for (const n of catalogo) {
        const t = n.toUpperCase().split(/\s+/);
        if (t.length < 3) continue;
        const cola = t.slice(1).join(" ");
        if (!porCola.has(cola)) porCola.set(cola, []);
        porCola.get(cola).push(n);
    }

    // the longest FULLY present tail wins: if the component was read it must be used
    let mejorCola = null, usados = null;
    for (const [cola, piezas] of porCola) {
        const partes = cola.split(" ");
        if (mejorCola && partes.length <= mejorCola.split(" ").length) continue;
        const gastados = new Set();
        const todas = partes.every((p) => {
            let iMejor = -1, sMejor = umbralCola;
            tokens.forEach((t, i) => {
                if (gastados.has(i)) return;
                const s = similar(t, p);
                if (s >= sMejor) { sMejor = s; iMejor = i; }
            });
            if (iMejor < 0) return false;
            gastados.add(iMejor);
            return true;
        });
        if (todas && piezas.length) { mejorCola = cola; usados = gastados; }
    }
    if (!mejorCola) return null;

    const candidatos = porCola.get(mejorCola);
    // best score per distinct BASE NAME ("HYDROID"), not per item: two parts of the same frame score the
    // same and the margin would tell nothing
    const porBase = new Map();
    tokens.forEach((t, i) => {
        if (usados.has(i)) return;
        // SHORT tokens do not compete: `similar` divides by the longer length, so 2 letters score 0.667 against
        // a 3 letter base with one error. A reward label is not read in two letters
        if (t.length < minLargoBase) return;
        for (const n of candidatos) {
            const base = n.toUpperCase().split(/\s+/)[0];
            const s = similar(t, base);
            if (s > (porBase.get(base)?.s ?? 0)) porBase.set(base, { s, n });
        }
    });
    const orden = [...porBase.values()].sort((a, b) => b.s - a.s);
    // uniqueness margin: no anchor backs it here, so the match must be CLEARLY better than the second
    if (!orden.length || orden[0].s < umbralBase) return null;
    if (orden.length > 1 && orden[0].s - orden[1].s < margen) return null;
    return orden[0].n;
}
