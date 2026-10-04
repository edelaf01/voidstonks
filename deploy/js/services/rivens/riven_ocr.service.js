import { state } from "../../state.js";
import { RIVEN_NAMING_DICT } from "../../utils/rivens/riven_naming.js";
import { RIVEN_STATS, RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS, resolveBaseStatKey, canBeNegative } from "../../config.js";


const STAT_ALIASES = {
    "weapon_recoil": ["weapon recoil", "retroceso del arma"]
};

export const RivenOCRService = {

    _normalize(text) {
        return text
            .replace(/[|l!]/g, "I")
            .replace(/\bO\b/g, "0")
            .replace(/\b[oO](\d)/g, "0$1")
            .replace(/(\d)[oO]\b/g, "$10")
            .replace(/\s+/g, " ")
            .trim();
    },

    _matchStat(rawName) {
        const norm = (t) => t.toLowerCase().replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim();
        const candidates = [norm(rawName), norm(rawName.replace(/I/g, "l"))].filter(c => c.length >= 3);
        if (!candidates.length) return null;

        for (const c of candidates) {
            for (const s of RIVEN_STATS) {
                if (s.name_en.toLowerCase() === c || s.name_es.toLowerCase() === c) return s.name_en;
            }
        }

        for (const c of candidates) {
            for (const [slug, aliases] of Object.entries(STAT_ALIASES)) {
                if (aliases.some(alias => alias === c)) {
                    const stat = RIVEN_STATS.find(s => s.slug === slug);
                    if (stat) return stat.name_en;
                }
            }
        }

        let best = null, bestWords = 0;
        for (const c of candidates) {
            const cwords = c.split(" ").filter(Boolean);
            for (const s of RIVEN_STATS) {
                const forms = `${s.name_en}/${s.name_es}`.split("/").map(norm).filter(Boolean);
                for (const form of forms) {
                    const fwords = form.split(" ").filter(w => w.length >= 2);
                    if (!fwords.length) continue;
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
                    anchored = m;
                }
            }
        }
        return anchored || this._matchStat(rawName);
    },

    _matchWeapon(rawName) {
        return this._matchWeaponScored(rawName)?.name || null;
    },

    _matchWeaponScored(rawName) {
        if (!state.allRivenNames || state.allRivenNames.length === 0) {
            import("./rivens.service.js").then(m => m.fetchRivenWeapons()).catch(() => {});
            return null;
        }
        const clean = rawName.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (clean.length < 3) return null;

        const exact = state.allRivenNames.find(n => n.toLowerCase() === clean);
        if (exact) return { name: exact, tier: 3, dist: 0 };

        const sortedNames = [...state.allRivenNames].sort((a, b) => b.length - a.length);
        const sub = sortedNames.find(n => {
            const nl = n.toLowerCase();
            if (nl.length < 4 || clean.length < 4) return false;
            return clean.includes(nl) || (nl.includes(clean) && clean.length >= nl.length * 0.6);
        });
        if (sub) return { name: sub, tier: 2, dist: 0 };

        let bestDist = Infinity;
        let bestMatch = null;
        for (const name of state.allRivenNames) {
            const d = this._levenshtein(clean, name.toLowerCase());
            let maxDist = 3;
            if (name.length <= 4) maxDist = 1;
            else if (name.length <= 6) maxDist = 2;

            if (d < bestDist && d <= maxDist) {
                bestDist = d;
                bestMatch = name;
            }
        }
        if (bestMatch) return { name: bestMatch, tier: 1, dist: bestDist };

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

    _baseStatKey(nameEn, typeIdx) {
        return resolveBaseStatKey(nameEn, typeIdx);
    },

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

        const contentLines = [];
        let firstStatIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const norm = this._normalize(lines[i]);
            const mrMatch = norm.match(MR_LINE);
            if (mrMatch) {
                mr = parseInt(mrMatch[1]);
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
            const statBlock = contentLines.slice(firstStatIdx).join(" ")
                .replace(/\bMR\s*\d+/ig, " ")
                .replace(/\(?\s*x\s*\d+\s+for\s+[a-z)]+\)?/ig, " ");

            const PCT_RE = /([+\-–—])?\s*(\d{1,4}(?:[.,\s]\d{1,2})?)\s*%\s*(.*?)\s*(?=\s*[+\-–—]?\s*\d{1,4}(?:[.,\s]\d{1,2})?\s*%|\s*x\s*[0-9]|$)/gi;
            let m;
            while ((m = PCT_RE.exec(statBlock)) !== null) {
                if (!m[2]) continue;
                const sign = (m[1] && /[\-–—]/.test(m[1])) ? "-" : "+";
                let value = parseFloat(m[2].replace(/[,\s]+/g, "."));
                if (value > 450 && value < 9999) value = parseFloat((value / 10).toFixed(1));
                if (value < 8) continue;
                const name = m[3]
                    .replace(/\([^)]*\)/g, " ")
                    .replace(/x\s*\d+\s+for\s+\w+/ig, " ")
                    .replace(/[^\w\s/]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                const matchedName = this._matchStatAnchored(name);
                if (matchedName) {
                    let isPositive;
                    if (!canBeNegative(matchedName)) {
                        isPositive = true;
                    } else if (/^recoil$/i.test(matchedName)) {
                        // recoil is inverted: the card shows the buff with a minus and the curse with a plus
                        isPositive = sign === "-";
                    } else {
                        isPositive = sign === "+";
                    }
                    stats.push({ name: matchedName, value, isPositive, matched: true });
                }
            }

            const MULT_RE = /x\s*(\d+(?:[.,]\d+)?)\s+([a-zA-Z][a-zA-Z\s/]+?)\s*(?=\s*(?:[+\-–—]?\s*\d|x\s*\d|$)|[^a-zA-Z\s/])/gi;
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

            let bestW = null;
            for (let i = firstStatIdx - 1; i >= 0; i--) {
                const norm = contentLines[i];
                const lineTxt = norm.replace(/^[^A-Za-z]+/, "");
                if (lineTxt.length <= 2 || STAT_ANCHOR.test(norm)) continue;

                const words = lineTxt.split(" ");
                const opciones = words.length >= 2 ? [words.slice(0, -1).join(" "), words[0], lineTxt] : [lineTxt];
                let cand = null;
                for (const opcion of opciones) {
                    const m = this._matchWeaponScored(opcion);
                    if (m && (!cand || m.tier > cand.tier || (m.tier === cand.tier && m.dist < cand.dist))) cand = m;
                }

                if (cand && (!bestW || cand.tier > bestW.tier || (cand.tier === bestW.tier && cand.dist < bestW.dist))) {
                    bestW = { ...cand, norm };
                }
            }

            if (bestW) {
                weaponName = bestW.name;
                const norm = bestW.norm;

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

        // a real card never has 4 positives: art noise ate the curse "-", curse is always the last line
        if (stats.length === 4 && stats.every(s => s.isPositive)) {
            const last = stats[stats.length - 1];
            if (canBeNegative(last.name)) last.isPositive = false;
        }

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

    async compareRolls(rollA, rollB) {
        const weaponName = rollA.weaponName || rollB.weaponName;
        if (!weaponName) return null;

        try {
            const { getMetaStats } = await import("./riven_market.service.js");
            const { appraiseParsedRiven } = await import("./riven_appraisal.service.js");

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
