import { state } from "../state.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { readBadgeDigits } from "../utils/badge_digit_ocr.js";

export const OCRService = {
    cachedDbItems: [],
    knownParts: new Set(),
    dynamicRegex: null,

    initMatcherData() {
        if (!state.itemsDatabase || Object.keys(state.itemsDatabase).length === 0) return;
        if (this.cachedDbItems.length > 0) return;

        const tempParts = new Set(["BLUEPRINT", "PRIME", "CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS", "DUAL", "TWIN", "DEX", "MK1", "PRISMA", "VANDAL", "WRAITH", "FORMA", "CARAPACE", "CEREBRUM", "HANDLE", "BARREL", "RECEIVER", "STOCK", "LINK", "POUCH", "STARS", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB"]);

        Object.keys(state.itemsDatabase).forEach((itemName) => {
            const upperName = itemName.toUpperCase();
            const normalizedName = upperName.replaceAll(/[^A-Z0-9 ]/g, " ");
            const words = normalizedName.split(/\s+/).filter((w) => w !== "PRIME" && w.length > 0);

            upperName.split(" ").forEach(w => { if (w.length > 2 || w === "BO") tempParts.add(w); });

            this.cachedDbItems.push({
                originalName: itemName,
                searchWords: words,
                firstWord: words[0],
                isPrime: upperName.includes("PRIME"),
                ducats: state.itemsDatabase[itemName][0]?.ducats || 0
            });
        });

        this.knownParts = tempParts;
    },

    editDistance(s1, s2) {
        s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    },

    getSimilarity(s1, s2) {
        let longer = s1, shorter = s2;
        if (s1.length < s2.length) { longer = s2; shorter = s1; }
        if (longer.length === 0) return 1;
        return (longer.length - this.editDistance(longer, shorter)) / longer.length;
    },

    // Grupos de caracteres que el OCR confunde entre sí (misma silueta en la fuente).
    // Genérico: en vez de listas de alias por arma, la sustitución ENTRE miembros del
    // mismo grupo cuesta poco en similarityOCR, así "ACCELLRA"≈"ACCELTRA", "FRIME"≈"PRIME",
    // "RECELVER"≈"RECEIVER", etc. se resuelven solos, sin hardcodear cada caso.
    _ocrConfMap: (() => {
        // "O6": en la fuente del juego el bucle del 6 ocupa casi todo el glifo y el gancho
        // superior se pierde al binarizar. Visto en vivo: "Axi C6 Relic" salió como
        // "AXI CO RELIC" y la celda quedó UNMATCHED — los grupos NO son transitivos, así que
        // tener "O0QDCG" y "G6" por separado no hacía que O y 6 se parecieran entre sí.
        // Solo se empareja con la LETRA O, no con el dígito 0: mezclar 6 y 0 haría que un
        // "A16" legítimo pasara por "A10" cuando el catálogo no tiene el A16 (inventar una
        // reliquia distinta es peor que no matchear); la letra en un hueco de dígito, en
        // cambio, ya es de por sí un fallo de OCR.
        const groups = ["O0QDCG", "IL1T|J", "S5", "B8", "G6", "O6", "Z2", "UV", "NMH", "PF", "EF", "RT", "VY", "A4", "KR", "W", "Q9"];
        const map = new Map();
        for (const g of groups) for (const ch of g) map.set(ch, (map.get(ch) || "") + g);
        return map;
    })(),

    /**
     * Similitud [0..1] CONSCIENTE de confusiones OCR: Levenshtein ponderado donde
     * sustituir un carácter por otro de su mismo grupo de confusión cuesta 0.4 en
     * vez de 1. Reemplaza a las listas de alias/normalizadores por-caso: los errores
     * TÍPICOS de OCR (letra por letra parecida) dejan de penalizar, así que el match
     * correcto gana por similitud sin reglas hardcodeadas. Las lecturas SALVAJES
     * (basura sin parecido) siguen cayendo por debajo del umbral → territorio Paddle.
     */
    similarityOCR(a, b) {
        a = a.toUpperCase(); b = b.toUpperCase();
        const m = a.length, n = b.length;
        if (!m || !n) return m === n ? 1 : 0;
        let prev = new Float32Array(n + 1), cur = new Float32Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            const ca = a[i - 1];
            const conf = this._ocrConfMap.get(ca);
            for (let j = 1; j <= n; j++) {
                const cb = b[j - 1];
                const sub = ca === cb ? 0 : (conf && conf.includes(cb) ? 0.4 : 1);
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
            }
            [prev, cur] = [cur, prev];
        }
        const longer = Math.max(m, n);
        return (longer - prev[n]) / longer;
    },

    RELIC_TIERS: ["LITH", "MESO", "NEO", "AXI", "REQUIEM"],
    // Ruido típico de la UI de selección de reliquia/inventario que no forma parte del código.
    RELIC_NOISE_TOKENS: new Set([
        "RELIC", "RADIANT", "INTACT", "EXCEPTIONAL", "FLAWLESS",
        "RELIQUIA", "RADIANTE", "INTACTA", "EXCEPCIONAL", "IMPECABLE"
    ]),

    // Forma romana de un código Requiem leído en arábigo ("2" -> "II"). Regla de
    // DOMINIO (los códigos Requiem son números romanos), no un alias por-caso.
    _romanizeRequiem(code) {
        return code
            .replaceAll("1", "I").replaceAll("0", "O").replaceAll("2", "II")
            .replaceAll("3", "III").replaceAll("4", "IV");
    },

    // Pantalla de selección/refinamiento: mismo matcher genérico que el inventario,
    // devolviendo "TIER CODIGO" en mayúsculas (formato histórico del flujo de track).
    parseRelicSelection(ocrText) {
        const canonical = this.getRelicMatch(ocrText);
        return canonical ? canonical.toUpperCase().replace(/\s+RELIC$/, "") : null;
    },

    // ---- Matching GENÉRICO de reliquias (mismo diseño que getValidItemMatch) ----
    // Nada de mapas/alias por-caso: TODA la tolerancia a errores OCR pasa por
    // similarityOCR (grupos de confusión compartidos) contra el catálogo REAL
    // (state.allRelicNames), con umbral + margen de unicidad. Las únicas reglas
    // extra son de DOMINIO: los tiers son alfabéticos, los códigos son
    // letra+dígitos (Requiem: romanos) y la cola de una palabra puede traer
    // ruido del arte de la celda.

    _relicIndexCache: null,
    // tier -> [{ code, canonical }], derivado de state.allRelicNames (data-driven).
    _relicIndex() {
        const names = state.allRelicNames || [];
        if (this._relicIndexCache && this._relicIndexCache._n === names.length) return this._relicIndexCache;
        const idx = new Map();
        for (const canonical of names) {
            const parts = canonical.toUpperCase().replace(/\s+RELIC$/, "").split(/\s+/);
            if (parts.length !== 2) continue;
            const [tier, code] = parts;
            if (!idx.has(tier)) idx.set(tier, []);
            idx.get(tier).push({ code, canonical });
        }
        idx._n = names.length;
        this._relicIndexCache = idx;
        return idx;
    },

    // Similitud de un candidato de TIER: similarityOCR más dos variantes de dominio
    // (con pequeña penalización para que el match limpio siempre gane):
    //  (a) los tiers no llevan dígitos -> una cola de dígitos en el candidato es
    //      ruido/código pegado y se puede descartar;
    //  (b) glifo fino perdido al final ("AX" por AXI) -> comparar contra el prefijo
    //      del tier de la misma longitud.
    _relicTierScore(word, tier) {
        let s = this.similarityOCR(word, tier);
        const stripped = word.replace(/[0-9]+$/, "");
        if (stripped !== word && stripped.length >= 2) {
            s = Math.max(s, this.similarityOCR(stripped, tier.slice(0, Math.max(stripped.length, 2))) - 0.08);
        }
        // El prefijo solo rescata UN glifo fino perdido al final ("AX" por AXI, "NE" por
        // NEO). Sin ese límite, un fragmento de 2 letras valía como tier entero: "RE"
        // puntuaba 0.92 contra REQUIEM (5 glifos ausentes) y cualquier celda con basura
        // que contuviera "RE" —"...FO RE SM..."— se anotaba como Requiem I. Un falso
        // positivo es peor que un fallo: mete una reliquia inexistente en el inventario.
        if (word.length >= 2 && word.length < tier.length && tier.length - word.length <= 1) {
            s = Math.max(s, this.similarityOCR(word, tier.slice(0, word.length)) - 0.08);
        }
        return s;
    },

    // Devuelve el nombre CANÓNICO tal como figura en state.allRelicNames (con o sin
    // sufijo " Relic", según lo tenga la DB), o null. Acepta array de palabras OCR
    // (celda del inventario) o texto libre (pantalla de selección).
    getRelicMatch(combinedText) {
        if (!combinedText || !state.allRelicNames?.length) return null;
        const rawWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);
        const words = rawWords
            .map(w => (w || "").toString().toUpperCase().replaceAll(/[^A-Z0-9]/g, ""))
            .filter(w => w.length > 0 && !this.RELIC_NOISE_TOKENS.has(w));
        const index = this._relicIndex();

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // 1) TIER por similitud (cubre L1TH/MES0/AXT/NEC/AX/AX0 sin mapas por-caso).
            let tier = null, tierS = 0;
            for (const t of this.RELIC_TIERS) {
                const s = this._relicTierScore(word, t);
                if (s > tierS) { tierS = s; tier = t; }
            }
            // Un tier rescatado de un fragmento de DOS letras ("AX"→AXI, "NE"→NEO) es
            // evidencia floja: "NE" aparece en cualquier basura. Visto en vivo: una celda
            // ilegible dio "…OT NE WL" y se apuntó como "Neo W1" (WL≈W1 = 0.80). Cuando el
            // tier viene de ahí, el CÓDIGO tiene que ser casi exacto para compensar.
            const weakTier = tier !== null && word.length === 2 && word.length < tier.length;
            let glueRemainder = "";
            if (tierS < 0.78) {
                // tier+código PEGADOS en un token ("LITHC1"): prefijo exacto del tier.
                tier = this.RELIC_TIERS.find(t => word.length > t.length && word.startsWith(t)) || null;
                if (!tier) continue;
                glueRemainder = word.slice(tier.length);
            }
            const codes = index.get(tier);
            if (!codes?.length) continue;

            // 2) Candidatos de CÓDIGO: remainder pegado, las 2 palabras siguientes y la
            // unión de adyacentes cortas (código partido por el OCR: "AL" + "4").
            // Map candidato -> PENALIZACIÓN: las variantes reconstruidas por reglas de dominio
            // valen menos que lo que el OCR leyó de verdad, para que una lectura literal
            // siempre gane a una reconstruida (si no, "AL4" empataba a 1.0 entre A14 y A4).
            const cands = new Map();
            const addCand = (c, pen = 0) => {
                if (!c || c.length > 4) return;
                const prev = cands.get(c);
                if (prev === undefined || pen < prev) cands.set(c, pen);
            };
            if (glueRemainder.length >= 1) addCand(glueRemainder);
            for (let j = i + 1; j < Math.min(i + 3, words.length); j++) {
                const w = words[j];
                if (w.length >= 1) addCand(w);
                if (words[j + 1]) addCand(w + words[j + 1]);
            }
            const isRequiem = tier === "REQUIEM";
            if (isRequiem) {
                for (const c of [...cands.keys()]) addCand(this._romanizeRequiem(c));
            } else {
                // La INICIAL de un código de reliquia es SIEMPRE una letra (A1, O5, K11…),
                // así que un dígito ahí es un fallo de OCR seguro. Sin corregirlo, "O5"
                // leído "05" empataba a 0.800 contra C5/D5/G5/O5 —la O y el 0 están en el
                // mismo grupo de confusión, y con ellos C/D/G/Q— el margen de unicidad
                // caía a 0 y la celda salía UNMATCHED (visto en vivo con Axi O5 y Axi O6).
                // Reponer las letras candidatas deshace el empate: "O5" casa exacto (1.0)
                // y las demás se quedan en 0.8.
                const DIGIT_AS_LETTER = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "8": "B" };
                // De la SEGUNDA posición en adelante el código es NUMÉRICO, así que una LETRA
                // ahí sobra: es ruido del arte pegado al código. Visto en vivo: "Axi O5" salió
                // como "AXI OO5" y se quedaba en 0.67 contra O5 (bajo el corte de 0.70) →
                // UNMATCHED. Se prueba borrando ese glifo, con la misma penalización que
                // recortar la cola: la letra puede ser también un dígito mal leído, y en ese
                // caso el mapa de confusiones (L≈1, O≈0…) ya lo puntúa mejor sin borrar nada
                // — "AL"+"4" tiene que seguir cayendo en A14, no en A4 ni en A1.
                // No hay LETTER_AS_DIGIT: convertir la letra en dígito daría un match EXACTO
                // (1.0) a una lectura reconstruida y aplastaría el margen de unicidad, que es
                // justo la señal que distingue el código bueno del vecino.
                for (const [c, pen] of [...cands]) {
                    const letter = DIGIT_AS_LETTER[c[0]];
                    if (letter) addCand(letter + c.slice(1), pen);
                    // Solo si queda un código de 2+ glifos: recortar "CO" a "C" no identifica
                    // nada y empataría contra toda la letra C del catálogo.
                    if (c.length <= 2) continue;
                    for (let k = 1; k < c.length; k++) {
                        if (/[A-Z]/.test(c[k])) addCand(c.slice(0, k) + c.slice(k + 1), pen + 0.17);
                    }
                }
            }
            if (cands.size === 0) continue;

            // 3) Mejor código por similitud con MARGEN de unicidad. La cola del candidato
            // puede ser ruido del arte ("A160" -> A16): se prueba recortarla con
            // penalización — salvo en Requiem, donde el código es romano y cada glifo
            // final es señal ("IL" = II, no I).
            let best = null, bestS = 0, second = 0;
            for (const { code, canonical } of codes) {
                let s = 0;
                for (const [cand, pen] of cands) {
                    let cs = this.similarityOCR(cand, code);
                    if (!isRequiem) {
                        // Penalización 0.17/char: mayor que el coste de una confusión de
                        // grupo al final (0.4/3 ≈ 0.13), para que "K1J" prefiera K11
                        // (J≈1) antes que recortar a K1; y menor que un error real, para
                        // que "A160" siga cayendo a A16.
                        for (let k = 1; k <= 2 && cand.length - k >= 2; k++) {
                            cs = Math.max(cs, this.similarityOCR(cand.slice(0, cand.length - k), code) - 0.17 * k);
                        }
                    }
                    cs -= pen;
                    if (cs > s) s = cs;
                }
                if (s > bestS) { second = bestS; bestS = s; best = canonical; }
                else if (s > second) second = s;
            }
            // Umbral bajo + MARGEN de unicidad: la señal fuerte es que el ganador destaque
            // sobre el 2º (varias confusiones seguidas hunden la similitud absoluta —
            // "ILL"≈III 0.73— pero el margen sigue siendo enorme). Un margen holgado
            // permite bajar el corte sin admitir basura, que puntúa plano contra todo.
            if (weakTier && bestS < 0.85) continue;
            if (bestS >= 0.70 && (bestS - second) >= 0.10) return best;
            if (bestS >= 0.80 && (bestS - second) >= 0.03) return best;
        }
        return null;
    },

    _normalizeOCRWords(ocrData) {
        const metaTokens = ["OWNED", "CRAFTED", "FORJA", "PROPIO", "PRDPIO", "0WNED", "OWN", "OWED"];
        const validWords = [];
        const knownTokens = Array.from(this.knownParts);

        ocrData.words.forEach(w => {
            let text = w.text.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            if (text.length < 1) return;

            if (metaTokens.includes(text) || /^\d+$/.test(text)) {
                validWords.push({
                    text: text,
                    x: (w.bbox.x0 + w.bbox.x1) / 2,
                    y: (w.bbox.y0 + w.bbox.y1) / 2,
                    raw: w.text
                });
                return;
            }

            // Normalización por similitud CONSCIENTE DE CONFUSIONES OCR (similarityOCR),
            // igual que getValidItemMatch — el parser de rewards se había quedado con la
            // Levenshtein plana a 0.75 y descartaba nombres con confusiones típicas
            // (p.ej. "CALIBAN" leído con li→ñ/h bajo el tinte rojo de fin de misión):
            // la palabra se tiraba y el ancla de la carta nunca llegaba a existir.
            // Se elige el MEJOR token (no el primero que pasa) para no colar un token
            // mediocre cuando existe otro más parecido.
            let matchedToken = knownTokens.includes(text) ? text : null;
            if (!matchedToken) {
                // Umbral alto sobre similarityOCR: un token del juego MAL LEÍDO difiere de
                // su forma real en sustituciones de glifo PARECIDO, que cuestan 0.4 cada
                // una — medido sobre casos reales queda en ~0.92-0.95 ("FRO5T", "STVANAX",
                // "RECELVER", "CAL1BAN"). Una palabra AJENA del fondo ("POST", "FRONT",
                // "ROST"…) difiere en letras SIN parecido o en longitud y no pasa de ~0.80.
                // Con el umbral viejo (0.72) "POST" se convertía en "FROST" y fabricaba un
                // ancla fantasma que robaba "Prime Chassis Blueprint" a la recompensa vecina.
                const minScore = 0.85;
                let best = null, bestScore = 0;
                for (const token of knownTokens) {
                    const s = this.similarityOCR(text, token);
                    if (s > bestScore) { bestScore = s; best = token; }
                }
                matchedToken = bestScore >= minScore ? best : null;
            }

            if (matchedToken) {
                validWords.push({
                    text: matchedToken,
                    x: (w.bbox.x0 + w.bbox.x1) / 2,
                    y: (w.bbox.y0 + w.bbox.y1) / 2,
                    raw: w.text
                });
            }
        });
        return validWords;
    },
    parseRewards(ocrData) {
        if (!ocrData?.words) return [];
        this.initMatcherData();
        const imgW = ocrData.imageW || 1920;
        const isStrip = ocrData.isStrip === true;
        const validWords = this._normalizeOCRWords(ocrData);

        const itemMatches = [];

        const MARGIN_LEFT = isStrip ? (imgW * 0.3) : (imgW * 0.05);
        // Ampliado de 0.18 a 0.26 para nombres largos en 1 sola línea (ej. "Gunsen Prime Blueprint"),
        // donde el ancla ("Gunsen") está muy a la izquierda y el último token cae a casi 25% de distancia.
        const MARGIN_RIGHT = isStrip ? imgW : (imgW * 0.26);

        const allFirstTokens = new Set(this.cachedDbItems.map(item => item.searchWords[0]));
        const globalAnchors = validWords.filter(w => allFirstTokens.has(w.text)).sort((a, b) => a.x - b.x);

        for (const dbItem of this.cachedDbItems) {
            const searchTokens = dbItem.searchWords;
            const anchors = validWords.filter(w => w.text === searchTokens[0]);

            for (const anchor of anchors) {
                const nextAnchor = isStrip ? null : globalAnchors.find(a => a.x > anchor.x + (imgW * 0.05));
                // OJO: cortar la ventana ANTES de nextAnchor (zona de exclusión) o extenderla a
                // imgW cuando no hay nextAnchor rompe frames reales: un token basura del tinte
                // que normaliza a un requiem de 1 token ("ris") se vuelve ancla espuria, la
                // exclusión amputa los tokens legítimos del nombre anterior ("Prime String") y
                // el requiem gana la consolidación. El clamp a nextAnchor.x - 1 ya aísla columnas;
                // el caso Quassus (nombre largo en la última columna) lo cubre MARGIN_RIGHT 0.26.
                const maxRightX = nextAnchor ? Math.min(anchor.x + MARGIN_RIGHT, nextAnchor.x - 1) : anchor.x + MARGIN_RIGHT;

                // MARGIN_LEFT existe para las líneas 2-3 de un nombre multilínea (centradas bajo
                // la línea 1, pueden asomar a la izquierda del ancla). Pero una palabra a la
                // izquierda del ancla EN SU MISMA LÍNEA nunca es del propio nombre (el ancla es
                // la 1ª palabra de la línea 1): es la cola del vecino ("...Chassis | Khora...")
                // y roba el match o dispara la penalización de partes. Se excluye por Y.
                const sameLineTol = imgW * 0.008;
                const localWords = validWords.filter(w =>
                    w.x >= (anchor.x - MARGIN_LEFT) && w.x <= maxRightX &&
                    (isStrip || !(w.x < anchor.x && Math.abs(w.y - anchor.y) < sameLineTol))
                );
                const metadata = this.extractInventoryMetadata(localWords);

                const localSoupText = localWords.map(w => w.text).join(" ");
                // La PENALIZACIÓN por partes (main-blueprint vs "X Prime <Parte>") solo debe ver
                // palabras del PROPIO nombre: los tokens de una carta quedan a ≤~0.09W de su ancla,
                // pero la 2ª línea de un nombre multilínea VECINO ("Neuroptics" de "Grendel Prime /
                // Neuroptics Blueprint") queda a la izquierda del ancla vecina (el clamp no la corta,
                // ~0.17W) y colaba un wfPart en la sopa -> "Gunsen Prime Blueprint" moría con -0.6.
                const penaltyWords = isStrip ? localWords : localWords.filter(w => Math.abs(w.x - anchor.x) <= imgW * 0.13);
                const ratio = this._calculateMatchRatio(dbItem, localSoupText, localWords, penaltyWords);

                const minWords = searchTokens.length === 1 ? 1 : (isStrip ? 1 : 2);
                const minRatio = isStrip ? 0.55 : 0.65;

                if (ratio > minRatio && this._countValidTokens(searchTokens, localWords) >= minWords) {
                    // Centro de gravedad X del NOMBRE, anclado al anchor. Promediar TODAS las
                    // palabras de searchTokens en localWords cruzaba las X de recompensas
                    // adyacentes: los tokens genéricos ("PRIME", "BLADE", "BLUEPRINT") aparecen
                    // en ambas columnas, y el "PRIME" del vecino se colaba en la ventana ancha
                    // (MARGIN_RIGHT 18%) arrastrando el avgX -> Tipedo y Fang salían con las X
                    // intercambiadas. Fix: para cada token del nombre nos quedamos con la
                    // aparición MÁS CERCANA al anchor (el 1er token es único por recompensa),
                    // descartando el duplicado de la columna vecina.
                    const matchedWords = searchTokens
                        .map(tok => localWords
                            .filter(w => w.text === tok)
                            .sort((a, b) => Math.abs(a.x - anchor.x) - Math.abs(b.x - anchor.x))[0])
                        .filter(Boolean);
                    const avgX = matchedWords.length > 0
                        ? matchedWords.reduce((s, w) => s + w.x, 0) / matchedWords.length
                        : anchor.x;

                    itemMatches.push({
                        name: dbItem.originalName,
                        ratio: ratio,
                        tokens: searchTokens.length,
                        x: avgX,
                        owned: metadata.owned,
                        crafted: metadata.crafted
                    });
                }
            }
        }
        return this._consolidateMatches(itemMatches, imgW);
    },

    // localWords: ventana completa de la columna (puntúa los tokens del nombre, que pueden
    // repartirse en 2-3 líneas). penaltyWords: SOLO palabras pegadas al ancla (≤0.13W) — la
    // penalización decide "main blueprint vs parte" y un wfPart/wpnPart de la 2ª línea de un
    // nombre VECINO no debe dispararla (queda dentro de la ventana pero lejos del ancla).
    _calculateMatchRatio(dbItem, localSoupText, localWords, penaltyWords = localWords) {
        const wfParts = ["CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];
        const wpnParts = ["BARREL", "RECEIVER", "STOCK", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB", "LINK", "POUCH", "GUARD", "DISC", "STARS", "BAND", "BOOT"];
        const searchTokens = dbItem.searchWords;

        let matchScore = 1.0;
        for (let i = 1; i < searchTokens.length; i++) {
            const token = searchTokens[i];
            if (localWords.some(w => w.text === token)) matchScore += 1;
            else if (localWords.some(w => this.getSimilarity(w.text, token) > 0.7)) matchScore += 0.7;
            else if (token === "BLUEPRINT" && wfParts.some(p => dbItem.originalName.toUpperCase().includes(p))) matchScore += 0.8;
        }

        let ratio = matchScore / searchTokens.length;
        const name = dbItem.originalName.toUpperCase();
        const isMainBlueprint = name.endsWith("BLUEPRINT") && !wfParts.some(p => name.includes(p));
        // Partes por TOKEN EXACTO, no substring de la sopa: "LIMBO" contiene "LIMB" y la
        // penalización por substring mataba "Limbo Prime Blueprint" (-0.8) siempre.
        const soupHasToken = (tok) => penaltyWords.some(w => w.text === tok);
        const soupHasWfPart = wfParts.some(p => soupHasToken(p) || penaltyWords.some(w => this.getSimilarity(w.text, p) > 0.7));

        if (wpnParts.some(soupHasToken)) {
            if (isMainBlueprint) ratio -= 0.8;
        } else if (soupHasWfPart) {
            if (isMainBlueprint) ratio -= 0.6;
        } else if (soupHasToken("BLUEPRINT")) {
            // También por token en el NOMBRE: "LIMBO" contiene "LIMB" como substring.
            const nameTokens = name.split(/[^A-Z0-9]+/);
            if (wpnParts.some(p => nameTokens.includes(p))) ratio -= 0.6;
        }
        return ratio;
    },

    _countValidTokens(searchTokens, localWords) {
        let count = 0;
        const localTexts = localWords.map(lw => lw.text);

        searchTokens.forEach(token => {
            // Match exacto o match por similitud (Fuzzy)
            const hasMatch = localTexts.some(lt => lt === token || this.getSimilarity(lt, token) > 0.8);
            if (hasMatch) count++;
        });
        return count;
    },

    _consolidateMatches(itemMatches, imgW) {
        // Sort by ratio desc, then by specificity (more tokens = more specific) desc
        itemMatches.sort((a, b) => b.ratio - a.ratio || (b.tokens || 0) - (a.tokens || 0));
        const finalItems = [];
        for (const match of itemMatches) {
            if (!finalItems.some(f => Math.abs(match.x - f.x) < imgW * 0.1)) {
                finalItems.push(match);
            }
        }
        return finalItems.toSorted((a, b) => a.x - b.x).map(item => ({
            name: item.name,
            xPos: item.x,
            imgW: imgW,
            owned: item.owned,
            crafted: item.crafted,
            ratio: item.ratio,
            confidence: 0.95
        }));
    },

    extractInventoryMetadata(wordsArray) {
        if (!wordsArray || wordsArray.length === 0) return { owned: 0, crafted: 0 };
        const text = wordsArray.map(w => w.text).join(" ").toUpperCase();

        if (text.includes("CRAFTED") || text.includes("FORJA") || /CRAFT/i.test(text)) {
            return { owned: 0, crafted: 1 };
        }

        const strongMatch = text.match(/(\d+)\s*(?:OWNED|0WNED|QWNED|UWNED|OWNE|OWED|OWN|0WN|PROPIO|PROP)/);
        if (strongMatch && strongMatch[1]) {
            return { owned: parseInt(strongMatch[1], 10), crafted: 0 };
        }

        if (/OWNED|0WNED|OWNE|OWED|OWN|PROPIO|PROP/i.test(text)) {
            return { owned: 1, crafted: 0 };
        }

        return { owned: 0, crafted: 0 };
    },

    async extractCellText(worker, textCanvas) {
        const { data: { words } } = await OCRRepository.recognize(worker, textCanvas);
        if (!words || words.length < 1) return null;
        return words.map((w) => w.text.toUpperCase());
    },

    // Repara errores típicos letra→dígito de la fuente del badge y devuelve las palabras
    // que contienen algún dígito, ordenadas de izquierda a derecha.
    _repairBadgeWords(words) {
        words.forEach(w => {
            w.text = w.text.toUpperCase()
                .replaceAll(/[Il|]/g, "1") // Map I, l, | to 1 (but not T or t)
                .replaceAll(/[t]/g, "1")   // Map lowercase t to 1
                .replaceAll(/[T]/g, "7")   // Map uppercase T to 7
                .replaceAll(/[Yy]/g, "7")  // Map Y, y to 7
                .replaceAll(/[A]/g, "4")   // Map A to 4
                .replaceAll(/[S]/g, "5")   // Map S to 5
                .replaceAll(/[B]/g, "8")   // Map B to 8
                .replaceAll(/[G]/g, "6")   // Map G to 6
                .replaceAll(/[Z]/g, "2")   // Map Z to 2
                .replaceAll(/[O]/g, "0")   // Map O to 0
                .replaceAll(/[q]/g, "9");  // Map q to 9
        });
        const badgeNums = words.filter((w) => /\d/.test(w.text));
        badgeNums.sort((a, b) => a.bbox.x0 - b.bbox.x0);
        return { badgeNums, rawTexts: words.map(w => w.text).join(" ") };
    },

    _badgeToQty({ badgeNums, rawTexts }) {
        if (badgeNums.length === 0) return { qty: 1, raw: rawTexts };
        const pureDigit = badgeNums.map(w => w.text.replace(/\D/g, "")).join("");
        if (pureDigit) {
            const val = Number.parseInt(pureDigit);
            return { qty: (val > 1 && val < 1000) ? val : 1, raw: rawTexts };
        }
        return { qty: 1, raw: rawTexts };
    },

    // Lectura de cantidad de UN frame por template-matching de dígitos (ver
    // utils/badge_digit_ocr.js). Reemplaza el path de Tesseract: fallaba justo
    // en dígitos AISLADOS sin línea base (4/8/9 sueltos, glifo ~15px, el PSM
    // no ayudaba — verificado con harness offline, 30/35 vs 33/35 del matching).
    // `worker` queda sin usar aquí (el worker de badges ya no hace OCR de
    // cantidad); se mantiene en la firma porque scanner.service.js lo pasa.
    // La fiabilidad real viene además del CONSENSO temporal por ítem en scanner.service.js.
    async extractCellQuantity(worker, badgeCanvas) {
        if (!badgeCanvas) return { qty: 1, raw: "" };
        const ctx = badgeCanvas.getContext("2d");
        const imgData = ctx.getImageData(0, 0, badgeCanvas.width, badgeCanvas.height);
        const raw = readBadgeDigits(imgData);
        if (!raw) return { qty: 1, raw: "" };
        const val = Number.parseInt(raw);
        return { qty: (val > 1 && val < 1000) ? val : 1, raw };
    },

    getValidItemMatch(combinedText) {
        if (!this.cachedDbItems.length) this.initMatcherData();

        // Tesseract a veces FUSIONA dos palabras con un punto/guión en medio
        // ("CARRIER.PRIME BLUEPRINT"): isFirstWordMatch limpia a "CARRIERPRIME" y la
        // similitud contra "CARRIER" (0.58) no llega al umbral. Partimos cada palabra
        // OCR por separadores no alfanuméricos antes de matchear; el caso inverso
        // (una palabra DB partida en dos por el OCR) ya lo cubre el join i+(i+1).
        const rawWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);
        const textWords = rawWords.flatMap(w => w.split(/[^A-Za-z0-9]+/).filter(Boolean));

        if (textWords.length === 0) return null;

        const isOptionalWord = (targetComp, prevWordDB) => {
            if (targetComp === "PRIME" || targetComp === "P" || targetComp === "PR") return true;
            if (targetComp !== "BLUEPRINT") return false;
            return ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM", "FORMA"].includes(prevWordDB);
        };

        const isFirstWordMatch = (ocrStr, dbFirstWord) => {
            const cleanOCR = ocrStr.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            const cleanDB = dbFirstWord.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            if (cleanOCR === cleanDB) return true;
            if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;
            // GENÉRICO: umbral por similitud CONSCIENTE DE CONFUSIONES OCR — sin listas de
            // alias por arma. Los errores típicos (letra por otra de silueta parecida) casi
            // no penalizan, así que el match correcto gana por similitud. Las lecturas SALVAJES
            // (basura irreconocible) quedan por debajo del umbral → las rescata PaddleOCR.
            const thr = cleanDB.length <= 4 ? 0.72 : 0.62;
            return this.similarityOCR(cleanOCR, cleanDB) >= thr;
        };

        // Listón para un match que NO se apoya en ningún componente: la primera palabra es
        // TODA la prueba, así que los umbrales base (pensados para que el resto del nombre
        // valide el conjunto) se quedan cortos y cualquier basura de 3-4 letras entra. Pasa
        // con los ítems de una palabra —los mods Requiem: Jahu, Khra, Ris, Vome…— y con los
        // que tienen el resto OPCIONAL, como "Forma Blueprint" (isOptionalWord deja caer
        // BLUEPRINT detrás de FORMA), que se sostiene solo con "FORMA".
        // Los dos casos se vieron en vivo en el mismo grid de reliquias: celdas con el texto
        // ilegible (el arte de la reliquia cae sobre el nombre) se apuntaron como "Jahu" y
        // como "Forma Blueprint". Con 0.85 solo pasan confusiones de glifo ("F0RMA"=0.92,
        // "JAHV"=0.90), no una letra que falte o sobre (0.80 y 0.75).
        const UNCORROBORATED_THR = 0.85;

        // Los COMPONENTES (Barrel/Receiver/Blueprint/Link/...) se casan por similitud
        // CONSCIENTE DE OCR, sin normalizadores regex por-componente. Umbral de componente
        // más bajo que el de arma porque son palabras conocidas y cortas; el conjunto se
        // valida por el resto del nombre. Lecturas de componente salvajes → item sin match → Paddle.
        const COMP_THR = 0.6;

        const attemptItemMatch = (startIndex, item, lookAheadLimit, ocrWords) => {
            const matchedIndices = [startIndex];
            let currentPos = startIndex;
            for (let j = 1; j < item.searchWords.length; j++) {
                const targetComp = item.searchWords[j];
                let found = false;
                for (let dist = 1; dist <= lookAheadLimit; dist++) {
                    const nextIdx = currentPos + dist;
                    if (nextIdx >= ocrWords.length) continue;

                    const cleanWord = ocrWords[nextIdx].replaceAll(/[^A-Z]/g, "");

                    let combinedWord = cleanWord;
                    if (nextIdx + 1 < ocrWords.length) {
                        combinedWord += ocrWords[nextIdx + 1].replaceAll(/[^A-Z]/g, "");
                    }

                    if (this.similarityOCR(cleanWord, targetComp) >= COMP_THR) {
                        matchedIndices.push(nextIdx);
                        currentPos = nextIdx;
                        found = true;
                        break;
                    } else if (this.similarityOCR(combinedWord, targetComp) >= COMP_THR) {
                        matchedIndices.push(nextIdx);
                        matchedIndices.push(nextIdx + 1);
                        currentPos = nextIdx + 1;
                        found = true;
                        break;
                    }
                }
                if (!found && !isOptionalWord(targetComp, item.searchWords[j - 1])) return null;
            }
            return matchedIndices;
        };

        let bestItem = null;
        let longestMatch = 0;
        let bestWords = 0;
        let bestScore = -1;

        for (const item of this.cachedDbItems) {
            for (let i = 0; i < textWords.length; i++) {
                let matchedIndexOffset = 0;
                let isMatch = false;

                if (isFirstWordMatch(textWords[i], item.firstWord)) {
                    isMatch = true;
                    matchedIndexOffset = 0;
                } else if (i + 1 < textWords.length && isFirstWordMatch(textWords[i] + textWords[i + 1], item.firstWord)) {
                    isMatch = true;
                    matchedIndexOffset = 1;
                }

                if (isMatch) {
                    const matched = attemptItemMatch(i + matchedIndexOffset, item, 4, textWords);
                    if (!matched) continue;
                    // Selección por CALIDAD, no por orden de la BD: entre items que casan
                    // el MISMO nº de palabras (p.ej. "BOLTOR PRIME BARREL" casa tanto Boltor
                    // como Akbolto vía alias), gana el de mayor similitud de PRIMERA PALABRA.
                    // "BOLTOR"≈"BOLTOR"=1.0 gana a "BOLTOR"≈"AKBOLTO"≈0.57 — genérico, sin
                    // hardcodear qué palabra va con cuál.
                    const ocrFirst = (matchedIndexOffset
                        ? textWords[i] + textWords[i + 1]
                        : textWords[i]).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
                    const score = this.similarityOCR(ocrFirst, item.firstWord.toUpperCase());
                    // matched.length === 1: NINGÚN componente respaldó el match (el ítem es de
                    // una palabra, o el resto era opcional). Ver UNCORROBORATED_THR.
                    if (matched.length === 1 && score < UNCORROBORATED_THR) continue;
                    // Prioridad: (1) más palabras OCR cubiertas; (2) item MÁS ESPECÍFICO
                    // (más componentes) — evita que "Harrow Blueprint" (2) fusione
                    // "CHASSIS BLUEPRINT" y empate con "Harrow Chassis Blueprint" (3);
                    // (3) mayor similitud de 1ª palabra (Boltor vs Akbolto). Todo genérico.
                    const words = item.searchWords.length;
                    if (matched.length > longestMatch
                        || (matched.length === longestMatch && words > bestWords)
                        || (matched.length === longestMatch && words === bestWords && score > bestScore)) {
                        longestMatch = matched.length;
                        bestWords = words;
                        bestScore = score;
                        bestItem = item;
                    }
                }
            }
        }

        return bestItem;
    }
};