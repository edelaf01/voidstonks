import { getPriceValue } from "./api.js";

let worker1 = null;
let worker2 = null;
let worker3 = null;

// Workers dedicados exclusivamente para Cantidades (números)
let badgeWorker1 = null;
let badgeWorker2 = null;
let badgeWorker3 = null;

let DYNAMIC_KNOWN_PARTS = new Set();
let DYNAMIC_REGEX = null;
let CACHED_DB_ITEMS = [];

const OCR_CORRECTIONS = {
  "IHASSIS": "CHASSIS",
  "HASSIS": "CHASSIS",
  "GHASSIS": "CHASSIS",
  "DHASSIS": "CHASSIS",
  "CHASSS": "CHASSIS",
  "CHASS1S": "CHASSIS",
  "CHASIS": "CHASSIS",
  "BLUEPRIN": "BLUEPRINT",
  "BLUEP": "BLUEPRINT",
  "SYST": "SYSTEMS",
  "NEURO": "NEUROPTICS",
  "RECVR": "RECEIVER"
};

let ocrInitPromise = null;

export async function warmUpOcr() {
  if (ocrInitPromise) return ocrInitPromise;
  ocrInitPromise = (async () => {
    try {
      console.log("[OCR] Calentando motores estables V265...");
      const tess = globalThis.Tesseract || Tesseract;
      const initWorker = async (psm = "6", whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- '") => {
        const w = await tess.createWorker("eng", 1);
        await w.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: psm,
          user_defined_dictionary_priority: "1",
        });
        return w;
      };
      const results = await Promise.all([
        initWorker("6"), initWorker("6"), initWorker("6"),
        initWorker("7", " 0123456789")
      ]);
      [worker1, worker2, worker3, badgeWorker1] = results;
      badgeWorker2 = badgeWorker3 = badgeWorker1;
      return [worker1, worker2, worker3];
    } catch (e) {
      //TODO: Fix this
      ocrInitPromise = null;
      return [];
    }
  })();
  return ocrInitPromise;
}

export async function createIndustrialWorker() {
  const worker = await Tesseract.createWorker("eng");
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:()+- ",
    tessedit_pageseg_mode: "7",
    user_defined_dictionary_priority: "1",
  });
  return worker;
}

export async function initOcrWorkers() {
  if (worker1 && worker2 && worker3) return [worker1, worker2, worker3];
  return warmUpOcr();
}

export async function safeRecognize(worker, image, options = {}) {
  if (!worker || worker.isTerminated) return { data: { text: "", confidence: 0 } };
  try {
    worker.isBusy = true;
    const result = await worker.recognize(image, options);
    worker.isBusy = false;
    return result;
  } catch (e) {
    //TODO: Fix this
    worker.isBusy = false;
    return { data: { text: "", confidence: 0 } };
  }
}

export function stopOcrWorkers() {
  const workers = [worker1, worker2, worker3, badgeWorker1, badgeWorker2, badgeWorker3];
  workers.forEach(w => {
    if (w) {
      w.isTerminated = true;
      setTimeout(() => { try { w.terminate(); } catch (e) { } }, 500);
    }
  });
  worker1 = null; worker2 = null; worker3 = null;
  badgeWorker1 = null; badgeWorker2 = null; badgeWorker3 = null;
  ocrInitPromise = null;
}

export function getWorkers() { return [worker1, worker2, worker3]; }
export function getBadgeWorkers() { return [badgeWorker1, badgeWorker2, badgeWorker3]; }

export function initScannerMatcherData() {
  if (!state.itemsDatabase || Object.keys(state.itemsDatabase).length === 0) return;
  if (CACHED_DB_ITEMS.length > 0) return;
  const tempParts = new Set();
  ["BLUEPRINT", "PRIME", "CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS", "DUAL", "TWIN", "DEX", "MK1", "PRISMA", "VANDAL", "WRAITH", "FORMA", "CARAPACE", "CEREBRUM", "HANDLE", "BARREL", "RECEIVER", "STOCK", "LINK", "POUCH", "STARS", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB"].forEach(p => tempParts.add(p));
  const processedItems = [];
  Object.keys(state.itemsDatabase).forEach((itemName) => {
    const upperName = itemName.toUpperCase();
    const normalizedName = upperName.replaceAll("&", " ").replaceAll(/[^A-Z0-9 ]/g, " ");
    const words = normalizedName.split(/\s+/).filter((w) => w !== "PRIME" && w.length > 0);
    upperName.split(" ").forEach(w => { if (w.length > 2 || w === "BO") tempParts.add(w); });
    processedItems.push({ originalName: itemName, searchWords: words, firstWord: words[0], isPrime: upperName.includes("PRIME"), ducats: state.itemsDatabase[itemName][0].ducats || 0 });
  });
  CACHED_DB_ITEMS = processedItems;
  DYNAMIC_KNOWN_PARTS = tempParts;
  const partsArray = Array.from(DYNAMIC_KNOWN_PARTS).sort((a, b) => b.length - a.length);
  DYNAMIC_REGEX = new RegExp(`(${partsArray.join("|")})`, "g");
}

export function isPerfectDbWord(word) {
  if (!word) return false;
  const upper = word.toUpperCase().replaceAll(/[^A-Z]/g, "");
  return DYNAMIC_KNOWN_PARTS.has(upper) || OCR_CORRECTIONS[upper];
}

export function getCachedDbItems() { return CACHED_DB_ITEMS; }
export function getDynamicRegex() { return DYNAMIC_REGEX; }

export function editDistance(s1, s2) {
  s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
  const costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue; lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

export function getSimilarity(s1, s2) {
  let longer = s1, shorter = s2;
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  if (longer.length === 0) return 1;
  return (longer.length - editDistance(longer, shorter)) / Number.parseFloat(longer.length);
}

export function isOptionalBlueprint(targetComp, prevWordDB) {
  if (targetComp !== "BLUEPRINT") return false;
  return ["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM", "FORMA"].includes(prevWordDB);
}

function isFirstWordMatch(ocrText, dbFirstWord) {
  const cleanOCR = ocrText.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const cleanDB = dbFirstWord.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (cleanOCR === cleanDB) return true;
  if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;
  const similarityThreshold = dbFirstWord.length <= 3 ? 0.8 : 0.75;
  return getSimilarity(cleanOCR, cleanDB) >= similarityThreshold;
}

//TODO: Fix this FUNCTION TOO COMPLEX
export function parseTextForRewards(ocrData) {
  if (!ocrData?.words) return [];
  initScannerMatcherData();
  const dbItems = getCachedDbItems();
  const imgW = ocrData.imageW || 1920;

  const knownTokens = Array.from(DYNAMIC_KNOWN_PARTS);
  const validWords = [];

  ocrData.words.forEach(w => {
    let text = w.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (text.length < 2) return;

    text = OCR_CORRECTIONS[text] || text;

    let matchedToken = null;
    if (knownTokens.includes(text)) {
      matchedToken = text;
    } else {
      for (const token of knownTokens) {
        if (getSimilarity(text, token) >= 0.70) {
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

  const itemMatches = [];

  const MARGIN_LEFT = imgW * 0.04;
  const MARGIN_RIGHT = imgW * 0.18;
  const wfParts = ["CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM"];
  const wpnParts = ["BARREL", "RECEIVER", "STOCK", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB", "LINK", "POUCH", "GUARD", "DISC", "STARS", "BAND", "BOOT"];
  //ANCHORS
  const allFirstTokens = new Set(dbItems.map(item => item.searchWords[0]));
  const globalAnchors = validWords.filter(w => allFirstTokens.has(w.text)).sort((a, b) => a.x - b.x);

  for (const dbItem of dbItems) {
    const searchTokens = dbItem.searchWords;
    if (searchTokens.length === 0) continue;

    const firstToken = searchTokens[0];
    const anchors = validWords.filter(w => w.text === firstToken);

    for (const anchor of anchors) {

      const nextAnchor = globalAnchors.find(a => a.x > anchor.x + (imgW * 0.05));

      let maxRightX = anchor.x + MARGIN_RIGHT;
      if (nextAnchor) {
        maxRightX = Math.min(maxRightX, nextAnchor.x - 1);
      }

      const localWords = validWords.filter(w =>
        w.x >= (anchor.x - MARGIN_LEFT) &&
        w.x <= maxRightX
      );

      const localSoupText = localWords.map(w => w.text).join(" ");

      let matchScore = 1.0;
      let validWordsFound = 1;
      let itemSpecificWpnPartFound = wpnParts.includes(firstToken);

      for (let i = 1; i < searchTokens.length; i++) {
        const token = searchTokens[i];
        if (localWords.some(w => w.text === token)) {
          matchScore += 1;
          validWordsFound++;
          if (wpnParts.includes(token)) itemSpecificWpnPartFound = true;
        } else if (token === "BLUEPRINT" && wfParts.some(p => dbItem.originalName.toUpperCase().includes(p))) {
          matchScore += 0.8;
          validWordsFound++;
        }
      }

      let ratio = matchScore / searchTokens.length;

      // --- MOTOR SEMÁNTICO DE CASTIGOS ---
      const name = dbItem.originalName.toUpperCase();
      const isWarframePart = wfParts.some(p => name.includes(p));
      const isWeaponPart = wpnParts.some(p => name.includes(p));
      const isMainBlueprint = name.endsWith("BLUEPRINT") && !isWarframePart;

      const soupHasBlueprint = localSoupText.includes("BLUEPRINT");
      const soupHasPhysicalWeaponPart = wpnParts.some(p => localSoupText.includes(p));

      if (soupHasPhysicalWeaponPart) {
        if (isMainBlueprint) ratio -= 0.8;
        else if (isWeaponPart && !itemSpecificWpnPartFound) ratio -= 0.5;
      } else if (soupHasBlueprint) {
        if (isWeaponPart) ratio -= 0.6;
      } else {
        if (isMainBlueprint) ratio -= 0.4;
        else if (isWeaponPart && !itemSpecificWpnPartFound) ratio -= 0.3;
      }

      ratio += (validWordsFound * 0.01);

      if (ratio > 0.65 && validWordsFound >= 2) {
        itemMatches.push({
          name: dbItem.originalName,
          ratio: ratio,
          x: anchor.x
        });
      }
    }
  }

  // 3. RESOLUCIÓN DE CONFLICTOS ESPACIALES
  itemMatches.sort((a, b) => b.ratio - a.ratio);
  const finalItems = [];

  for (const match of itemMatches) {
    let conflict = false;
    for (const f of finalItems) {
      if (Math.abs(match.x - f.x) < imgW * 0.10) {
        conflict = true;
        break;
      }
    }
    if (!conflict) finalItems.push(match);
  }

  // 4. Extracción de Metadatos (OWNED) 
  const metaLabels = [];
  ocrData.words.forEach((w, idx) => {
    const text = w.text.toUpperCase();
    const oMatch = text.match(/([OD0][WNM]NED)/i);
    if (oMatch) {
      const prefix = text.substring(0, oMatch.index).trim();
      let qty = (prefix && /\d+/.test(prefix)) ? Number.parseInt(prefix.match(/\d+/)[0]) : 0;
      if (qty === 0) {
        const prev = ocrData.words[idx - 1];
        if (prev && /\d+/.test(prev.text) && Math.abs(((prev.bbox.x0 + prev.bbox.x1) / 2) - ((w.bbox.x0 + w.bbox.x1) / 2)) < 200) {
          qty = Number.parseInt(prev.text.match(/\d+/)[0]) || 1;
        } else { qty = 1; }
      }
      metaLabels.push({ qty, x: (w.bbox.x0 + w.bbox.x1) / 2, type: 'owned' });
    }
  });

  // 5. Ensamblaje Final
  return finalItems.toSorted((a, b) => a.x - b.x).map(item => {
    let bestL = null; let minDist = 300; let bestIdx = -1;
    metaLabels.forEach((l, lIdx) => {
      const d = Math.abs(l.x - item.x);
      if (d < minDist) { minDist = d; bestL = l; bestIdx = lIdx; }
    });
    if (bestIdx !== -1) metaLabels.splice(bestIdx, 1);
    return { name: item.name, xPos: item.x, imgW: imgW, owned: (bestL?.type === 'owned') ? bestL.qty : 0, crafted: 0, confidence: 0.95 };
  });
}
function attemptItemMatch(startIndex, item, lookAheadLimit, ocrWords, usedIndices) {
  const matchedIndices = [startIndex];
  let currentPos = startIndex;
  for (let j = 1; j < item.searchWords.length; j++) {
    const targetComp = item.searchWords[j];
    let found = false;
    for (let dist = 1; dist <= lookAheadLimit; dist++) {
      const nextIdx = currentPos + dist;
      if (nextIdx >= ocrWords.length || usedIndices.has(nextIdx)) continue;
      if (getSimilarity(ocrWords[nextIdx].text.replaceAll(/[^A-Z]/g, ""), targetComp) >= 0.70) {
        matchedIndices.push(nextIdx);
        currentPos = nextIdx;
        found = true;
        break;
      }
    }
    if (!found && !isOptionalBlueprint(targetComp, item.searchWords[j - 1])) return null;
  }
  return matchedIndices;
}

export function findBestItemMatch(text) {
  const tokens = Array.isArray(text) ? text : text.split(/\s+/);
  const wordsForFinder = tokens.map(t => (typeof t === "string" ? { text: t, x: 500 } : t));
  const dbItems = getCachedDbItems();
  for (const item of dbItems) {
    if (isFirstWordMatch(wordsForFinder[0].text, item.firstWord)) {
      const matched = attemptItemMatch(0, item, 4, wordsForFinder, new Set());
      if (matched) return { bestMatch: item, highestRatio: 0.95 };
    }
  }
  return { bestMatch: null, highestRatio: 0 };
}
//TODO Fix this , so it cant be an await otherwise it will block the ui
warmUpOcr();
