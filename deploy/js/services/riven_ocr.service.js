import { state } from "../state.js";
import { RIVEN_STATS, RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS, resolveBaseStatKey, canBeNegative } from "../config.js";

const RIVEN_NAMING_DICT = {
  "critical_chance": { prefix: "Crita", suffix: "cron" },
  "critical_damage": { prefix: "Acri", suffix: "tis" },
  "multishot": { prefix: "Sati", suffix: "can" },
  "base_damage_/_melee_damage": { prefix: "Visi", suffix: "ata" },
  "fire_rate_/_attack_speed": { prefix: "Croni", suffix: "dra" },
  "status_chance": { prefix: "Hexa", suffix: "dex" },
  "status_duration": { prefix: "Deci", suffix: "des" },
  "toxin_damage": { prefix: "Toxi", suffix: "tox" },
  "heat_damage": { prefix: "Igni", suffix: "pha" },
  "electric_damage": { prefix: "Vexi", suffix: "tio" },
  "cold_damage": { prefix: "Geli", suffix: "do" },
  "impact_damage": { prefix: "Magna", suffix: "ton" },
  "puncture_damage": { prefix: "Insi", suffix: "cak" },
  "slash_damage": { prefix: "Sci", suffix: "sus" },
  "weapon_recoil": { prefix: "Zeti", suffix: "mag" },
  "magazine_capacity": { prefix: "Arma", suffix: "tin" },
  "reload_speed": { prefix: "Feva", suffix: "tak" },
  "ammo_maximum": { prefix: "Ampi", suffix: "bin" },
  "flight_speed": { prefix: "Conci", suffix: "nak" },
  "projectile_flight_speed": { prefix: "Conci", suffix: "nak" },
  "zoom": { prefix: "Hera", suffix: "lis" },
  "punch_through": { prefix: "Lexi", suffix: "nok" },
  "melee_range": { prefix: "Locta", suffix: "tox" },
  "range": { prefix: "Locta", suffix: "tox" },
  "combo_duration": { prefix: "Tempa", suffix: "tis" },
  "slide_crit_chance": { prefix: "Pleci", suffix: "ment" },
  "combo_count_chance": { prefix: "Pram", suffix: "co" },
  "damage_vs_corpus": { prefix: "Manti", suffix: "tron" },
  "damage_vs_grineer": { prefix: "Argi", suffix: "con" },
  "damage_vs_infested": { prefix: "Pura", suffix: "ada" }
};

// Formas alternativas que la carta muestra pero el catálogo no recoge en name_en/name_es:
// la carta dice "-X% Weapon Recoil" pero el stat se llama solo "Recoil". Sin esto, la
// primera palabra ("weapon") no ancla en _matchStatAnchored y una línea fusionada tipo
// "Weapon Recoil Puncture" (la línea siguiente perdió su valor) cae al match del nombre
// completo, donde "Puncture" empata a una palabra con "Recoil" y gana por orden de catálogo.
const STAT_ALIASES = {
    "weapon_recoil": ["weapon recoil", "retroceso del arma"]
};

/**
 * Service for parsing Riven card OCR output and comparing rolls.
 */
export const RivenOCRService = {

    /**
     * Normalizes common Tesseract character misinterpretations.
     */
    _normalize(text) {
        return text
            .replace(/[|l!]/g, "I") // Normalize vertical line noise to I, but preserve digit 1
            .replace(/\bO\b/g, "0")
            .replace(/\b[oO](\d)/g, "0$1")
            .replace(/(\d)[oO]\b/g, "$10")
            .replace(/\s+/g, " ")
            .trim();
    },

    /**
     * Matches raw OCR text with a known Riven attribute name.
     */
    _matchStat(rawName) {
        const norm = (t) => t.toLowerCase().replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim();
        // Alt candidate undoes _normalize's l→I substitution before lowercasing
        const candidates = [norm(rawName), norm(rawName.replace(/I/g, "l"))].filter(c => c.length >= 3);
        if (!candidates.length) return null;

        // 1. Exact full-name match (highest confidence)
        for (const c of candidates) {
            for (const s of RIVEN_STATS) {
                if (s.name_en.toLowerCase() === c || s.name_es.toLowerCase() === c) return s.name_en;
            }
        }

        // 1b. Aliases conocidos (ver STAT_ALIASES arriba): match exacto de la forma completa
        // que muestra la carta, antes del word-match para no depender de empates.
        for (const c of candidates) {
            for (const [slug, aliases] of Object.entries(STAT_ALIASES)) {
                if (aliases.some(alias => alias === c)) {
                    const stat = RIVEN_STATS.find(s => s.slug === slug);
                    if (stat) return stat.name_en;
                }
            }
        }

        // 2. Most-specific word match. For each stat we build candidate "forms" (the english and
        // spanish names, split on "/" for dual stats like "Fire Rate / Attack Speed"). A form
        // matches only if EVERY one of its words appears in the OCR text; among all matching
        // forms we pick the one with the MOST words. This prevents the short generic "Damage"
        // from beating the more specific "Crit Damage" / "Damage to Grineer" / "Finisher Damage".
        let best = null, bestWords = 0;
        for (const c of candidates) {
            const cwords = c.split(" ").filter(Boolean);
            for (const s of RIVEN_STATS) {
                const forms = `${s.name_en}/${s.name_es}`.split("/").map(norm).filter(Boolean);
                for (const form of forms) {
                    const fwords = form.split(" ").filter(w => w.length >= 2);
                    if (!fwords.length) continue;
                    // A form word matches a candidate word by exact equality, or by substring ONLY
                    // when the shorter side is ≥3 chars. Without that length guard, stray 1-char OCR
                    // tokens (e.g. "i","a") match any word ("slide".includes("i")) and let long junk
                    // names like "Slide Attack Critical Chance" beat the real "Heat".
                    const wordMatch = (w, cw) =>
                        cw === w ||
                        (cw.length >= 3 && w.includes(cw)) ||
                        (w.length >= 3 && cw.includes(w));
                    const allPresent = fwords.every(w => cwords.some(cw => wordMatch(w, cw)));
                    if (allPresent && fwords.length > bestWords) {
                        best = s.name_en;
                        bestWords = fwords.length;
                    }
                }
            }
        }
        if (best) return best;

        // 3. Levenshtein fallback for remaining OCR typos (max distance 2)
        let bestDist = Infinity, bestMatch = null;
        for (const c of candidates) {
            if (c.length < 4) continue;
            for (const s of RIVEN_STATS) {
                const en = s.name_en.toLowerCase();
                const d = this._levenshtein(c, en);
                const maxDist = en.length <= 5 ? 1 : 2;
                if (d < bestDist && d <= maxDist) {
                    bestDist = d;
                    bestMatch = s.name_en;
                }
            }
        }
        return bestMatch;
    },

    // El nombre capturado por PCT_RE puede arrastrar la línea SIGUIENTE cuando a esa le falta su
    // valor (p.ej. el curse "-23.1% Ammo Maximum" pierde el número en el OCR y queda "Zoom Ammo
    // Maximum", que _matchStat resolvía a "Ammo Maximum": el curse aparecía como positivo con el
    // valor del Zoom). El stat correcto es el que EMPIEZA en la primera palabra (el valor
    // pertenece al nombre inmediatamente posterior): probamos prefijos crecientes y nos quedamos
    // con el match más largo cuyas formas cubren esa primera palabra ("Damage to Grineer" sigue
    // ganando a "Damage"). Si ninguno ancla (p.ej. "Weapon Recoil", cuyo name_en es solo
    // "Recoil"), caemos al comportamiento previo con el nombre completo.
    _matchStatAnchored(rawName) {
        const words = rawName.split(/\s+/).filter(Boolean);
        const first = (words[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        let anchored = null;
        if (first.length >= 3) {
            for (let k = 1; k <= Math.min(5, words.length); k++) {
                const m = this._matchStat(words.slice(0, k).join(" "));
                if (!m) continue;
                const statDef = RIVEN_STATS.find(s => s.name_en === m);
                const aliasWords = (STAT_ALIASES[statDef?.slug] || []).join(" ");
                const formWords = `${m}/${statDef?.name_es || ""} ${aliasWords}`.toLowerCase().split(/[\s/]+/).filter(Boolean);
                if (formWords.some(w => w === first || w.includes(first) || first.includes(w))) {
                    anchored = m; // el prefijo anclado más largo gana (se sobreescribe al crecer k)
                }
            }
        }
        return anchored || this._matchStat(rawName);
    },

    /**
     * Matches raw OCR text with a weapon name from state.allRivenNames.
     */
    _matchWeapon(rawName) {
        return this._matchWeaponScored(rawName)?.name || null;
    },

    // Igual que _matchWeapon pero devolviendo la CALIDAD del match: { name, tier, dist }.
    // tier 3 = exacto, 2 = substring, 1 = Levenshtein (texto completo o palabra a palabra).
    // El que elige el arma entre varias líneas candidatas necesita la calidad para que un match
    // exacto ("Gotva Prime") gane siempre a uno difuso ("ignido" → "Ignis"), aunque el difuso
    // esté en una línea más cercana al bloque de stats.
    _matchWeaponScored(rawName) {
        if (!state.allRivenNames || state.allRivenNames.length === 0) {
            import("./rivens.service.js").then(m => m.fetchRivenWeapons()).catch(() => {});
            return null;
        }
        const clean = rawName.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (clean.length < 3) return null;

        // 1. Exact match
        const exact = state.allRivenNames.find(n => n.toLowerCase() === clean);
        if (exact) return { name: exact, tier: 3, dist: 0 };

        // 2. Substring match (whole weapon name contained in text, or vice versa)
        // Only allow substring matching if the substring is at least 4 chars to prevent false matches
        const sortedNames = [...state.allRivenNames].sort((a, b) => b.length - a.length);
        const sub = sortedNames.find(n => {
            const nl = n.toLowerCase();
            if (nl.length < 4 || clean.length < 4) return false;
            return clean.includes(nl) || nl.includes(clean);
        });
        if (sub) return { name: sub, tier: 2, dist: 0 };

        // 3. Levenshtein match for the whole text (handles minor typos)
        let bestDist = Infinity;
        let bestMatch = null;
        for (const name of state.allRivenNames) {
            const d = this._levenshtein(clean, name.toLowerCase());
            // Scale max distance based on name length to prevent short names (e.g. Hate, Anku) matching garbage (e.g. y le)
            let maxDist = 3;
            if (name.length <= 4) maxDist = 1;
            else if (name.length <= 6) maxDist = 2;

            if (d < bestDist && d <= maxDist) {
                bestDist = d;
                bestMatch = name;
            }
        }
        if (bestMatch) return { name: bestMatch, tier: 1, dist: bestDist };

        // 4. Word-by-word matching: check if any word in the text fuzzy matches a weapon name
        const words = clean.split(" ").filter(w => w.length >= 3);
        for (const word of words) {
            for (const name of state.allRivenNames) {
                const nameLower = name.toLowerCase();
                const d = this._levenshtein(word, nameLower);
                let maxDist = 2;
                if (name.length <= 4) maxDist = 1;

                if (d < bestDist && d <= maxDist) {
                    bestDist = d;
                    bestMatch = name;
                }
            }
        }

        return bestMatch ? { name: bestMatch, tier: 1, dist: bestDist } : null;
    },

    /**
     * Resolves the RIVEN_BASE_STATS key for a parsed stat name, given the weapon type index.
     * Firearms use "Fire Rate"; melee (idx 3) uses "Attack Speed". Shared with the grading path.
     */
    _baseStatKey(nameEn, typeIdx) {
        return resolveBaseStatKey(nameEn, typeIdx);
    },

    /**
     * Cross-checks a parsed Riven against the known-weapon stat tables.
     * A stat with a base value of 0 for the weapon's category is illegal on that weapon,
     * so it is flagged. Returns a confidence score and a list of human-readable issues
     * for logging, plus marks suspicious stats in place.
     */
    validateRiven(parsed) {
        if (!parsed) return { valid: false, confidence: 0, issues: ["no parse"] };

        const issues = [];
        const wInfo = parsed.weaponName ? state.weaponMap?.[parsed.weaponName] : null;
        const typeIdx = wInfo ? WEAPON_TYPE_IDX[wInfo.t] : undefined;
        const disp = wInfo?.d || 1;

        if (!parsed.weaponName) {
            issues.push("no weapon matched");
        } else if (typeIdx === undefined) {
            issues.push(`unknown category for "${parsed.weaponName}" (type=${wInfo?.t || "?"})`);
        }

        // Roll formula constants (mirrors calculateRivenGrade in riven_logic.js):
        //   displayed ≈ baseCoef * disposition * weight * 9, with a ±10% roll variance.
        const stats = parsed.stats || [];
        const buffCount = stats.filter(s => s.isPositive).length;
        const hasNeg = stats.some(s => !s.isPositive);
        const weights = RIVEN_WEIGHTS[`${buffCount}-${hasNeg ? 1 : 0}`] || RIVEN_WEIGHTS["2-0"];
        const SCALING = 9;

        let validStats = 0;
        for (const st of stats) {
            const key = this._baseStatKey(st.name, typeIdx);
            const baseArr = RIVEN_BASE_STATS[key];
            if (!baseArr) {
                issues.push(`stat "${st.name}" not in base table`);
                st.suspicious = true;
                continue;
            }
            if (typeIdx !== undefined) {
                const base = baseArr[typeIdx];
                if (!base) {
                    issues.push(`stat "${st.name}" illegal on ${wInfo.t}`);
                    st.suspicious = true;
                    continue;
                }
                // Magnitude sanity. The expected mid uses dispo, which is often a 1.0 fallback for
                // metastats-only weapons, so the band is wide — it catches gross OCR errors
                // (e.g. a dropped decimal giving 1000%), not normal roll/disposition spread.
                const weight = st.isPositive ? weights.buff : weights.curse;
                const expected = Math.abs(base * disp * weight * SCALING);
                if (expected > 0) {
                    const ratio = Math.abs(st.value) / expected;
                    if (ratio < 0.35 || ratio > 2.8) {
                        issues.push(`stat "${st.name}" ${st.value}% off-range (≈${expected.toFixed(0)} expected)`);
                        st.suspicious = true;
                        continue;
                    }
                }
            }
            validStats++;
        }

        const total = stats.length;
        const hardIssues = issues.filter(i => i.includes("illegal") || i.includes("off-range")).length;
        let confidence = total > 0 ? validStats / total : 0;
        if (!parsed.weaponName) confidence *= 0.4;
        else if (typeIdx === undefined) confidence *= 0.7;

        return {
            valid: !!parsed.weaponName && validStats >= 2 && hardIssues === 0,
            confidence: parseFloat(confidence.toFixed(2)),
            issues,
            typeIdx,
        };
    },

    /**
     * Computes the Levenshtein distance between two strings.
     */
    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i-1] === b[j-1]
                    ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
        }
        return dp[m][n];
    },

    /**
     * Parses raw Tesseract OCR text from a cropped Riven card image.
     */
    parseRivenCard(rawText) {
        if (!rawText || rawText.trim().length < 5) return null;

        const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return null;

        const stats = [];
        let rolls = null;
        let mr = null;

        const ROLL_LINE = /(\d+)\s*(?:roll|ciclo|○)/i;
        const MR_LINE = /\bMR\s*(\d+)/i;
        const STAT_ANCHOR = /[+\-–—]?\s*\d{1,4}(?:[.,]\d{1,2})?\s*%/;

        // Pass 1a: pull out MR / rolls, keep the rest in order, and find where the stat block starts.
        const contentLines = [];
        let firstStatIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const norm = this._normalize(lines[i]);
            const mrMatch = norm.match(MR_LINE);
            if (mrMatch) {
                mr = parseInt(mrMatch[1]);
                // The reroll counter (↻ N) shares the MR line. The ↻ glyph itself often OCRs as a
                // stray digit (e.g. 0), so take the LAST number on the line — the reroll count is
                // always rightmost ("MR 14   ↻ 15").
                const nums = norm.slice(mrMatch.index + mrMatch[0].length).match(/\d{1,3}/g);
                if (nums && rolls === null) rolls = parseInt(nums[nums.length - 1]);
                continue;
            }
            const rollMatch = norm.match(ROLL_LINE);
            if (rollMatch) { rolls = parseInt(rollMatch[1]); continue; }
            if (firstStatIdx === -1 && STAT_ANCHOR.test(norm)) firstStatIdx = contentLines.length;
            contentLines.push(norm);
        }

        let weaponName = null;
        let rivenName = null;

        if (firstStatIdx !== -1) {
            // Pass 1b: a single stat can wrap across lines (e.g. "+82.2% Fire Rate (x2 for / Bows)"),
            // so join the stat block and split it on each "<number>%" anchor rather than by line.
            // Each match is one stat: sign + value + the name up to the next anchor (or end).
            // El calificador condicional "(x2 for Bows)" se elimina GLOBALMENTE antes de ambos
            // regex: el OCR lo parte en líneas ("(x2 for" / "Bows)") o lo funde con otras palabras
            // ("x2 for Rate"), y si sobrevive, MULT_RE lo captura como un falso stat multiplicador
            // (+100% de lo que sea). Solo un token tras "for" — un curse real "x0.7 Damage..." no
            // lleva "for" y no se ve afectado.
            const statBlock = contentLines.slice(firstStatIdx).join(" ")
                .replace(/\bMR\s*\d+/ig, " ")
                .replace(/\(?\s*x\s*\d+\s+for\s+[a-z)]+\)?/ig, " ");

            // Percentage stats. Each name runs up to the next "<number>%" OR an "x<mult>" curse
            // marker, so a faction curse ("x0.8 Damage to Grineer") is not swallowed into a name.
            // The number allows a SPACE decimal ("82 4%" → 82.4, OCR often drops the dot). The name
            // uses ".*?" (not "[^%]") so a stray noise "%" (e.g. "% CONFIRM") can't block the last
            // stat from terminating at end-of-block.
            const PCT_RE = /([+\-–—])?\s*(\d{1,4}(?:[.,\s]\d{1,2})?)\s*%\s*(.*?)\s*(?=\s*[+\-–—]?\s*\d{1,4}(?:[.,\s]\d{1,2})?\s*%|\s*x\s*[0-9]|$)/gi;
            let m;
            while ((m = PCT_RE.exec(statBlock)) !== null) {
                if (!m[2]) continue;
                const sign = (m[1] && /[\-–—]/.test(m[1])) ? "-" : "+";
                let value = parseFloat(m[2].replace(/[,\s]+/g, "."));
                // Recover a dropped decimal point (e.g. 1215 → 121.5, 822 → 82.2)
                if (value > 450 && value < 9999) value = parseFloat((value / 10).toFixed(1));
                // Ningún stat real de riven baja de ~15% ni con disposición mínima: un valor
                // diminuto ("+5% Puncture") es ruido del arte que casualmente casó con un nombre.
                if (value < 8) continue;
                // Strip wrapped qualifiers like "(x2 for Bows)" / "x2 for Bows" before matching the name
                const name = m[3]
                    .replace(/\([^)]*\)/g, " ")
                    .replace(/x\s*\d+\s+for\s+\w+/ig, " ")
                    .replace(/[^\w\s/]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                const matchedName = this._matchStatAnchored(name);
                if (matchedName) {
                    // Hay stats que el juego NUNCA genera como maldición (los cuatro elementales y
                    // Punch Through): si el OCR leyó un menos ahí, el signo es un error de lectura.
                    // La lista vive en config.js (canBeNegative) junto a RIVEN_BASE_STATS, que es
                    // donde está el resto del conocimiento de stats; antes este regex solo cubría
                    // los elementales y dejaba pasar "-Punch Through", que no existe.
                    let isPositive;
                    if (!canBeNegative(matchedName)) {
                        isPositive = true;
                    } else if (/^recoil$/i.test(matchedName)) {
                        // El recoil es un stat INVERTIDO: la carta muestra el buff con signo
                        // negativo ("-89.5% Weapon Recoil" = menos retroceso = bueno) y el curse
                        // en positivo. Sin esta inversión, una carta legítima con recoil-buff +
                        // curse normal suma 2 "negativos" y la validación estructural la rechaza
                        // entera (el roll nuevo nunca aparecía).
                        isPositive = sign === "-";
                    } else {
                        isPositive = sign === "+";
                    }
                    stats.push({ name: matchedName, value, isPositive, matched: true });
                }
            }

            // Faction damage is shown as a multiplier, not a percentage:
            //   "x1.74 Damage to Corpus" → +74% (positive),  "x0.8 Damage to Grineer" → -20% (curse).
            // So a multiplier >1 is positive and <1 is negative. The "(x2 for Bows)" conditional
            // qualifier is skipped because its trailing text ("for Bows") matches no stat name.
            // El nombre puede terminar en un dígito, otro "x<mult>", el fin del bloque O el primer
            // carácter fuera de su clase: el ruido del arte tras el curse ("x0.7 Damage to Grineer
            // A / N Om ye ... CYCLE FOR -.900") no deja ningún dígito limpio detrás, y con el
            // lookahead original (solo dígito/fin) el regex no cerraba nunca y el curse se PERDÍA
            // en casi todos los frames. Como la basura sigue siendo mayormente letras, además
            // probamos el nombre por prefijos decrecientes de palabras (4→2) contra _matchStat:
            // "Damage to Grineer A / N Om..." casa en el prefijo de 3 palabras.
            const MULT_RE = /x\s*(\d+(?:[.,]\d+)?)\s+([a-zA-Z][a-zA-Z\s/]+?)\s*(?=\s*(?:[+\-–—]?\s*\d|x\s*\d|$)|[^a-zA-Z\s/])/gi;
            // El formato multiplicador SOLO existe para daño a facción, así que casamos la facción
            // directamente en vez de pasar por _matchStat: si el OCR pierde el "to" ("x0.7 Damage
            // Grineer"), la forma "Damage to Grineer" fallaba (exige todas sus palabras) y ganaba
            // el genérico "Damage". La facción es la única palabra discriminante y sobrevive bien
            // al OCR; sin facción reconocible, se descarta (nunca era otro stat).
            const FACTION_MULT = [
                { re: /GRIN|GRJN|GR1N|GRTN/i, name: "Damage to Grineer" },
                { re: /CORP|C0RP|CDRP/i, name: "Damage to Corpus" },
                { re: /INFES|1NFES|NFEST|INFST/i, name: "Damage to Infested" },
            ];
            let mm;
            while ((mm = MULT_RE.exec(statBlock)) !== null) {
                const mult = parseFloat(mm[1].replace(",", "."));
                if (!(mult > 0) || mult === 1) continue;
                const name = mm[2].replace(/[^\w\s/]/g, " ").replace(/\s+/g, " ").trim();
                const matchedName = FACTION_MULT.find(f => f.re.test(name))?.name || null;
                if (matchedName && !stats.some(s => s.name === matchedName)) {
                    const value = parseFloat((Math.abs(mult - 1) * 100).toFixed(1));
                    stats.push({ name: matchedName, value, isPositive: mult > 1, matched: true });
                }
            }

            // Pass 2: weapon & riven name from the content lines above the stat block.
            // Elige por CALIDAD de match entre TODAS las líneas candidatas, no por cercanía al
            // bloque de stats: el nombre del riven envuelto a 2 líneas ("Gotva Prime Croni-" /
            // "ignido") deja su continuación como la línea MÁS cercana a los stats, y esa
            // continuación puede casar por Levenshtein con otra arma ("ignido" → "Ignis", dist 2),
            // alternando el arma mostrada según cómo saliera el OCR en cada frame. Un match
            // exacto/substring del arma real debe ganar siempre; a igualdad de tier gana la menor
            // distancia, y a igualdad total la línea más cercana a los stats (comportamiento previo).
            let bestW = null;
            for (let i = firstStatIdx - 1; i >= 0; i--) {
                const norm = contentLines[i];
                // El arte mete tokens espurios pegados a la línea del nombre: un dígito delante
                // ("4 Scourge Cronidex") hacía saltar el guard ^\d, y un "%" suelto detrás
                // ("Stug Sati-ignidex a%") el de includes("%") — y el arma se perdía. Recortamos
                // la basura no alfabética inicial y solo descartamos la línea si es un stat REAL
                // (dígito+%, STAT_ANCHOR), no por un % huérfano del ruido.
                const lineTxt = norm.replace(/^[^A-Za-z]+/, "");
                if (lineTxt.length <= 2 || STAT_ANCHOR.test(norm)) continue;

                const words = lineTxt.split(" ");
                let cand = null;
                if (words.length >= 2) {
                    const firstWord = words[0];
                    const restWords = words.slice(0, words.length - 1).join(" ");
                    cand = this._matchWeaponScored(restWords) || this._matchWeaponScored(firstWord) || this._matchWeaponScored(lineTxt);
                } else {
                    cand = this._matchWeaponScored(lineTxt);
                }

                if (cand && (!bestW || cand.tier > bestW.tier || (cand.tier === bestW.tier && cand.dist < bestW.dist))) {
                    bestW = { ...cand, norm };
                }
            }

            if (bestW) {
                weaponName = bestW.name;
                const norm = bestW.norm;

                // Clean Riven name to exclude OCR garbage prefix (like "sd aa")
                let wIdx = norm.toLowerCase().indexOf(weaponName.toLowerCase());
                if (wIdx === -1) {
                    const wordsLower = norm.toLowerCase().split(" ");
                    let bestWordIdx = -1;
                    let bestWordDist = Infinity;
                    for (let k = 0; k < wordsLower.length; k++) {
                        const d = this._levenshtein(wordsLower[k].replace(/[^a-z0-9]/g, ""), weaponName.toLowerCase());
                        if (d < bestWordDist && d <= 2) {
                            bestWordDist = d;
                            bestWordIdx = k;
                        }
                    }
                    if (bestWordIdx !== -1) {
                        rivenName = norm.split(" ").slice(bestWordIdx).join(" ");
                    } else {
                        rivenName = norm;
                    }
                } else {
                    rivenName = norm.substring(wIdx).trim();
                }
            }
        }

        if (!weaponName && stats.length === 0) return null;

        // Una carta real NUNCA tiene 4 positivos (2-3 buffs + 0-1 curse): si el parse dio 4 stats
        // todos positivos es que el ruido del arte se comió el "-" del curse (p.ej. "v7 91.9%
        // Ammo Maximum"), y el curse es SIEMPRE la última línea de stats de la carta → recupera
        // el signo ahí en vez de rechazar la carta entera. Si la última es un stat que no puede
        // rolar como curse (elemental, Punch Through) no hay recuperación posible: carta rota.
        if (stats.length === 4 && stats.every(s => s.isPositive)) {
            const last = stats[stats.length - 1];
            if (canBeNegative(last.name)) last.isPositive = false;
        }

        // Riven card structural validation (2-3 positives, 0-1 negatives, 2-4 total)
        const positives = stats.filter(s => s.isPositive);
        const negatives = stats.filter(s => !s.isPositive);
        if (positives.length < 2 || positives.length > 3) return null;
        if (negatives.length > 1) return null;
        if (stats.length < 2 || stats.length > 4) return null;

        if (weaponName && rivenName) {
            const statSlugs = positives.map(s => {
                const statDef = RIVEN_STATS.find(r => r.name_en === s.name);
                return statDef ? statDef.slug : null;
            }).filter(Boolean);

            const namings = statSlugs.map(slug => RIVEN_NAMING_DICT[slug]).filter(Boolean);
            if (namings.length > 0) {
                let ocrSuffix = rivenName.toLowerCase().replace(weaponName.toLowerCase(), "").replace(/[^a-z\-]/g, "").trim();
                const possibleSuffixes = this._generatePossibleSuffixes(namings);
                let bestSuffix = null;
                let bestDist = Infinity;
                for (const ps of possibleSuffixes) {
                    const d = this._levenshtein(ocrSuffix, ps.toLowerCase());
                    if (d < bestDist) {
                        bestDist = d;
                        bestSuffix = ps;
                    }
                }
                if (bestSuffix) {
                    rivenName = weaponName + " " + bestSuffix;
                }
            }
        }

        const result = { weaponName, rivenName, stats, rolls, mr };
        result.validation = this.validateRiven(result);
        return result;
    },

    _generatePossibleSuffixes(namings) {
        const list = [];
        if (namings.length === 1) {
            const p = namings[0];
            list.push(p.prefix + p.suffix.toLowerCase());
        } else if (namings.length === 2) {
            const [a, b] = namings;
            list.push(a.prefix + b.suffix.toLowerCase());
            list.push(b.prefix + a.suffix.toLowerCase());
        } else if (namings.length === 3) {
            const [a, b, c] = namings;
            const perm = [
                [a, b, c], [a, c, b],
                [b, a, c], [b, c, a],
                [c, a, b], [c, b, a]
            ];
            for (const [p1, p2, p3] of perm) {
                list.push(p1.prefix + p2.prefix.toLowerCase() + p3.suffix.toLowerCase());
                list.push(p1.prefix + "-" + p2.prefix.toLowerCase() + p3.suffix.toLowerCase());
            }
        }
        return list;
    },

    /**
     * Compares two Riven rolls for the same weapon and scores them.
     */
    async compareRolls(rollA, rollB) {
        const weaponName = rollA.weaponName || rollB.weaponName;
        if (!weaponName) return null;

        try {
            const { getMetaStats } = await import("./riven_market.service.js");
            // Unified valuation: the SAME shared appraisal the riven tab and scanner HUD use,
            // so the comparison winner is decided with identical pricing/scoring logic.
            const { appraiseParsedRiven } = await import("../ui.components/ui_rivens.js");

            const meta = getMetaStats(weaponName);
            if (!meta) return null;

            const apprA = (rollA?.stats?.length) ? appraiseParsedRiven(weaponName, rollA.stats, meta) : null;
            const apprB = (rollB?.stats?.length) ? appraiseParsedRiven(weaponName, rollB.stats, meta) : null;
            const tiers = apprA?.tiers || apprB?.tiers || { trash: 0, goodReroll: 0, godroll: 0 };
            const resultA = apprA?.prediction || { adjustedScore: 0, estimatedValue: tiers.trash };
            const resultB = apprB?.prediction || { adjustedScore: 0, estimatedValue: tiers.trash };

            const winner = resultB.adjustedScore > resultA.adjustedScore ? 1 : 0;
            const winRoll = winner === 0 ? rollA : rollB;
            const loseRoll = winner === 0 ? rollB : rollA;
            const winResult = winner === 0 ? resultA : resultB;
            const loseResult = winner === 0 ? resultB : resultA;

            const reason = this._buildCompareReason(winRoll, loseRoll, meta, winResult, loseResult);

            return {
                winner,
                scoreA: resultA.adjustedScore,
                scoreB: resultB.adjustedScore,
                priceA: resultA.estimatedValue,
                priceB: resultB.estimatedValue,
                tiers,
                reason,
            };
        } catch (e) {
            console.warn("[RivenOCR] compareRolls error:", e);
            return null;
        }
    },

    /**
     * Builds a human-readable comparison description.
     */
    _buildCompareReason(winRoll, loseRoll, meta, winResult, loseResult) {
        const bestPos = Array.isArray(meta.pos) ? meta.pos : (meta.pos?.best || []);
        const midPos = Array.isArray(meta.pos_tier?.mid) ? meta.pos_tier.mid : [];

        const tierLabel = (stat, isPositive) => {
            const nameLower = stat.name.toLowerCase();
            if (isPositive) {
                if (bestPos.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()))) return "BEST";
                if (midPos.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()))) return "MID";
                return "MEH";
            }
            return "NEG";
        };

        const summarize = (roll) => {
            return roll.stats
                .filter(s => s.isPositive)
                .map(s => `${s.name} (${tierLabel(s, true)})`)
                .join(", ") || "?";
        };

        const diff = Math.abs(winResult.adjustedScore - loseResult.adjustedScore);
        const qualifier = diff >= 20 ? "claramente superior" : diff >= 8 ? "mejor" : "ligeramente mejor";

        return `El roll con ${summarize(winRoll)} es ${qualifier} que el de ${summarize(loseRoll)}.`;
    },
};
