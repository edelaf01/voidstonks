import { state } from "../../state.js";
import { OCRRepository } from "../../repositories/ocr.repository.js";
import { readBadgeDigits } from "../../utils/vision/badge_digit_ocr.js";
import { splitFusedWord, catalogVocab, pareceDelVocab } from "../../utils/vision/word_split.js";
import { rawWords } from "../../utils/vision/ocr_words.js";
import { radioDeDedup, pasoEntreTarjetas, zonasDeRotulo } from "../../utils/vision/reward_cards.js";
import { recuperaComponente, recuperaPorSufijo } from "../../utils/inventory/component_recover.js";
import { normalizeOCRWords, tokensSinInformacion, tieneEvidenciaPropia, confirmaPrime } from "../../utils/inventory/ocr_words.js";

// the catalog is ASCII but PaddleOCR adds accents ("PRÍME")
const sinAcentos = (texto) => texto.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");

export const OCRService = {
    cachedDbItems: [],
    knownParts: new Set(),
    tokensGenericos: new Set(),
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
        this.tokensGenericos = tokensSinInformacion(this.cachedDbItems);
        this._vocabCache = null; this._pareceConocida = null;
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

    // Characters OCR mixes up (same glyph shape). Swapping within a group is cheap in similarityOCR.
    _ocrConfMap: (() => {
        // No "O6" group: it gave false positives ("AXI SO" became S6 instead of S9). A lost digit is
        // ambiguous and stays unmatched.
        const groups = ["O0QDCG", "IL1T|J", "S5", "B8", "G6", "Z2", "UV", "NMH", "PF", "EF", "RT", "VY", "A4", "KR", "W", "Q9"];
        const map = new Map();
        for (const g of groups) for (const ch of g) map.set(ch, (map.get(ch) || "") + g);
        return map;
    })(),

    /**
     * Similarity [0..1] aware of OCR confusions: weighted Levenshtein where a swap within a
     * confusion group costs 0.4 instead of 1.
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

    // Vanguard counts as an era: its 4 relics show in the inventory
    RELIC_TIERS: ["LITH", "MESO", "NEO", "AXI", "REQUIEM", "VANGUARD"],
    RELIC_NOISE_TOKENS: new Set([
        "RELIC", "RADIANT", "INTACT", "EXCEPTIONAL", "FLAWLESS",
        "RELIQUIA", "RADIANTE", "INTACTA", "EXCEPCIONAL", "IMPECABLE"
    ]),

    // Requiem codes are Roman numerals: "2" -> "II"
    _romanizeRequiem(code) {
        return code
            .replaceAll("1", "I").replaceAll("0", "O").replaceAll("2", "II")
            .replaceAll("3", "III").replaceAll("4", "IV");
    },

    parseRelicSelection(ocrText) {
        // without the panel label the matcher finds a relic in any garbage
        if (!/R[E3][L1I][I1L]C|REWARD|RECOMPENS/i.test(ocrText)) return null;
        const canonical = this.getRelicMatch(ocrText);
        return canonical ? canonical.toUpperCase().replace(/\s+RELIC$/, "") : null;
    },

    // Generic relic matching, same design as getValidItemMatch: all OCR tolerance goes through
    // similarityOCR against state.allRelicNames, with threshold and uniqueness margin. Only domain
    // rules on top: tiers are letters, codes are letter+digits (Requiem: Roman) and a word tail can
    // carry art noise.

    _relicIndexCache: null,
    // tier -> [{ code, canonical }] from state.allRelicNames
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

    _relicTierScore(word, tier) {
        let s = this.similarityOCR(word, tier);
        const stripped = word.replace(/[0-9]+$/, "");
        if (stripped !== word && stripped.length >= 2) {
            s = Math.max(s, this.similarityOCR(stripped, tier.slice(0, Math.max(stripped.length, 2))) - 0.08);
        }
        if (word.length >= 2 && word.length < tier.length && tier.length - word.length <= 1) {
            s = Math.max(s, this.similarityOCR(word, tier.slice(0, word.length)) - 0.08);
        }
        return s;
    },

    // Canonical name as in state.allRelicNames, or null. Takes OCR words (inventory cell) or free
    // text (selection screen).
    getRelicMatch(combinedText) {
        if (!combinedText || !state.allRelicNames?.length) return null;
        const rawWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);
        const words = rawWords
            .map(w => sinAcentos((w || "").toString()).toUpperCase()
                .replaceAll(/[|!¡\][]/g, "I")   // thin i/I/1 read as a bar
                .replaceAll(/\?/g, "7")
                .replaceAll(/[^A-Z0-9]/g, ""))
            .filter(w => w.length > 0 && !this.RELIC_NOISE_TOKENS.has(w));
        const index = this._relicIndex();
        // the cell literally says RELIC: only the code is in doubt, so the weak tier guard can relax
        const saysRelic = rawWords.some(w => /^(RELIC|RELIQUIA)S?$/.test(
            (w || "").toString().toUpperCase().replaceAll(/[^A-Z]/g, "")));

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // 1) tier by similarity
            let tier = null, tierS = 0;
            for (const t of this.RELIC_TIERS) {
                const s = this._relicTierScore(word, t);
                if (s > tierS) { tierS = s; tier = t; }
            }
            // a tier rescued from a 2-letter fragment ("NE" -> NEO) is weak evidence: the code must be
            // almost exact
            const weakTier = tier !== null && word.length === 2 && word.length < tier.length;
            let glueRemainder = "";
            if (tierS < 0.78) {
                // tier and code glued in one token ("LITHC1")
                tier = this.RELIC_TIERS.find(t => word.length > t.length && word.startsWith(t)) || null;
                if (!tier) continue;
                glueRemainder = word.slice(tier.length);
            }
            const codes = index.get(tier);
            if (!codes?.length) continue;

            // 2) Code candidates -> penalty: rebuilt variants weigh less than what OCR actually read, so a
            // literal read always wins.
            const cands = new Map();
            const addCand = (c, pen = 0) => {
                // 6, not 4: the longest code is "ETERNA" (Requiem Eterna)
                if (!c || c.length > 6) return;
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
                // The first char of a code is always a letter, so a digit there is an OCR error: put back the
                // candidate letters ("05" -> O5).
                const DIGIT_AS_LETTER = { "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "8": "B" };
                // From the second char on the code is numeric, so a letter there is art noise: try dropping it
                // ("OO5" -> O5).
                for (const [c, pen] of [...cands]) {
                    const letter = DIGIT_AS_LETTER[c[0]];
                    if (letter) addCand(letter + c.slice(1), pen);
                    // only if 2+ glyphs remain
                    if (c.length <= 2) continue;
                    for (let k = 1; k < c.length; k++) {
                        if (/[A-Z]/.test(c[k])) addCand(c.slice(0, k) + c.slice(k + 1), pen + 0.17);
                    }
                }
                // No code has a leading zero after the letter, so a '0' there is a glyph read twice
                // ("O05" -> O5).
                for (const [c, pen] of [...cands]) {
                    const m = /^([A-Z])0+([1-9][0-9]?)$/.exec(c);
                    if (m) addCand(m[1] + m[2], pen + 0.17);
                }
            }
            if (cands.size === 0) continue;

            // 3) Best code by similarity with uniqueness margin. The tail can be art noise ("A160" -> A16),
            // except in Requiem, where every Roman glyph counts.
            let best = null, bestS = 0, second = 0;
            for (const { code, canonical } of codes) {
                let s = 0;
                for (const [cand, pen] of cands) {
                    let cs = this.similarityOCR(cand, code);
                    // A well-formed code (letter + 1-2 digits) is not trimmed: if it is not in the catalog, the
                    // answer is "unknown", not a truncated match.
                    const wellFormed = /^[A-Z][0-9]{1,2}$/.test(cand);
                    if (!isRequiem && !wellFormed) {
                        // 0.17 per char: above a group confusion at the end, below a real error
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
            // Low threshold plus uniqueness margin: garbage scores flat against everything.
            if (weakTier && !saysRelic && bestS < 0.85) continue;
            if (bestS >= 0.70 && (bestS - second) >= 0.10) return best;
            if (bestS >= 0.80 && (bestS - second) >= 0.03) return best;
        }
        return null;
    },

    _normalizeOCRWords(ocrData) {
        return normalizeOCRWords(ocrData, this);
    },
    parseRewards(ocrData) {
        if (!ocrData?.words) return [];
        this.initMatcherData();
        const imgW = ocrData.imageW || 1920;
        const isStrip = ocrData.isStrip === true;
        const validWords = this._normalizeOCRWords(ocrData);

        const itemMatches = [];

        const MARGIN_LEFT = isStrip ? (imgW * 0.3) : (imgW * 0.05);
        // 0.26 for long one-line names ("Gunsen Prime Blueprint")
        const MARGIN_RIGHT = isStrip ? imgW : (imgW * 0.26);

        // raw words with their x: normalizeOCRWords already drops a mangled component ("noatoptics")
        const crudas = (ocrData.words || []).filter(w => w?.bbox)
            .map(w => ({ text: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2 }));

        const allFirstTokens = new Set(this.cachedDbItems.map(item => item.searchWords[0]));
        const globalAnchors = validWords.filter(w => allFirstTokens.has(w.text)).sort((a, b) => a.x - b.x);

        for (const dbItem of this.cachedDbItems) {
            const searchTokens = dbItem.searchWords;
            const anchors = validWords.filter(w => w.text === searchTokens[0]);

            for (const anchor of anchors) {
                const nextAnchor = isStrip ? null : globalAnchors.find(a => a.x > anchor.x + (imgW * 0.05));
                // Do not cut the window before nextAnchor or stretch it to imgW without one: a tint token becomes
                // a spurious anchor. The clamp to nextAnchor.x - 1 already isolates columns.
                const maxRightX = nextAnchor ? Math.min(anchor.x + MARGIN_RIGHT, nextAnchor.x - 1) : anchor.x + MARGIN_RIGHT;

                // A word left of the anchor on its own line belongs to the neighbor, never to this name:
                // excluded by Y.
                const sameLineTol = imgW * 0.008;
                const fx = anchor.x / imgW;
                const suya = ocrData.columnas?.find((c) => fx >= c.x0 && fx <= c.x1);
                const localWords = validWords.filter(w =>
                    w.x >= (anchor.x - MARGIN_LEFT) && w.x <= maxRightX &&
                    (isStrip || !(w.x < anchor.x && Math.abs(w.y - anchor.y) < sameLineTol))
                );
                // only for the component rescue: limiting the whole match to the column dropped multi-line labels
                const dentroDeSuya = (w) => suya
                    ? (w.x / imgW >= suya.x0 && w.x / imgW <= suya.x1)
                    : (w.x >= anchor.x - MARGIN_LEFT && w.x <= maxRightX);
                const enColumna = suya ? localWords.filter(dentroDeSuya) : localWords;
                const crudasColumna = crudas.filter(dentroDeSuya);
                const metadata = this.extractInventoryMetadata(localWords);

                const localSoupText = localWords.map(w => w.text).join(" ");
                // the parts penalty only sees words of this name: the neighbor's second line leaked a part in
                const penaltyWords = isStrip ? localWords : localWords.filter(w => Math.abs(w.x - anchor.x) <= imgW * 0.13);
                const ratio = this._calculateMatchRatio(dbItem, localSoupText, localWords, penaltyWords);

                const minWords = searchTokens.length === 1 ? 1 : (isStrip ? 1 : 2);
                const minRatio = isStrip ? 0.55 : 0.65;

                if (ratio > minRatio && this._countValidTokens(searchTokens, localWords) >= minWords
                    && tieneEvidenciaPropia(searchTokens, localWords, this.tokensGenericos)) {
                    // X center of the name, per token the closest occurrence to the anchor: generic tokens (PRIME,
                    // BLUEPRINT) show in both columns
                    const matchedWords = searchTokens
                        .map(tok => localWords
                            .filter(w => w.text === tok)
                            .sort((a, b) => Math.abs(a.x - anchor.x) - Math.abs(b.x - anchor.x))[0])
                        .filter(Boolean);
                    const avgX = matchedWords.length > 0
                        ? matchedWords.reduce((s, w) => s + w.x, 0) / matchedWords.length
                        : anchor.x;

                    itemMatches.push({
                        name: recuperaComponente(dbItem.originalName,
                            [...enColumna.map((w) => w.text), ...crudasColumna.map((w) => w.text)],
                            (n) => n in (state.itemsDatabase || {}), (a, b) => this.similarityOCR(a, b)),
                        ratio: ratio,
                        tokens: searchTokens.length,
                        x: avgX,
                        owned: metadata.owned,
                        crafted: metadata.crafted,
                        ownedRead: metadata.ownedRead === true
                    });
                }
            }
        }
        // A card with text but no anchor: the label tail ("PRIME BLUEPRINT") narrows the catalog.
        const pasoCol = ocrData.columnas?.length
            ? [...ocrData.columnas].map((c) => (c.x1 - c.x0) * imgW).sort((a, b) => a - b)[ocrData.columnas.length >> 1]
            : pasoEntreTarjetas(itemMatches, imgW);
        for (const z of zonasDeRotulo(ocrData.columnas, validWords, imgW, pasoCol)) {
            if (itemMatches.some((m) => m.x >= z.x0 && m.x <= z.x1)) continue;
            // raw words: normalizeOCRWords drops the misread first word, the one that tells the item apart
            const dentro = crudas.filter((w) => w.x >= z.x0 && w.x <= z.x1);
            if (!dentro.length) continue;
            const nombre = recuperaPorSufijo(dentro.map((w) => w.text), Object.keys(state.itemsDatabase || {}),
                (a, b) => this.similarityOCR(a, b));
            if (nombre) {
                itemMatches.push({ name: nombre, ratio: 0.7, tokens: 3, owned: 0, crafted: false, ownedRead: false,
                    x: dentro.reduce((a, w) => a + w.x, 0) / dentro.length });
            }
        }
        return this._consolidateMatches(itemMatches, imgW, ocrData.columnas);
    },

    // localWords: full column window, scores the name tokens. penaltyWords: only words next to the
    // anchor (≤0.13W), so a neighbor's part does not trigger the penalty.
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
        // parts by exact token, not substring: "LIMBO" contains "LIMB"
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

    _consolidateMatches(itemMatches, imgW, columnas) {
        // ratio desc, then more tokens
        itemMatches.sort((a, b) => b.ratio - a.ratio || (b.tokens || 0) - (a.tokens || 0));
        const radio = radioDeDedup(itemMatches, imgW, columnas);
        const finalItems = [];
        for (const match of itemMatches) {
            if (!finalItems.some(f => Math.abs(match.x - f.x) < radio)) {
                finalItems.push(match);
            }
        }
        return finalItems.toSorted((a, b) => a.x - b.x).map(item => ({
            name: item.name,
            xPos: item.x,
            imgW: imgW,
            owned: item.owned,
            crafted: item.crafted,
            // the auto-sync only writes when this is true
            ownedRead: item.ownedRead === true,
            ratio: item.ratio,
            confidence: 0.95
        }));
    },

    /**
     * Card label: "3 Owned" or "Crafted". `ownedRead` says whether the number was really read: the
     * auto-sync writes it into primeInventory. The game draws no label at 0, so an unread count is
     * null, never 0.
     */
    extractInventoryMetadata(wordsArray) {
        const sinLeer = { owned: null, crafted: 0, ownedRead: false };
        if (!wordsArray || wordsArray.length === 0) return sinLeer;
        const text = wordsArray.map(w => w.text).join(" ").toUpperCase();

        if (text.includes("CRAFTED") || text.includes("FORJA") || /CRAFT/i.test(text)) {
            return { owned: null, crafted: 1, ownedRead: false };
        }

        const strongMatch = text.match(/(\d+)\s*(?:OWNED|0WNED|QWNED|UWNED|OWNE|OWED|OWN|0WN|PROPIO|PROP)/);
        if (strongMatch && strongMatch[1]) {
            return { owned: parseInt(strongMatch[1], 10), crafted: 0, ownedRead: true };
        }

        // tag seen but not its number: 1 is fine to draw, not to write
        if (/OWNED|0WNED|OWNE|OWED|OWN|PROPIO|PROP/i.test(text)) {
            return { owned: 1, crafted: 0, ownedRead: false };
        }

        return sinLeer;
    },

    async extractCellText(worker, textCanvas) {
        const words = rawWords((await OCRRepository.recognize(worker, textCanvas, {}, { text: true, blocks: true })).data);
        return words.length ? words.map((w) => w.text.toUpperCase()) : null;
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

    // Quantity of one frame by digit template matching (utils/badge_digit_ocr.js).
    // `worker` is unused; scanner.service.js still passes it.
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
        // uppercase here: the color path returns mixed case
        const crudas = rawWords.flatMap(w => sinAcentos(w).split(/[^A-Za-z0-9]+/).filter(Boolean)).map(w => w.toUpperCase());
        this._vocabCache ||= catalogVocab(this.cachedDbItems);
        this._pareceConocida ||= pareceDelVocab(this._vocabCache, (a, b) => this.similarityOCR(a, b));
        const textWords = crudas.flatMap((w) => (w.length >= 8 && !this._vocabCache.has(w)
            && splitFusedWord(w, this._vocabCache, { pareceConocida: this._pareceConocida })) || [w]);

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
            // a correctly read catalog word is not another one by likeness ("CHASSIS" ~ "QUASSUS")
            if (this.knownParts.has(cleanOCR)) return false;
            if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;
            const thr = cleanDB.length <= 4 ? 0.72 : 0.62;
            return this.similarityOCR(cleanOCR, cleanDB) >= thr;
        };

        // Bar for a match no component backs (one-word items, "Forma Blueprint"): the first word is
        // the only proof.
        const UNCORROBORATED_THR = 0.85;

        // Components match by OCR-aware similarity with a lower bar: short known words, checked by the
        // rest of the name.
        const COMP_THR = 0.6;
        const PRIME_THR = 0.6, esPrime = (n) => /\bPRIME\b/i.test(n);

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
            // The game draws "Ash Prime Systems Blueprint" and the DB stores "Ash Prime Systems": the extra
            // BLUEPRINT counts as covered, or it ties with "Ash Prime Blueprint".
            const siguiente = ocrWords[currentPos + 1]?.replaceAll(/[^A-Z]/g, "");
            if (siguiente && isOptionalWord("BLUEPRINT", item.searchWords.at(-1))
                && this.similarityOCR(siguiente, "BLUEPRINT") >= COMP_THR) {
                matchedIndices.push(currentPos + 1);
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
                    // without this, the optional PRIME matched every normal part to its prime
                    if (esPrime(item.originalName) && !confirmaPrime(textWords, this, PRIME_THR)) continue;
                    // same number of matched words: the best first word similarity wins ("BOLTOR" over "AKBOLTO")
                    const ocrFirst = (matchedIndexOffset
                        ? textWords[i] + textWords[i + 1]
                        : textWords[i]).toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
                    const score = this.similarityOCR(ocrFirst, item.firstWord.toUpperCase());
                    // no component backed the match (see UNCORROBORATED_THR)
                    if (matched.length === 1 && score < UNCORROBORATED_THR) continue;
                    // priority: more OCR words covered, then more components, then first word similarity
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