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

    RELIC_TIERS: ["LITH", "MESO", "NEO", "AXI", "REQUIEM"],
    // Ruido típico de la UI de selección de reliquia/inventario que no forma parte del código.
    RELIC_NOISE_TOKENS: new Set([
        "RELIC", "RADIANT", "INTACT", "EXCEPTIONAL", "FLAWLESS",
        "RELIQUIA", "RADIANTE", "INTACTA", "EXCEPCIONAL", "IMPECABLE"
    ]),

    // Correcciones letra->dígito típicas del OCR sobre la parte NUMÉRICA de un código.
    _fixRelicDigits(s) {
        return s
            .replaceAll("Z", "2").replaceAll("S", "5").replaceAll("B", "8")
            .replaceAll("G", "6").replaceAll("O", "0").replaceAll(/[IL]/g, "1");
    },

    // Repara los errores típicos de OCR letra<->dígito del código de reliquia
    // (p.ej. "O1" -> "01", o para Requiem el sentido inverso dígito->romano).
    // Factorizado de parseRelicSelection para reutilizarlo también en getRelicMatch.
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

    // Match de reliquia para el flujo del inventario (grid de celdas del escáner de items).
    // A diferencia de parseRelicSelection (texto libre de una sola pantalla), aquí recibimos
    // el array de palabras OCR de UNA celda (mayúsculas), como getValidItemMatch. Localiza el
    // tier (fuzzy, aguanta L1TH/MES0/NE0/AX1), el código pegado o en la palabra siguiente, y
    // devuelve el nombre CANÓNICO tal como figura en state.allRelicNames (no en mayúsculas),
    // para que case con el resto de la app (helpers de inventario, etc.).
    getRelicMatch(combinedText) {
        if (!combinedText) return null;
        const rawWords = Array.isArray(combinedText) ? combinedText : combinedText.split(/\s+/);
        const words = rawWords
            .map(w => (w || "").toString().toUpperCase().replaceAll(/[^A-Z0-9]/g, ""))
            .filter(w => w.length > 0 && !this.RELIC_NOISE_TOKENS.has(w));

        const tiers = this.RELIC_TIERS;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            // Normalizamos los errores típicos dígito->letra SOLO para comparar el tier
            // (NE0->NEO, AX1->AXI...): el fuzzy con umbral 0.75 no tolera 1 error en tiers
            // de 3 letras (2/3 ≈ 0.67), y bajar el umbral colaría basura como "NEC"/"AXL".
            // Los reemplazos son 1:1 (misma longitud), así que los índices del prefijo
            // valen igual sobre la palabra ORIGINAL, de donde sale el remainder del código.
            const tierWord = word
                .replaceAll("0", "O").replaceAll("1", "I")
                .replaceAll("5", "S").replaceAll("8", "B");
            let tier = null;
            let remainder = "";

            // Match exacto o prefijo pegado (p.ej. token único "LITHC1" o "AX1C3")
            for (const t of tiers) {
                if (tierWord === t) { tier = t; break; }
                if (tierWord.length > t.length && tierWord.startsWith(t)) { tier = t; remainder = word.slice(t.length); break; }
            }
            // Fuzzy sobre la palabra normalizada (aguanta L1TH, MES0, NE0, AX1 y erratas de letra)
            if (!tier) {
                for (const t of tiers) {
                    if (this.getSimilarity(tierWord, t) >= 0.75) { tier = t; break; }
                }
            }
            // Último recurso: dígito OCR cuya normalización 1:1 NO da la letra correcta
            // (p.ej. "AX0" -> "AXO": ni prefijo de AXI ni pasa el fuzzy, 2/3 < 0.75).
            // Aceptamos el tier si la palabra ORIGINAL tiene su misma longitud, difiere en
            // UNA posición como máximo, y toda discrepancia es un DÍGITO en la original
            // (= ruido OCR seguro). Una letra discrepante ("NEC") sigue fuera: no bajamos
            // el umbral porque colaría cualquier palabra de 3 letras con 1 error.
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

            // El código: o viene pegado al tier, o es una de las 2 palabras siguientes
            // (tolera un token de ruido intermedio que _normalizeOCRWords ya filtró aquí arriba).
            let codeRaw = remainder;
            if (!codeRaw) {
                for (let j = i + 1; j < Math.min(i + 3, words.length); j++) {
                    const cand = words[j];
                    // El patrón todo-dígitos cubre la LETRA del código leída como dígito
                    // ("11" = I1, "12" = I2): es seguro porque al final SIEMPRE se valida
                    // contra state.allRelicNames — si no existe la reliquia, devuelve null.
                    if (/^[A-Z][0-9]{1,2}$/.test(cand) || /^[IVX]+$/.test(cand) || /^[A-Z][A-Z0-9]$/.test(cand) || /^[0-9][0-9]{1,2}$/.test(cand)) {
                        codeRaw = cand;
                        break;
                    }
                }
            }
            if (!codeRaw) continue;

            const isRequiem = tier === "REQUIEM";
            // A diferencia de parseRelicSelection (que corrige el código entero), aquí el código
            // es letra + 1-2 dígitos: la corrección letra->dígito solo aplica a la parte numérica,
            // o rompería la letra del código (p.ej. "G1" -> "61" y "Neo G1" jamás matchearía).
            // Y al revés: si la LETRA del código llegó como dígito ("11" -> I1), la mapeamos
            // dígito->letra solo en la primera posición.
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
                    // Centro de gravedad X: promedio de la posición de todas las palabras que componen el nombre
                    const matchedWords = localWords.filter(w => searchTokens.includes(w.text));
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

    _calculateMatchRatio(dbItem, localSoupText, localWords) {
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
        const soupHasWfPart = wfParts.some(p => localSoupText.includes(p) || localWords.some(w => this.getSimilarity(w.text, p) > 0.7));

        if (wpnParts.some(p => localSoupText.includes(p))) {
            if (isMainBlueprint) ratio -= 0.8;
        } else if (soupHasWfPart) {
            if (isMainBlueprint) ratio -= 0.6;
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

        const isOptionalBlueprint = (targetComp, prevWordDB) => {
            if (targetComp !== "BLUEPRINT") return false;
            return ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM", "FORMA"].includes(prevWordDB);
        };

        const isFirstWordMatch = (ocrStr, dbFirstWord) => {
            const cleanOCR = ocrStr.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            const cleanDB = dbFirstWord.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
            if (cleanOCR === cleanDB) return true;
            
            // Robust custom mapping for "BO" (Bo Prime items) which Tesseract commonly misreads as 3E, 36, AO, 8O, SO, etc.
            if (cleanDB === "BO" && ["3E", "30", "36", "3B", "3b", "86", "8b", "80", "8O", "SO", "AO", "DO", "CO", "B0", "O0"].includes(cleanOCR)) {
                return true;
            }

            // Robust custom mapping for "DAKRA" misread as "DALIA" / "DAKLA" due to letter merges
            if (cleanDB === "DAKRA" && ["DALIA", "DAKLA", "DACRA", "DARRA", "DATRA"].includes(cleanOCR)) {
                return true;
            }

            // Robust custom mapping for "HYDROID" misread as "DROID" due to border crops
            if (cleanDB === "HYDROID" && cleanOCR === "DROID") {
                return true;
            }

            // Robust custom mapping for "FANG" misread as ZANC, FANC, ZANG, EANG, ANC due to stylization
            if (cleanDB === "FANG" && ["ZANC", "FANC", "ZANG", "EANG", "ANG", "ANC"].includes(cleanOCR)) {
                return true;
            }

            // Robust custom mapping for "AFURIS" misread as "AFUNS" due to letter merges (ri -> n)
            if (cleanDB === "AFURIS" && ["AFUNS", "AFUNIS", "AFUR1S", "AFUN1S"].includes(cleanOCR)) {
                return true;
            }

            if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;
            const similarityThreshold = dbFirstWord.length <= 3 ? 0.8 : 0.70;
            return this.getSimilarity(cleanOCR, cleanDB) >= similarityThreshold;
        };

        const normalizeComponent = (word, targetComp) => {
            const w = word.toUpperCase();
            const t = targetComp.toUpperCase();
            if (t === "RECEIVER" && /^(KEC|REC|CELV|RES)/i.test(w) && (w.includes("VE") || w.includes("IV"))) return "RECEIVER";
            if (t === "HANDLE" && /^(FAN|HAN|AN)/i.test(w) && w.includes("LE")) return "HANDLE";
            if (t === "BLUEPRINT" && /^(BLU|BLA|B1U|3LU)/i.test(w) && (w.includes("INT") || w.includes("INI") || w.includes("EPR"))) return "BLUEPRINT";
            if (t === "NEUROPTICS" && /^(NEU|NEPT)/i.test(w) && w.includes("TICS")) return "NEUROPTICS";
            if (t === "GAUNTLET" && (w === "ES" || w === "RES" || w === "ON" || w === "RESON" || w === "AR" || w === "AS" || w === "ER" || w === "RE" || /^(GAU|GNT|AN|RES)/i.test(w) || w.endsWith("ON"))) return "GAUNTLET";
            // "LIMB" (Ballistica/Paris/Cernos Upper/Lower Limb) suele llegar recortado o
            // estilizado: LY, LIY, LMB (L1MB sin dígitos), LIME, LIMS, UMB... Solo palabras
            // cortas que empiezan por L+I/Y/M (o colas UMB/IMB/MB); LINK se excluye explícitamente.
            if (t === "LIMB" && w.length <= 5 && w !== "LINK" && (/^L[IYM]/.test(w) || ["UMB", "IMB", "MB"].includes(w))) return "LIMB";
            return w;
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

                    const cleanWord = ocrWords[nextIdx].replaceAll(/[^A-Z]/g, "");
                    const normWord = normalizeComponent(cleanWord, targetComp);

                    let combinedWord = cleanWord;
                    if (nextIdx + 1 < ocrWords.length) {
                        combinedWord += ocrWords[nextIdx + 1].replaceAll(/[^A-Z]/g, "");
                    }
                    const normCombined = normalizeComponent(combinedWord, targetComp);

                    if (this.getSimilarity(normWord, targetComp) >= 0.70) {
                        matchedIndices.push(nextIdx);
                        currentPos = nextIdx;
                        found = true;
                        break;
                    } else if (this.getSimilarity(normCombined, targetComp) >= 0.70) {
                        matchedIndices.push(nextIdx);
                        matchedIndices.push(nextIdx + 1);
                        currentPos = nextIdx + 1;
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