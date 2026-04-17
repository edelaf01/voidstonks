import { state } from "../state.js";
import { OCRRepository } from "../repositories/ocr.repository.js";

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

    parseRelicSelection(ocrText) {
        const tiers = ["LITH", "MESO", "NEO", "AXI", "REQUIEM"];
        const text = ocrText.toUpperCase();
        const pattern = tiers.join("|");
        const match = new RegExp(String.raw`(${pattern})[\s\S]*?([A-Z][0-9]{1,2}|[IVX]+)`, "i").exec(text);
        if (!match) return null;

        const tier = match[1].toUpperCase();
        const codeRaw = match[2].trim().replaceAll(/\s+/g, "");
        const isRequiem = tier === "REQUIEM";

        let code = codeRaw;
        if (!isRequiem && code.length >= 2) {
            code = code
                .replaceAll("Z", "2").replaceAll("S", "5").replaceAll("B", "8")
                .replaceAll("G", "6").replaceAll("O", "0").replaceAll(/[IL]/g, "1");
        } else if (isRequiem) {
            code = code
                .replaceAll("1", "I").replaceAll("0", "O").replaceAll("2", "II")
                .replaceAll("3", "III").replaceAll("4", "IV");
        }

        if (code && code.length >= 1) {
            const foundRelic = `${tier} ${code}`.toUpperCase();
            const exists = state.allRelicNames?.some(n => n.toUpperCase() === foundRelic);
            return exists ? foundRelic : null;
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
                for (const token of knownTokens) {
                    if (this.getSimilarity(text, token) >= 0.75) {
                        matchedToken = token;
                        break;
                    }
                }
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
        const MARGIN_RIGHT = isStrip ? imgW : (imgW * 0.18);

        const allFirstTokens = new Set(this.cachedDbItems.map(item => item.searchWords[0]));
        const globalAnchors = validWords.filter(w => allFirstTokens.has(w.text)).sort((a, b) => a.x - b.x);

        for (const dbItem of this.cachedDbItems) {
            const searchTokens = dbItem.searchWords;
            const anchors = validWords.filter(w => w.text === searchTokens[0]);

            for (const anchor of anchors) {
                const nextAnchor = isStrip ? null : globalAnchors.find(a => a.x > anchor.x + (imgW * 0.05));
                const maxRightX = nextAnchor ? Math.min(anchor.x + MARGIN_RIGHT, nextAnchor.x - 1) : anchor.x + MARGIN_RIGHT;

                const localWords = validWords.filter(w => w.x >= (anchor.x - MARGIN_LEFT) && w.x <= maxRightX);
                const metadata = this.extractInventoryMetadata(localWords);

                const localSoupText = localWords.map(w => w.text).join(" ");
                const ratio = this._calculateMatchRatio(dbItem, localSoupText, localWords);

                const minWords = searchTokens.length === 1 ? 1 : (isStrip ? 1 : 2);
                const minRatio = isStrip ? 0.55 : 0.65;

                if (ratio > minRatio && this._countValidTokens(searchTokens, localWords) >= minWords) {
                    itemMatches.push({
                        name: dbItem.originalName,
                        ratio: ratio,
                        x: anchor.x,
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

    _calculateMatchRatio(dbItem, localSoupText, localWords) {
        const wfParts = ["CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];
        const wpnParts = ["BARREL", "RECEIVER", "STOCK", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB", "LINK", "POUCH", "GUARD", "DISC", "STARS", "BAND", "BOOT"];
        const searchTokens = dbItem.searchWords;

        let matchScore = 1.0;
        for (let i = 1; i < searchTokens.length; i++) {
            const token = searchTokens[i];
            if (localWords.some(w => w.text === token)) matchScore += 1;
            else if (token === "BLUEPRINT" && wfParts.some(p => dbItem.originalName.toUpperCase().includes(p))) matchScore += 0.8;
        }

        let ratio = matchScore / searchTokens.length;
        const name = dbItem.originalName.toUpperCase();
        const isMainBlueprint = name.endsWith("BLUEPRINT") && !wfParts.some(p => name.includes(p));

        if (wpnParts.some(p => localSoupText.includes(p))) {
            if (isMainBlueprint) ratio -= 0.8;
        } else if (localSoupText.includes("BLUEPRINT")) {
            if (wpnParts.some(p => name.includes(p))) ratio -= 0.6;
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
        itemMatches.sort((a, b) => b.ratio - a.ratio);
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

        const loneMatch = text.match(/(?:\s|^)(\d+)(?:\s|$)/);
        if (loneMatch && loneMatch[1]) {
            const val = parseInt(loneMatch[1], 10);
            if (val < 1000) return { owned: val, crafted: 0 };
        }

        return { owned: 0, crafted: 0 };
    },

    async extractCellText(worker, textCanvas) {
        const { data: { words } } = await OCRRepository.recognize(worker, textCanvas);
        if (!words || words.length < 1) return null;
        return words.map((w) => w.text.toUpperCase());
    },

    async extractCellQuantity(worker, badgeCanvas) {
        const { data: { words } } = await OCRRepository.recognize(worker, badgeCanvas);
        if (!words) return { qty: 1, raw: "" };
        const badgeNums = words.filter((w) => /\d/.test(w.text));

        const rawTexts = words.map(w => w.text).join(" ");

        if (badgeNums.length === 0) return { qty: 1, raw: rawTexts };

        badgeNums.sort((a, b) => b.bbox.x0 - a.bbox.x0);
        const pureDigit = badgeNums[0].text.replaceAll(/\D/g, "");
        if (pureDigit) {
            const val = Number.parseInt(pureDigit);
            return { qty: (val > 1 && val < 1000) ? val : 1, raw: rawTexts };
        }
        return { qty: 1, raw: rawTexts };
    },

    getValidItemMatch(combinedText) {
        if (!this.cachedDbItems.length) this.initMatcherData();

        const textWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);

        if (textWords.length === 0) return null;

        const isOptionalBlueprint = (targetComp, prevWordDB) => {
            if (targetComp !== "BLUEPRINT") return false;
            return ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM", "FORMA"].includes(prevWordDB);
        };

        const isFirstWordMatch = (ocrStr, dbFirstWord) => {
            const cleanOCR = ocrStr.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            const cleanDB = dbFirstWord.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            if (cleanOCR === cleanDB) return true;
            if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;
            const similarityThreshold = dbFirstWord.length <= 3 ? 0.8 : 0.75;
            return this.getSimilarity(cleanOCR, cleanDB) >= similarityThreshold;
        };

        const attemptItemMatch = (startIndex, item, lookAheadLimit, ocrWords) => {
            const matchedIndices = [startIndex];
            let currentPos = startIndex;
            for (let j = 1; j < item.searchWords.length; j++) {
                const targetComp = item.searchWords[j];
                let found = false;
                for (let dist = 1; dist <= lookAheadLimit; dist++) {
                    const nextIdx = currentPos + dist;
                    if (nextIdx >= ocrWords.length) continue;
                    if (this.getSimilarity(ocrWords[nextIdx].replaceAll(/[^A-Z]/g, ""), targetComp) >= 0.70) {
                        matchedIndices.push(nextIdx);
                        currentPos = nextIdx;
                        found = true;
                        break;
                    }
                }
                if (!found && !isOptionalBlueprint(targetComp, item.searchWords[j - 1])) return null;
            }
            return matchedIndices;
        };

        let bestItem = null;
        let longestMatch = 0;

        for (const item of this.cachedDbItems) {
            for (let i = 0; i < textWords.length; i++) {
                if (isFirstWordMatch(textWords[i], item.firstWord)) {
                    const matched = attemptItemMatch(i, item, 4, textWords);
                    if (matched && matched.length > longestMatch) {
                        longestMatch = matched.length;
                        bestItem = item;
                    }
                }
            }
        }

        return bestItem;
    }
};