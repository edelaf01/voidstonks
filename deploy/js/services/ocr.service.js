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

    _ocrConfMap: (() => {
        const groups = ["O0QDCG", "IL1T|J", "S5", "B8", "G6", "Z2", "UV", "NMH", "PF", "EF", "RT", "VY", "A4", "KR", "W"];
        const map = new Map();
        for (const g of groups) for (const ch of g) map.set(ch, (map.get(ch) || "") + g);
        return map;
    })(),

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
    RELIC_NOISE_TOKENS: new Set([
        "RELIC", "RADIANT", "INTACT", "EXCEPTIONAL", "FLAWLESS",
        "RELIQUIA", "RADIANTE", "INTACTA", "EXCEPCIONAL", "IMPECABLE"
    ]),

    _fixRelicDigits(s) {
        return s
            .replaceAll("Z", "2").replaceAll("S", "5").replaceAll("B", "8")
            .replaceAll("G", "6").replaceAll("O", "0").replaceAll(/[IL]/g, "1");
    },

    _fixRelicCode(codeRaw, isRequiem) {
        let code = codeRaw;
        if (!isRequiem && code.length >= 2) {
            code = this._fixRelicDigits(code);
        } else if (isRequiem) {
            code = code
                .replaceAll("1", "I").replaceAll("0", "O").replaceAll("2", "II")
                .replaceAll("3", "III").replaceAll("4", "IV");
        }
        return code;
    },

    parseRelicSelection(ocrText) {
        const tiers = this.RELIC_TIERS;
        const text = ocrText.toUpperCase();
        const pattern = tiers.join("|");
        const match = new RegExp(String.raw`(${pattern})[\s\S]*?([A-Z][0-9]{1,2}|[IVX]+)`, "i").exec(text);
        if (!match) return null;

        const tier = match[1].toUpperCase();
        const codeRaw = match[2].trim().replaceAll(/\s+/g, "");
        const isRequiem = tier === "REQUIEM";
        const code = this._fixRelicCode(codeRaw, isRequiem);

        if (code && code.length >= 1) {
            const foundRelic = `${tier} ${code}`.toUpperCase();
            const exists = state.allRelicNames?.some(n => n.toUpperCase() === foundRelic);
            return exists ? foundRelic : null;
        }
        return null;
    },

    getRelicMatch(combinedText) {
        if (!combinedText) return null;
        const rawWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);
        const words = rawWords
            .map(w => (w || "").toString().toUpperCase().replaceAll(/[^A-Z0-9]/g, ""))
            .filter(w => w.length > 0 && !this.RELIC_NOISE_TOKENS.has(w));

        const tiers = this.RELIC_TIERS;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const tierWord = word
                .replaceAll("0", "O").replaceAll("1", "I")
                .replaceAll("5", "S").replaceAll("8", "B");
            let tier = null;
            let remainder = "";

            for (const t of tiers) {
                if (tierWord === t) { tier = t; break; }
                if (tierWord.length > t.length && tierWord.startsWith(t)) { tier = t; remainder = word.slice(t.length); break; }
            }
            if (!tier) {
                for (const t of tiers) {
                    if (this.getSimilarity(tierWord, t) >= 0.75) { tier = t; break; }
                }
            }
            if (!tier) {
                for (const t of tiers) {
                    if (word.length !== t.length) continue;
                    let mismatches = 0;
                    let mismatchesAreDigits = true;
                    for (let k = 0; k < t.length; k++) {
                        if (tierWord[k] !== t[k]) {
                            mismatches++;
                            if (!/[0-9]/.test(word[k])) { mismatchesAreDigits = false; break; }
                        }
                    }
                    if (mismatchesAreDigits && mismatches === 1) { tier = t; break; }
                }
            }
            if (!tier) continue;

            let codeRaw = remainder;
            if (!codeRaw) {
                for (let j = i + 1; j < Math.min(i + 3, words.length); j++) {
                    const cand = words[j];
                    if (/^[A-Z][0-9]{1,2}$/.test(cand) || /^[IVX]+$/.test(cand) || /^[A-Z][A-Z0-9]$/.test(cand) || /^[0-9][0-9]{1,2}$/.test(cand)) {
                        codeRaw = cand;
                        break;
                    }
                }
            }
            if (!codeRaw) continue;

            const isRequiem = tier === "REQUIEM";
            const DIGIT_TO_CODE_LETTER = { "1": "I", "0": "O", "8": "B", "5": "S", "6": "G", "2": "Z" };
            let code;
            if (isRequiem) {
                code = this._fixRelicCode(codeRaw, true);
            } else if (codeRaw.length >= 2) {
                const lead = DIGIT_TO_CODE_LETTER[codeRaw.charAt(0)] || codeRaw.charAt(0);
                code = lead + this._fixRelicDigits(codeRaw.slice(1));
            } else {
                code = codeRaw;
            }
            if (!code) continue;

            const foundRelicUpper = `${tier} ${code}`.toUpperCase();
            const canonical = state.allRelicNames?.find(n => n.toUpperCase() === foundRelicUpper);
            if (canonical) return canonical;
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

            let matchedToken = knownTokens.includes(text) ? text : null;
            if (!matchedToken) {
                let best = null, bestScore = text.length >= 7 ? 0.70 : 0.72;
                for (const token of knownTokens) {
                    const s = this.similarityOCR(text, token);
                    if (s > bestScore) { bestScore = s; best = token; }
                }
                matchedToken = best;
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
        const MARGIN_RIGHT = isStrip ? imgW : (imgW * 0.26);

        const allFirstTokens = new Set(this.cachedDbItems.map(item => item.searchWords[0]));
        const globalAnchors = validWords.filter(w => allFirstTokens.has(w.text)).sort((a, b) => a.x - b.x);

        for (const dbItem of this.cachedDbItems) {
            const searchTokens = dbItem.searchWords;
            const anchors = validWords.filter(w => w.text === searchTokens[0]);

            for (const anchor of anchors) {
                const nextAnchor = isStrip ? null : globalAnchors.find(a => a.x > anchor.x + (imgW * 0.05));
                const maxRightX = nextAnchor ? Math.min(anchor.x + MARGIN_RIGHT, nextAnchor.x - 1) : anchor.x + MARGIN_RIGHT;

                const sameLineTol = imgW * 0.008;
                const localWords = validWords.filter(w =>
                    w.x >= (anchor.x - MARGIN_LEFT) && w.x <= maxRightX &&
                    (isStrip || !(w.x < anchor.x && Math.abs(w.y - anchor.y) < sameLineTol))
                );
                const metadata = this.extractInventoryMetadata(localWords);

                const localSoupText = localWords.map(w => w.text).join(" ");
                const penaltyWords = isStrip ? localWords : localWords.filter(w => Math.abs(w.x - anchor.x) <= imgW * 0.13);
                const ratio = this._calculateMatchRatio(dbItem, localSoupText, localWords, penaltyWords);

                const minWords = searchTokens.length === 1 ? 1 : (isStrip ? 1 : 2);
                const minRatio = isStrip ? 0.55 : 0.65;

                if (ratio > minRatio && this._countValidTokens(searchTokens, localWords) >= minWords) {
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

    _countValidTokens(searchTokens, localWords) {
        let count = 0;
        const localTexts = localWords.map(lw => lw.text);
        searchTokens.forEach(token => {
            if (localTexts.some(lt => lt === token || this.getSimilarity(lt, token) > 0.8)) {
                count++;
            }
        });
        return count;
    },

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
        const soupHasToken = (tok) => penaltyWords.some(w => w.text === tok);
        const soupHasWfPart = wfParts.some(p => soupHasToken(p) || penaltyWords.some(w => this.getSimilarity(w.text, p) > 0.7));

        if (wpnParts.some(soupHasToken)) {
            if (isMainBlueprint) ratio -= 0.8;
        } else if (soupHasWfPart) {
            if (isMainBlueprint) ratio -= 0.6;
        } else if (soupHasToken("BLUEPRINT")) {
            const nameTokens = name.split(/[^A-Z0-9]+/);
            if (wpnParts.some(p => nameTokens.includes(p))) ratio -= 0.6;
        }
        return ratio;
    },

    _countValidTokens(searchTokens, localWords) {
        let count = 0;
        const localTexts = localWords.map(lw => lw.text);

        searchTokens.forEach(token => {
            const hasMatch = localTexts.some(lt => lt === token || this.getSimilarity(lt, token) > 0.8);
            if (hasMatch) count++;
        });
        return count;
    },

    _consolidateMatches(itemMatches, imgW) {
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

    _repairBadgeWords(words) {
        words.forEach(w => {
            w.text = w.text.toUpperCase()
                .replaceAll(/[Il|]/g, "1")
                .replaceAll(/[t]/g, "1")
                .replaceAll(/[T]/g, "7")
                .replaceAll(/[Yy]/g, "7")
                .replaceAll(/[A]/g, "4")
                .replaceAll(/[S]/g, "5")
                .replaceAll(/[B]/g, "8")
                .replaceAll(/[G]/g, "6")
                .replaceAll(/[Z]/g, "2")
                .replaceAll(/[O]/g, "0")
                .replaceAll(/[q]/g, "9");
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

        // split OCR words on separators: Tesseract glues "CARRIER.PRIME"
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
            const thr = cleanDB.length <= 4 ? 0.72 : 0.62;
            return this.similarityOCR(cleanOCR, cleanDB) >= thr;
        };

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
                    const ocrFirst = (matchedIndexOffset
                        ? textWords[i] + textWords[i + 1]
                        : textWords[i]).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
                    const score = this.similarityOCR(ocrFirst, item.firstWord.toUpperCase());
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