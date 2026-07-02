import { state } from "../state.js";
import { RIVEN_STATS, RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS, resolveBaseStatKey } from "../config.js";

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

    /**
     * Matches raw OCR text with a weapon name from state.allRivenNames.
     */
    _matchWeapon(rawName) {
        if (!state.allRivenNames || state.allRivenNames.length === 0) {
            import("./rivens.service.js").then(m => m.fetchRivenWeapons()).catch(() => {});
            return null;
        }
        const clean = rawName.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (clean.length < 3) return null;

        // 1. Exact match
        const exact = state.allRivenNames.find(n => n.toLowerCase() === clean);
        if (exact) return exact;

        // 2. Substring match (whole weapon name contained in text, or vice versa)
        // Only allow substring matching if the substring is at least 4 chars to prevent false matches
        const sortedNames = [...state.allRivenNames].sort((a, b) => b.length - a.length);
        const sub = sortedNames.find(n => {
            const nl = n.toLowerCase();
            if (nl.length < 4 || clean.length < 4) return false;
            return clean.includes(nl) || nl.includes(clean);
        });
        if (sub) return sub;

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
        if (bestMatch) return bestMatch;

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

        return bestMatch;
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
            const statBlock = contentLines.slice(firstStatIdx).join(" ").replace(/\bMR\s*\d+/ig, " ");

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
                // Strip wrapped qualifiers like "(x2 for Bows)" / "x2 for Bows" before matching the name
                const name = m[3]
                    .replace(/\([^)]*\)/g, " ")
                    .replace(/x\s*\d+\s+for\s+\w+/ig, " ")
                    .replace(/[^\w\s/]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                const matchedName = this._matchStat(name);
                if (matchedName) {
                    // Elemental damage (Heat/Cold/Electric/Toxin) can only roll positive on a
                    // riven — if OCR read a minus on it, the sign is a misread, so force positive.
                    const isPositive = /^(heat|cold|electric|toxin)$/i.test(matchedName) ? true : (sign === "+");
                    stats.push({ name: matchedName, value, isPositive, matched: true });
                }
            }

            // Faction damage is shown as a multiplier, not a percentage:
            //   "x1.74 Damage to Corpus" → +74% (positive),  "x0.8 Damage to Grineer" → -20% (curse).
            // So a multiplier >1 is positive and <1 is negative. The "(x2 for Bows)" conditional
            // qualifier is skipped because its trailing text ("for Bows") matches no stat name.
            const MULT_RE = /x\s*(\d+(?:[.,]\d+)?)\s+([a-zA-Z][a-zA-Z\s/]+?)\s*(?=\s*(?:[+\-–—]?\s*\d|x\s*\d|$))/gi;
            let mm;
            while ((mm = MULT_RE.exec(statBlock)) !== null) {
                const mult = parseFloat(mm[1].replace(",", "."));
                if (!(mult > 0) || mult === 1) continue;
                const name = mm[2].replace(/[^\w\s/]/g, " ").replace(/\s+/g, " ").trim();
                const matchedName = this._matchStat(name);
                if (matchedName && !stats.some(s => s.name === matchedName)) {
                    const value = parseFloat((Math.abs(mult - 1) * 100).toFixed(1));
                    stats.push({ name: matchedName, value, isPositive: mult > 1, matched: true });
                }
            }

            // Pass 2: weapon & riven name from the content lines above the stat block.
            for (let i = firstStatIdx - 1; i >= 0; i--) {
                const norm = contentLines[i];
                if (norm.length <= 2 || norm.match(/^\d/) || norm.includes("%")) continue;

                const words = norm.split(" ");
                let matchedW = null;
                if (words.length >= 2) {
                    const firstWord = words[0];
                    const restWords = words.slice(0, words.length - 1).join(" ");
                    matchedW = this._matchWeapon(restWords) || this._matchWeapon(firstWord) || this._matchWeapon(norm);
                } else {
                    matchedW = this._matchWeapon(norm);
                }

                if (matchedW) {
                    weaponName = matchedW;

                    // Clean Riven name to exclude OCR garbage prefix (like "sd aa")
                    let wIdx = norm.toLowerCase().indexOf(matchedW.toLowerCase());
                    if (wIdx === -1) {
                        const wordsLower = norm.toLowerCase().split(" ");
                        let bestWordIdx = -1;
                        let bestWordDist = Infinity;
                        for (let k = 0; k < wordsLower.length; k++) {
                            const d = this._levenshtein(wordsLower[k].replace(/[^a-z0-9]/g, ""), matchedW.toLowerCase());
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
                    break; // Found the closest weapon name, stop searching!
                }
            }
        }

        if (!weaponName && stats.length === 0) return null;

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
