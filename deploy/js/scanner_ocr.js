import { state } from "./state.js";

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

export async function initOcrWorkers() {
  if (worker1 && worker2 && worker3) return [worker1, worker2, worker3];

  // eslint-disable-next-line no-undef
  const tess = globalThis.Tesseract || Tesseract;

  const initWorker = async () => {
    const w = await tess.createWorker("eng");
    await w.setParameters({
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ",
      tessedit_pageseg_mode: "6", // uniforme text block
      tessedit_ocr_engine_mode: "3", // LSTM
    });
    return w;
  };

  const initBadgeWorker = async () => {
    const w = await tess.createWorker("eng");
    await w.setParameters({
      tessedit_char_whitelist: " 0123456789",
      tessedit_pageseg_mode: "7",
      tessedit_ocr_engine_mode: "3",
    });
    return w;
  };

  // Inicializamos 6 workers en total (3 textos, 3 badges)
  [worker1, worker2, worker3, badgeWorker1, badgeWorker2, badgeWorker3] =
    await Promise.all([
      initWorker(),
      initWorker(),
      initWorker(),
      initBadgeWorker(),
      initBadgeWorker(),
      initBadgeWorker(),
    ]);
  return [worker1, worker2, worker3];
}

export function stopOcrWorkers() {
  if (worker1) { worker1.terminate(); worker1 = null; }
  if (worker2) { worker2.terminate(); worker2 = null; }
  if (worker3) { worker3.terminate(); worker3 = null; }
  if (badgeWorker1) { badgeWorker1.terminate(); badgeWorker1 = null; }
  if (badgeWorker2) { badgeWorker2.terminate(); badgeWorker2 = null; }
  if (badgeWorker3) { badgeWorker3.terminate(); badgeWorker3 = null; }
}

export function getWorkers() {
  return [worker1, worker2, worker3];
}

export function getBadgeWorkers() {
  return [badgeWorker1, badgeWorker2, badgeWorker3];
}

export function initScannerMatcherData() {
  if (!state.itemsDatabase || Object.keys(state.itemsDatabase).length === 0)
    return;
  if (CACHED_DB_ITEMS.length > 0) return;

  const tempParts = new Set();
  [
    "BLUEPRINT",
    "PRIME",
    "CHASSIS",
    "SYSTEMS",
    "NEUROPTICS",
    "HARNESS",
    "WINGS",
    "DUAL",
    "TWIN",
    "DEX",
    "MK1",
    "PRISMA",
    "VANDAL",
    "WRAITH",
    "FORMA",
    "CARAPACE",
    "CEREBRUM",
    "HANDLE",
    "BARREL",
    "RECEIVER",
    "STOCK",
    "LINK",
    "POUCH",
    "STARS",
    "BLADE",
    "HILT",
    "HEAD",
    "MOTOR",
    "GRIP",
    "STRING",
    "LIMB",
  ].forEach((p) => tempParts.add(p));

  const processedItems = [];
  Object.keys(state.itemsDatabase).forEach((itemName) => {
    const upperName = itemName.toUpperCase();
    const normalizedName = upperName
      .replaceAll("&", " ")
      .replaceAll(/[^A-Z0-9 ]/g, " ");
    const words = normalizedName
      .split(/\s+/)
      .filter((w) => w !== "PRIME" && w.length > 0);
    upperName.split(" ").forEach((w) => {
      if (w.length > 2 || w === "BO") tempParts.add(w);
    });
    processedItems.push({
      originalName: itemName,
      searchWords: words,
      firstWord: words[0],
      isPrime: upperName.includes("PRIME"),
    });
  });

  CACHED_DB_ITEMS = processedItems;
  DYNAMIC_KNOWN_PARTS = tempParts;
  const partsArray = Array.from(DYNAMIC_KNOWN_PARTS).sort(
    (a, b) => b.length - a.length,
  );
  DYNAMIC_REGEX = new RegExp(`(${partsArray.join("|")})`, "g");
}

export function getCachedDbItems() {
  return CACHED_DB_ITEMS;
}

export function getDynamicRegex() {
  return DYNAMIC_REGEX;
}

export function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) != s2.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

export function getSimilarity(s1, s2) {
  let longer = s1,
    shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  const longerLength = longer.length;
  if (longerLength === 0) return 1;
  return (
    (longerLength - editDistance(longer, shorter)) /
    Number.parseFloat(longerLength)
  );
}

const PART_WORDS = new Set([
  "CHASSIS",
  "NEUROPTICS",
  "SYSTEMS",
  "BARREL",
  "RECEIVER",
  "STOCK",
  "BLADE",
  "GAUNTLET",
  "GRIP",
  "HANDLE",
  "HEAD",
  "HILT",
  "HARNESS",
  "WINGS",
  "CARAPACE",
  "CEREBRUM",
  "BOOT",
  "DISC",
  "LINK",
  "MOTOR",
  "POUCH",
  "STARS",
  "LOWER",
  "UPPER",
  "LIMB",
  "STRING",
]);

export function findBestItemMatch(combinedText) {
  const matchTokens = [...combinedText];
  for (let i = 0; i < combinedText.length - 1; i++) {
    matchTokens.push(combinedText[i] + combinedText[i + 1]);
  }

  const scoringTokens = matchTokens.filter(
    (t) => t !== "PRIME" && t.length >= 3 && /[A-Z]/.test(t),
  );

  let bestMatch = null;
  let highestRatio = 0;
  const primeItems = CACHED_DB_ITEMS.filter((it) => it.isPrime);

  primeItems.forEach((dbItem) => {
    let score = 0;
    let firstWordMatch = 0;

    dbItem.searchWords.forEach((tw, idx) => {
      let maxS = 0;
      scoringTokens.forEach((cw) => {
        const s = getSimilarity(cw, tw);
        if (s > maxS) maxS = s;
      });
      if (idx === 0) firstWordMatch = maxS;
      score += maxS;
    });

    let ratio = score / dbItem.searchWords.length;

    for (const part of PART_WORDS) {
      const hasFuzzyOcrMatch = scoringTokens.some(
        (t) => getSimilarity(t, part) > 0.75,
      );
      if (hasFuzzyOcrMatch && !dbItem.searchWords.includes(part)) {
        ratio *= 0.3;
        break;
      }
    }

    if (firstWordMatch < 0.45 && dbItem.searchWords.length > 1) ratio *= 0.65;

    if (ratio > highestRatio) {
      highestRatio = ratio;
      bestMatch = dbItem;
    }
  });

  return { bestMatch, highestRatio };
}

export function parseTextForItems(ocrData) {
  if (!ocrData?.words) return [];
  const dbItems = getCachedDbItems();
  const DYNAMIC_REGEX = getDynamicRegex();
  if (dbItems.length === 0) {
    initScannerMatcherData();
    return [];
  }
  let rawWords = [];
  ocrData.words.forEach((w) => {
    let text = w.text
      .toUpperCase()
      .replaceAll("&", " ")
      .replaceAll(/[^A-Z]/g, " ");
    if (DYNAMIC_REGEX) text = text.replaceAll(DYNAMIC_REGEX, " $1 ");
    const splitParts = text
      .split(/\s+/)
      .filter((p) => p.length > 2 || p === "BO");
    splitParts.forEach((part) => {
      rawWords.push({
        text: part,
        x: (w.bbox.x0 + w.bbox.x1) / 2,
        y: (w.bbox.y0 + w.bbox.y1) / 2,
      });
    });
  });
  const ocrWords = rawWords;
  const finalResults = [];
  const usedIndices = new Set();

  function runMatchingPass(lookAheadLimit) {
    for (let i = 0; i < ocrWords.length; i++) {
      if (usedIndices.has(i) || finalResults.length >= 32) continue;

      for (const item of dbItems) {
        if (isFirstWordMatch(ocrWords[i].text, item.firstWord)) {
          const matchedIndices = attemptItemMatch(i, item, lookAheadLimit);
          if (matchedIndices) {
            recordSuccessfulMatch(matchedIndices, item.originalName);
            break;
          }
        }
      }
    }
  }

  function attemptItemMatch(startIndex, item, lookAheadLimit) {
    const matchedIndices = [startIndex];
    let currentPos = startIndex;

    for (let j = 1; j < item.searchWords.length; j++) {
      const targetComp = item.searchWords[j];
      const nextMatch = findNextWordMatch(
        currentPos,
        targetComp,
        lookAheadLimit,
      );

      if (nextMatch === -1) {
        const prevWordDB = item.searchWords[j - 1];
        if (!isOptionalBlueprint(targetComp, prevWordDB)) {
          return null;
        }
      } else {
        matchedIndices.push(nextMatch);
        currentPos = nextMatch;
      }
    }
    return matchedIndices;
  }

  function findNextWordMatch(currentPos, targetComp, lookAheadLimit) {
    for (let dist = 1; dist <= lookAheadLimit; dist++) {
      const nextIdx = currentPos + dist;
      if (nextIdx >= ocrWords.length || usedIndices.has(nextIdx)) continue;

      if (getSimilarity(ocrWords[nextIdx].text, targetComp) > 0.75) {
        return nextIdx;
      }
    }
    return -1;
  }

  function recordSuccessfulMatch(matchedIndices, itemName) {
    const avgX =
      matchedIndices.reduce((sum, idx) => sum + ocrWords[idx].x, 0) /
      matchedIndices.length;
    const avgY =
      matchedIndices.reduce((sum, idx) => sum + ocrWords[idx].y, 0) /
      matchedIndices.length;

    finalResults.push({ name: itemName, xPos: avgX, yPos: avgY });
    matchedIndices.forEach((idx) => usedIndices.add(idx));
  }
  runMatchingPass(3);
  if (finalResults.length < 32) runMatchingPass(8);
  return finalResults;
}
function isOptionalBlueprint(targetComp, prevWordDB) {
  if (targetComp !== "BLUEPRINT") return false;

  const validPredecessors = [
    "NEUROPTICS",
    "SYSTEMS",
    "CHASSIS",
    "HARNESS",
    "WINGS",
    "CARAPACE",
    "CEREBRUM",
    "FORMA",
  ];
  return validPredecessors.includes(prevWordDB);
}
function isFirstWordMatch(ocrText, dbFirstWord) {
  const cleanOCR = ocrText.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const cleanDB = dbFirstWord.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");

  if (cleanOCR === cleanDB) return true;
  if (cleanOCR.length < 3 || cleanDB.length < 3) return cleanOCR === cleanDB;

  const similarityThreshold = dbFirstWord.length <= 3 ? 0.85 : 0.8;
  return getSimilarity(cleanOCR, cleanDB) > similarityThreshold;
}

/**
 * Versión especializada para la pantalla de recompensas.
 * Busca no solo el nombre del ítem, sino también "OWNED", "CRAFTED" y cantidades.
 */
export function parseTextForRewards(ocrData) {
  if (!ocrData?.words) return [];
  console.log("%c >>> MOTOR OCR V5 (FIXED QUANTITY) ACTIVADO <<< ", "background: #222; color: #bada55");
  const dbItems = getCachedDbItems();

  const ocrWords = ocrData.words.map(w => ({
    text: w.text.toUpperCase(),
    x: (w.bbox.x0 + w.bbox.x1) / 2,
    y: (w.bbox.y0 + w.bbox.y1) / 2
  }));

  const itemMatches = [];
  const used = new Set();

  for (let i = 0; i < ocrWords.length; i++) {
    if (used.has(i)) continue;
    for (const dbItem of dbItems) {
      if (isFirstWordMatch(ocrWords[i].text, dbItem.firstWord)) {
        const found = attemptItemMatch(i, dbItem, 2, ocrWords, used);
        if (found) {
          const avgX = found.reduce((s, idx) => s + ocrWords[idx].x, 0) / found.length;
          const avgY = found.reduce((s, idx) => s + ocrWords[idx].y, 0) / found.length;
          itemMatches.push({ name: dbItem.originalName, x: avgX, y: avgY });
          found.forEach(idx => used.add(idx));
          break;
        }
      }
    }
  }

  const metaLabels = [];
  ocrWords.forEach((word, idx) => {
    const oMatch = word.text.match(/([OD0][WNM]NED)/i);
    if (oMatch) {
      // 20wned -> prefix="2" -> qty=2
      const prefix = word.text.substring(0, oMatch.index).trim();
      let qty = (prefix && /\d+/.test(prefix)) ? Number.parseInt(prefix.match(/\d+/)[0]) : 0;

      if (qty === 0) {
        const prev = ocrWords[idx - 1];
        if (prev && /\d+/.test(prev.text) && Math.abs(prev.x - word.x) < 200) {
          qty = Number.parseInt(prev.text.match(/\d+/)[0]);
        } else {
          qty = 1;
        }
      }
      metaLabels.push({ qty, x: word.x, type: 'owned' });
    }
    if (/CRA[FT][FT]ED|GRAFTED/i.test(word.text)) {
      metaLabels.push({ qty: 1, x: word.x, type: 'crafted' });
    }
  });

  return itemMatches.map(item => {
    let bestL = null;
    let minDist = 400;
    let bestIdx = -1;

    metaLabels.forEach((l, lIdx) => {
      const d = Math.abs(l.x - item.x);
      if (d < minDist) { minDist = d; bestL = l; bestIdx = lIdx; }
    });

    if (bestIdx !== -1) metaLabels.splice(bestIdx, 1);

    return {
      name: item.name, xPos: item.x, yPos: item.y,
      owned: (bestL && bestL.type === 'owned') ? bestL.qty : 0,
      crafted: (bestL && bestL.type === 'crafted') ? 1 : 0
    };
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

      if (getSimilarity(ocrWords[nextIdx].text.replaceAll(/[^A-Z]/g, ""), targetComp) > 0.75) {
        matchedIndices.push(nextIdx);
        currentPos = nextIdx;
        found = true;
        break;
      }
    }

    if (!found) {
      if (!isOptionalBlueprint(targetComp, item.searchWords[j - 1])) {
        return null;
      }
    }
  }
  return matchedIndices;
}
