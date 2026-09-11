// recovers the full component name when OCR drops the component word from a reward label
const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

export function recuperaComponente(nombre, palabras, existe, similar, umbral = 0.6) {
    const base = /^(.+ Prime) Blueprint$/.exec(nombre);
    if (!base) return nombre;
    let mejor = null, mejorPunt = umbral;
    for (const w of palabras) {
        // digits stay: they are half the confusions similar undoes (S↔5, A↔4, O↔0)
        const t = (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        if (!t) continue;
        for (const comp of COMPONENTES) {
            const s = Math.max(similar(t, comp), t.length > comp.length ? similar(t.slice(-comp.length), comp) : 0);
            if (s > mejorPunt && existe(`${base[1]} ${comp[0]}${comp.slice(1).toLowerCase()} Blueprint`)) {
                mejorPunt = s; mejor = comp;
            }
        }
    }
    return mejor ? `${base[1]} ${mejor[0]}${mejor.slice(1).toLowerCase()} Blueprint` : nombre;
}

export function recuperaPorSufijo(palabras, catalogo, similar,
    { umbralCola = 0.6, umbralBase = 0.45, margen = 0.12, minLargoBase = 4 } = {}) {
    const tokens = palabras.map((w) => (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "")).filter(Boolean);
    if (!tokens.length) return null;

    const porCola = new Map();
    for (const n of catalogo) {
        const t = n.toUpperCase().split(/\s+/);
        if (t.length < 3) continue;
        const cola = t.slice(1).join(" ");
        if (!porCola.has(cola)) porCola.set(cola, []);
        porCola.get(cola).push(n);
    }

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
    const porBase = new Map();
    tokens.forEach((t, i) => {
        if (usados.has(i)) return;
        if (t.length < minLargoBase) return;
        for (const n of candidatos) {
            const base = n.toUpperCase().split(/\s+/)[0];
            const s = similar(t, base);
            if (s > (porBase.get(base)?.s ?? 0)) porBase.set(base, { s, n });
        }
    });
    const orden = [...porBase.values()].sort((a, b) => b.s - a.s);
    if (!orden.length || orden[0].s < umbralBase) return null;
    if (orden.length > 1 && orden[0].s - orden[1].s < margen) return null;
    return orden[0].n;
}
