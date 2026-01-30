import { state } from "./state.js";
import { getPriceValue, getSlug } from "./api.js";
import { showToast } from "./ui.js";

const DEBUG_MODE = false;

let liveStream = null;
let scanInterval = null;
let isScanning = false;
let worker = null;
let isStartingSession = false;
let detectionLocked = false;
let autoCloseTimer = null;
const AUTO_CLOSE_DELAY_MS = 12000;
const SCAN_RATE_MS = 2500;

let virtualCanvas = null;
let vCtx = null;
let snapshotCanvas = null;
let snapshotCtx = null;
const priceCache = new Map();

let DYNAMIC_KNOWN_PARTS = new Set();
let DYNAMIC_REGEX = null;
let CACHED_DB_ITEMS = [];

function logDebug(...args) {
  if (DEBUG_MODE) console.log(" [DEBUG]:", ...args);
}

function initScannerData() {
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
    const normalizedName = upperName.replaceAll("&", " ").replaceAll(/[^A-Z0-9 ]/g, " ");
    const words = normalizedName.split(/\s+/).filter((w) => w !== "PRIME" && w.length > 0);

    upperName.split(" ").forEach((w) => {
      if (w.length > 2 || w === "BO") {
        tempParts.add(w);
      }
    });

    processedItems.push({
      originalName: itemName,
      searchWords: words,
      firstWord: words[0],
    });
  });

  CACHED_DB_ITEMS = processedItems;
  DYNAMIC_KNOWN_PARTS = tempParts;

  const partsArray = Array.from(DYNAMIC_KNOWN_PARTS).sort(
    (a, b) => b.length - a.length,
  );
  DYNAMIC_REGEX = new RegExp(`(${partsArray.join("|")})`, "g");
}

function getSimilarity(s1, s2) {
  let longer = s1;
  let shorter = s2;
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

function editDistance(s1, s2) {
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

export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;

  detectionLocked = false;
  isScanning = false;

  initScannerData();

  const video = document.getElementById("live-video");
  const toggleBtn = document.getElementById("scanner-toggle");

  if (toggleBtn) {
    toggleBtn.classList.add("active");
    toggleBtn.querySelector(".label").innerText = "INICIANDO...";
  }

  try {
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "never",
        displaySurface: "window",
        frameRate: { ideal: 1, max: 5 },
      },
      audio: false,
    });

    video.srcObject = liveStream;
    await video.play();

    if (!virtualCanvas) {
      virtualCanvas = document.createElement("canvas");
      vCtx = virtualCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!snapshotCanvas) {
      snapshotCanvas = document.createElement("canvas");
      snapshotCtx = snapshotCanvas.getContext("2d");
    }

    if (!worker && globalThis.Tesseract) {
      worker = await Tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz- ",
        tessedit_pageseg_mode: "11", // SPARSE_TEXT
      });
    }

    startLoop();
    showToast("Escáner Activo (Auto-Close 12s)");
    if (toggleBtn)
      toggleBtn.querySelector(".label").innerText = "ESCANER ACTIVO";

    liveStream.getVideoTracks()[0].onended = () => stopLiveSession();
  } catch (e) {
    console.error(e);
    stopLiveSession();
  } finally {
    isStartingSession = false;
  }
}

export function stopLiveSession() {
  if (scanInterval) clearInterval(scanInterval);
  if (autoCloseTimer) clearTimeout(autoCloseTimer);

  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }

  if (worker) {
    worker.terminate();
    worker = null;
    if (DEBUG_MODE) console.log(" [DEBUG]: Tesseract Worker terminated.");
  }

  isScanning = false;
  detectionLocked = false;
  isStartingSession = false;

  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.remove("active");
    const label = toggleBtn.querySelector(".label");
    if (label) label.innerText = "LIVE RELIC SCANNER";
  }
}

function startLoop() {
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(async () => {
    const modal = document.getElementById("scan-success-modal");

    const isModalVisible = modal && !modal.classList.contains("hidden");

    if (isModalVisible) {
      detectionLocked = true;
      return;
    } else {
      detectionLocked = false;
    }

    if (isScanning) return;

    await processFrame();
  }, SCAN_RATE_MS);

  priceCache.clear();
}

async function processFrame() {
  isScanning = true;
  const video = document.getElementById("live-video");

  if (!video || video.videoWidth < 10) {
    isScanning = false;
    return;
  }

  const refHeight = 1080;
  const scale = refHeight / video.videoHeight;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const cropY = Math.floor(height * 0.38);
  const cropH = Math.floor(height * 0.18);

  const targetW = Math.floor(width * scale) * 1.5;
  const targetH = Math.floor(cropH * scale) * 1.5;

  if (virtualCanvas.width !== targetW || virtualCanvas.height !== targetH) {
    virtualCanvas.width = targetW;
    virtualCanvas.height = targetH;
  }

  vCtx.filter = "brightness(1.2) contrast(300%) grayscale(100%)";
  vCtx.drawImage(video, 0, cropY, width, cropH, 0, 0, targetW, targetH);
  vCtx.filter = "none";

  try {
    const { data } = await worker.recognize(virtualCanvas);
    if (DEBUG_MODE) console.log("OCR RAW:", data.text);

    const foundItems = parseTextForItems(data);

    let isValidScan = false;

    if (foundItems.length >= 2) {
      isValidScan = true;
    } else if (foundItems.length === 1) {
      if (foundItems[0].name.length > 8) isValidScan = true;
    }

    if (isValidScan && !detectionLocked) {
      handleSuccessfulScan(video, width, height, foundItems);
    }
  } catch (e) {
    console.error("OCR Error:", e);
  }

  isScanning = false;
}

function handleSuccessfulScan(video, width, height, foundItems) {
  detectionLocked = true;
  if (!snapshotCanvas) {
    snapshotCanvas = document.createElement("canvas");
    snapshotCtx = snapshotCanvas.getContext("2d");
  }
  snapshotCanvas.width = width;
  snapshotCanvas.height = height;
  snapshotCtx.drawImage(video, 0, 0, width, height);
  openScanModal(snapshotCanvas.toDataURL("image/jpeg", 0.85), foundItems);
}

function parseTextForItems(ocrData) {
  if (!ocrData?.words || !state.itemsDatabase) return [];
  if (CACHED_DB_ITEMS.length === 0) initScannerData();

  let rawWords = [];

  ocrData.words.forEach((w) => {
    let text = w.text.toUpperCase().replaceAll("&", " ").replaceAll(/[^A-Z]/g, " ");

    if (DYNAMIC_REGEX) text = text.replaceAll(DYNAMIC_REGEX, " $1 ");

    const splitParts = text.split(/\s+/).filter((p) => p.length > 2 || p === "BO");
    splitParts.forEach((part) => {
      rawWords.push({ text: part, x: (w.bbox.x0 + w.bbox.x1) / 2 });
    });
  });

  const ocrWords = rawWords.filter(
    (wordObj) => getSimilarity(wordObj.text, "PRIME") <= 0.75,
  );

  const dbItems = CACHED_DB_ITEMS;
  const finalResults = [];
  const usedIndices = new Set();

  function runMatchingPass(lookAheadLimit) {
    for (let i = 0; i < ocrWords.length; i++) {
      if (usedIndices.has(i) || finalResults.length >= 4) continue;

      for (const item of dbItems) {
        const firstWordDB = item.firstWord;

        const similarityThreshold = firstWordDB.length <= 3 ? 0.9 : 0.85;

        if (
          getSimilarity(ocrWords[i].text, firstWordDB) > similarityThreshold
        ) {
          let matchedIndices = [i];
          let currentPos = i;
          let possibleMatch = true;

          for (let j = 1; j < item.searchWords.length; j++) {
            let foundNext = false;
            const targetComp = item.searchWords[j];

            for (let dist = 1; dist <= lookAheadLimit; dist++) {
              const nextIdx = currentPos + dist;
              if (nextIdx >= ocrWords.length || usedIndices.has(nextIdx))
                continue;

              const isStartOfAnotherItem = dbItems.some((d) => {
                const threshold = d.firstWord.length <= 3 ? 0.9 : 0.85;
                return (
                  getSimilarity(ocrWords[nextIdx].text, d.firstWord) > threshold
                );
              });
              if (isStartOfAnotherItem) break;

              if (targetComp === "BLUEPRINT") {
                const currentWord = ocrWords[nextIdx].text;
                if (
                  DYNAMIC_KNOWN_PARTS.has(currentWord) &&
                  currentWord !== "BLUEPRINT" &&
                  currentWord !== "FORMA"
                ) {
                  possibleMatch = false;
                  break;
                }
              }

              if (getSimilarity(ocrWords[nextIdx].text, targetComp) > 0.75) {
                matchedIndices.push(nextIdx);
                currentPos = nextIdx;
                foundNext = true;
                break;
              }
            }

            if (!possibleMatch) break;

            if (!foundNext) {
              if (targetComp === "BLUEPRINT") {
                const prevWordDB = item.searchWords[j - 1];
                const allowedImplicit = [
                  "NEUROPTICS",
                  "SYSTEMS",
                  "CHASSIS",
                  "HARNESS",
                  "WINGS",
                  "CARAPACE",
                  "CEREBRUM",
                  "FORMA",
                ];
                if (allowedImplicit.includes(prevWordDB)) {
                  foundNext = true;
                } else {
                  possibleMatch = false;
                  break;
                }
              } else {
                possibleMatch = false;
                break;
              }
            }
          }

          if (possibleMatch) {
            const avgX =
              matchedIndices.reduce((sum, idx) => sum + ocrWords[idx].x, 0) /
              matchedIndices.length;
            finalResults.push({ name: item.originalName, xPos: avgX });
            matchedIndices.forEach((idx) => usedIndices.add(idx));
            break;
          }
        }
      }
    }
  }

  runMatchingPass(3);
  if (finalResults.length < 4) runMatchingPass(8);

  finalResults.sort((a, b) => a.xPos - b.xPos);
  return finalResults;
}

async function openScanModal(imageUrl, items) {
  const modal = document.getElementById("scan-success-modal");
  const imgEl = document.getElementById("scan-snapshot");
  const badgesContainer = document.getElementById("scan-badges-container");

  if (!modal || !imgEl || !badgesContainer) return;

  if (autoCloseTimer) clearTimeout(autoCloseTimer);

  badgesContainer.innerHTML = "";
  imgEl.src = imageUrl;
  modal.classList.remove("hidden");

  autoCloseTimer = setTimeout(() => {
    globalThis.closeScanModal();
  }, AUTO_CLOSE_DELAY_MS);

  const itemsWithDetails = await Promise.all(
    items.map(async (item) => {
      let price = priceCache.get(item.name) || 0;
      if (price === 0) {
        try {
          const slug = getSlug(item.name);
          price = await getPriceValue(item.name, slug);
          if (price > 0) priceCache.set(item.name, price);
        } catch (e) {
          console.error(e);
        }
      }

      // Get ducats from database
      let ducats = 0;
      if (state.ducatsDatabase) {
        // Match by name in database
        const itemData = Object.values(state.ducatsDatabase).find(d =>
          d.name.toUpperCase() === item.name.toUpperCase()
        );
        if (itemData) ducats = itemData.ducats;
      }

      if (DEBUG_MODE) console.log(`[SCANNER]: ${item.name} -> ${ducats} DUC`);

      return { ...item, price, ducats };
    }),
  );

  const maxPl = Math.max(...itemsWithDetails.map((i) => i.price));
  const maxDuc = Math.max(...itemsWithDetails.map((i) => i.ducats));

  requestAnimationFrame(() => {
    const cvsHeight = virtualCanvas ? virtualCanvas.height : 100;
    const cvsWidth = virtualCanvas ? virtualCanvas.width : 1000;

    itemsWithDetails.forEach((item) => {
      const isBestPl = item.price > 0 && item.price === maxPl;
      const isBestDuc = item.ducats > 0 && item.ducats === maxDuc;

      const leftPercent = (item.xPos / cvsWidth) * 100;
      // Position badge just below the detected item box
      const topPercent = ((item.yPos + 35) / cvsHeight) * 100;

      createModalBadge(
        item.name,
        item.price,
        item.ducats,
        badgesContainer,
        leftPercent,
        topPercent,
        isBestPl,
        isBestDuc
      );
    });
  });
}

function createModalBadge(
  name,
  price,
  ducats,
  container,
  leftPercent,
  topPercent,
  isBestPl,
  isBestDuc
) {
  const badge = document.createElement("div");
  badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestDuc ? "best-duc" : ""
    }`;

  // Clamp left position to prevent clipping at edges (8% - 92%)
  const clampedLeft = Math.max(8, Math.min(92, leftPercent));
  badge.style.left = `${clampedLeft}%`;
  badge.style.top = `${Math.min(90, topPercent)}%`;

  const slug = getSlug(name);
  const marketUrl = `https://warframe.market/items/${slug}`;

  const cleanName = name
    .replaceAll(/PRIME/gi, "")
    .replaceAll(/BLUEPRINT/gi, "BP")
    .replaceAll(/NEUROPTICS/gi, "NEURO")
    .replaceAll(/SYSTEMS/gi, "SYS")
    .replaceAll(/CHASSIS/gi, "CHAS")
    .trim();

  const escapedName = cleanName.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));

  badge.innerHTML = `
    <a href="${marketUrl.replace(/"/g, "&quot;")}" target="_blank" class="modal-badge-link" style="display:block; text-decoration:none;">
        <div class="modal-badge-name" style="font-size:10px; color:#aaa; font-weight:bold; margin-bottom:4px; text-transform:uppercase;">${escapedName}</div>
        <div class="modal-badge-row" style="display:flex; justify-content:center; align-items:center; gap:10px; font-weight:bold;">
            <div class="modal-badge-price" style="display:flex; align-items:center; gap:2px; font-size:14px; color:#f1c40f;">
                <img src="https://warframe.market/static/assets/common/platinum.png" style="width:14px; height:14px;">
                ${price > 0 ? price : "--"}
            </div>
            ${ducats > 0
      ? `<div class="modal-badge-ducats" style="display:flex; align-items:center; gap:3px; font-size:13px; color:#D4AF37;">
                  <span style="background:#D4AF37; color:#000; width:14px; height:14px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:900;">D</span>
                  ${ducats}
                </div>`
      : ""
    }
        </div>
        <div style="margin-top:4px; display:flex; flex-direction:column; gap:2px;">
          ${isBestPl ? '<div style="background:#f1c40f; color:#000; font-size:8px; font-weight:900; padding:1px 4px; border-radius:2px; display:inline-block; align-self:center;">MOST VALUABLE</div>' : ""}
          ${isBestDuc ? '<div style="background:#D4AF37; color:#000; font-size:8px; font-weight:900; padding:1px 4px; border-radius:2px; display:inline-block; align-self:center;">BEST DUCATS</div>' : ""}
        </div>
    </a>`;

  container.appendChild(badge);
}

globalThis.startLiveSession = startLiveSession;
globalThis.stopLiveSession = stopLiveSession;
globalThis.closeScanModal = function () {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  document.getElementById("scan-success-modal").classList.add("hidden");
  detectionLocked = false;
};
