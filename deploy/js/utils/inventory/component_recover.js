/**
 * Rescata la pieza REAL cuando al rótulo se le pierde la palabra del componente.
 *
 * Medido sobre el catálogo de 646: al perder una palabra intermedia, 153 de 204 nombres se
 * convierten en OTRA pieza y ninguno sobrevive. Siempre en la misma dirección — "Ash Prime
 * Chassis Blueprint" pasa a "Ash Prime Blueprint", el plano principal, que suele ser la pieza
 * más cara. Es decir: el alta automática apunta lo que NO cayó. (Un glifo mal, en cambio, no
 * cruza ninguna pieza: 0 de 4404.)
 *
 * No se puede simplemente descartar los planos pelados: "Caliban Prime Blueprint" es legítimo.
 * Lo que decide es si en la MISMA columna quedó un token que se parece a un componente.
 */
const COMPONENTES = ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];

/**
 * @param nombre    el ítem que casó, p.ej. "Gyre Prime Blueprint"
 * @param palabras  textos leídos en su columna
 * @param existe    (nombre) => bool, contra el catálogo real
 * @param similar   (a, b) => 0..1, la similitud consciente de confusiones OCR
 */
export function recuperaComponente(nombre, palabras, existe, similar, umbral = 0.6) {
    const base = /^(.+ Prime) Blueprint$/.exec(nombre);
    if (!base) return nombre;
    let mejor = null, mejorPunt = umbral;
    for (const w of palabras) {
        // Los DÍGITOS se conservan: son la mitad de las confusiones que `similar` sabe deshacer
        // (S↔5, A↔4, O↔0), así que borrarlos tira la señal justo en el caso que hay que
        // rescatar — "Cm455is" (Chassis) puntúa 0.77 entero y 0.30 sin los dígitos.
        const t = (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
        if (!t) continue;
        for (const comp of COMPONENTES) {
            // También contra el SUFIJO del token: los motores de red pegan la palabra anterior
            // sin dejar rastro de mayúscula ("VorunaPimethassis" por "Voruna Prime Chassis") y
            // el componente queda al final. Medido: entero puntúa 0,55 y por sufijo 0,86,
            // mientras que el ruido del arte no pasa de 0,45 ni por sufijo.
            const s = Math.max(similar(t, comp), t.length > comp.length ? similar(t.slice(-comp.length), comp) : 0);
            if (s > mejorPunt && existe(`${base[1]} ${comp[0]}${comp.slice(1).toLowerCase()} Blueprint`)) {
                mejorPunt = s; mejor = comp;
            }
        }
    }
    return mejor ? `${base[1]} ${mejor[0]}${mejor.slice(1).toLowerCase()} Blueprint` : nombre;
}

/**
 * Rescata el nombre cuando la PRIMERA palabra es ilegible pero el resto se lee.
 *
 * El ancla normal es la primera palabra ("VORUNA"), así que un rótulo leído como
 * "vowund mt nassis" se pierde entero. Pero el catálogo es cerrado: lo que SÍ se leyó del
 * rótulo —su cola: "PRIME BLUEPRINT", "PRIME NEUROPTICS BLUEPRINT", "PRIME BARREL"…— lo poda
 * de 581 piezas a las que comparten esa forma, y contra ESAS la primera palabra destrozada ya
 * se distingue. Sin cola no se intenta: adivinar sobre 581 inventaría piezas.
 *
 * Antes la poda era solo por la palabra de COMPONENTE, así que un plano pelado ("Caliban Prime
 * Blueprint") no tenía por dónde entrar y se perdía la tarjeta entera. Medido sobre una captura
 * real donde el OCR devolvió "calisax": contra las 152 piezas "<X> Prime Blueprint" saca 0,714
 * y le saca 0,257 al segundo, mientras que la basura del arte ("qt", "aa", "came") se queda en
 * 0,40-0,50 y con margen 0,00-0,08. El margen es lo que separa los dos casos, no la puntuación.
 */
export function recuperaPorSufijo(palabras, catalogo, similar,
    { umbralCola = 0.6, umbralBase = 0.45, margen = 0.12, minLargoBase = 4 } = {}) {
    const tokens = palabras.map((w) => (w || "").toUpperCase().replaceAll(/[^A-Z0-9]/g, "")).filter(Boolean);
    if (!tokens.length) return null;

    // Piezas agrupadas por su COLA (los tokens detrás del nombre base). Una cola de un solo
    // token no vale: "Forma Blueprint" no se adivina, se lee.
    const porCola = new Map();
    for (const n of catalogo) {
        const t = n.toUpperCase().split(/\s+/);
        if (t.length < 3) continue;
        const cola = t.slice(1).join(" ");
        if (!porCola.has(cola)) porCola.set(cola, []);
        porCola.get(cola).push(n);
    }

    // Gana la cola COMPLETAMENTE presente y más larga: "PRIME NEUROPTICS BLUEPRINT" describe la
    // pieza mucho mejor que "PRIME BLUEPRINT", y si el componente se leyó hay que usarlo.
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
    // Mejor puntuación por NOMBRE BASE distinto ("HYDROID"), no por ítem: dos piezas del mismo
    // frame puntúan igual y el margen no distinguiría nada.
    const porBase = new Map();
    tokens.forEach((t, i) => {
        if (usados.has(i)) return;
        // Los tokens CORTOS no compiten: `similar` divide por la longitud del más largo, así que
        // un token de 2 letras saca 0,667 contra una base de 3 con un solo error. Medido en una
        // captura real: la basura del arte "Ag" puntuaba 0,667 contra "Mag" y hundía el margen
        // del rescate legítimo ("calisax" -> Caliban, 0,714) de 0,257 a 0,048. Un rótulo de
        // recompensa no se lee en dos letras.
        if (t.length < minLargoBase) return;
        for (const n of candidatos) {
            const base = n.toUpperCase().split(/\s+/)[0];
            const s = similar(t, base);
            if (s > (porBase.get(base)?.s ?? 0)) porBase.set(base, { s, n });
        }
    });
    const orden = [...porBase.values()].sort((a, b) => b.s - a.s);
    // Margen de unicidad, como en el anclaje: sin él, un token de ruido se parecía un poco a
    // media docena de frames y el rescate se sacaba de la manga "Nekros Prime Chassis
    // Blueprint" donde había un Gyre. Aquí no hay ancla que lo respalde, así que el parecido
    // tiene que ser CLARAMENTE mejor que el del segundo.
    if (!orden.length || orden[0].s < umbralBase) return null;
    if (orden.length > 1 && orden[0].s - orden[1].s < margen) return null;
    return orden[0].n;
}
