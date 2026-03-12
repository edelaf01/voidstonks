import { state } from "./state.js";
import { getPriceValue, getSlug } from "./api.js";
import { showToast } from "./ui.js";
import { TEXTS } from "./config.js";

let DEBUG_MODE = false;
globalThis.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  const btn = document.getElementById('btn-debug-toggle');
  if (btn) btn.classList.toggle('active', DEBUG_MODE);
  const dbgPanel = document.getElementById('live-debug-snapshot');
  if (dbgPanel) dbgPanel.style.display = DEBUG_MODE ? 'block' : 'none';
  showToast(DEBUG_MODE ? 'Debug mode ON' : 'Debug mode OFF');
};


let liveStream = null;
let scanInterval = null;
let isScanning = false;
let worker1 = null;
let worker2 = null;
let worker3 = null;
let isStartingSession = false;
let detectionLocked = false;
let autoCloseTimer = null;
const AUTO_CLOSE_DELAY_MS = 12000;
let currentScanRate = 1200;
const FAST_SCAN_RATE = 600;
const SLOW_SCAN_RATE = 1500;
const INV_SCAN_RATE = 2000;

let virtualCanvas = null;
let vCtx = null;
let snapshotCanvas = null;
let snapshotCtx = null;
const priceCache = new Map();

let lastTrackedRelic = "";
let trackingDebounce = 0;
let scanCounter = 0;

let DYNAMIC_KNOWN_PARTS = new Set();
let DYNAMIC_REGEX = null;
let CACHED_DB_ITEMS = [];

let sessionInventory = new Map();
let isInventoryMode = false;
let _preSessionItemNames = new Set(); // snapshot of known names BEFORE a scan run


let debugLogArchive = [];
function logDebug(...args) {
  if (DEBUG_MODE) {
    console.log(" [DEBUG]:", ...args);
    debugLogArchive.push(`[${new Date().toLocaleTimeString()}] ` + args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" "));
    if (debugLogArchive.length > 500) debugLogArchive.shift();
  }
}

let lastStableImageHash = null;
function getFrameHash(ctx, w, h) {
  // Sample 8x8 grid for a fast "perceptual" hash
  const data = ctx.getImageData(0, 0, w, h).data;
  let hash = 0;
  for (let i = 0; i < data.length; i += Math.floor(data.length / 64)) {
    hash += data[i];
  }
  return hash;
}

function initScannerData() {
  if (!state.itemsDatabase || Object.keys(state.itemsDatabase).length === 0) return;
  if (CACHED_DB_ITEMS.length > 0) return;

  const tempParts = new Set();
  [
    "BLUEPRINT", "PRIME", "CHASSIS", "SYSTEMS", "NEUROPTICS", "HARNESS", "WINGS",
    "DUAL", "TWIN", "DEX", "MK1", "PRISMA", "VANDAL", "WRAITH", "FORMA",
    "CARAPACE", "CEREBRUM", "HANDLE", "BARREL", "RECEIVER", "STOCK", "LINK",
    "POUCH", "STARS", "BLADE", "HILT", "HEAD", "MOTOR", "GRIP", "STRING", "LIMB",
  ].forEach((p) => tempParts.add(p));

  const processedItems = [];
  Object.keys(state.itemsDatabase).forEach((itemName) => {
    const upperName = itemName.toUpperCase();
    const normalizedName = upperName.replaceAll("&", " ").replaceAll(/[^A-Z0-9 ]/g, " ");
    const words = normalizedName.split(/\s+/).filter((w) => w !== "PRIME" && w.length > 0);
    upperName.split(" ").forEach((w) => {
      if (w.length > 2 || w === "BO") tempParts.add(w);
    });
    processedItems.push({
      originalName: itemName,
      searchWords: words,
      firstWord: words[0],
      isPrime: upperName.includes("PRIME")
    });
  });

  CACHED_DB_ITEMS = processedItems;
  DYNAMIC_KNOWN_PARTS = tempParts;
  const partsArray = Array.from(DYNAMIC_KNOWN_PARTS).sort((a, b) => b.length - a.length);
  DYNAMIC_REGEX = new RegExp(`(${partsArray.join("|")})`, "g");
}

function getSimilarity(s1, s2) {
  let longer = s1, shorter = s2;
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  const longerLength = longer.length;
  if (longerLength === 0) return 1;
  return (longerLength - editDistance(longer, shorter)) / Number.parseFloat(longerLength);
}

function getRequiredCountLocal(setName, partName) {
  const manifest = state.primeManifest || [];
  const item = manifest.find((i) => i.name === setName);
  if (!item || !item.components) return 1;

  let cleanPart = partName === setName ? "Blueprint" : partName.replace(setName, "").trim();
  if (cleanPart.endsWith(" Blueprint")) cleanPart = cleanPart.replace(" Blueprint", "").trim();

  const comp = item.components.find((c) =>
    c.name === cleanPart ||
    (c.name + " Blueprint") === cleanPart ||
    (setName + " " + c.name) === partName
  );
  return comp ? comp.itemCount : 1;
}

function checkAndPromoteSets() {
  const inv = state.primeInventory;
  if (!inv) return;

  const allSetNames = Object.keys(state.itemsDatabase).filter(n => n.endsWith(" Set"));

  allSetNames.forEach(setName => {
    const baseName = setName.replace(" Set", "");
    const parts = Object.keys(state.itemsDatabase).filter(n =>
      (n === baseName || n.startsWith(baseName + " ")) &&
      n !== setName
    );

    if (parts.length < 2) return;

    let canComplete = true;
    let minSets = Infinity;

    parts.forEach(part => {
      const required = getRequiredCountLocal(baseName, part);
      const owned = inv[part] || 0;
      const possible = Math.floor(owned / required);
      if (possible < 1) canComplete = false;
      if (possible < minSets) minSets = possible;
    });

    if (canComplete && minSets > 0) {
      logDebug(`SET COMPLETED: Promoting parts to ${setName} x${minSets}`);
      parts.forEach(part => {
        const required = getRequiredCountLocal(baseName, part);
        inv[part] -= (required * minSets);
        if (inv[part] <= 0) delete inv[part];
      });
      inv[setName] = (inv[setName] || 0) + minSets;
    }
  });
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
  const costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) != s2.charAt(j - 1))
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue; lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;
  detectionLocked = false; isScanning = false;
  lastTrackedRelic = "";
  trackingDebounce = 0;
  sessionInventory.clear();
  isInventoryMode = false;
  initScannerData();
  const video = document.getElementById("live-video");
  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.add("active");
    toggleBtn.querySelector(".label").innerText = TEXTS[state.currentLang].scanner.starting;
  }
  try {
    logDebug("Requesting display media...");
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", displaySurface: "window", frameRate: { ideal: 10, max: 15 } },
      audio: false,
    });

    logDebug("Media stream active:", liveStream.active);
    video.srcObject = liveStream;
    await video.play();

    const drawer = document.getElementById("scanner-drawer");
    if (drawer) {
      logDebug("Opening scanner drawer");
      drawer.classList.remove("closed");
      drawer.classList.add("open");
    }

    if (!virtualCanvas) {
      virtualCanvas = document.createElement("canvas");
      vCtx = virtualCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!snapshotCanvas) {
      snapshotCanvas = document.createElement("canvas");
      snapshotCtx = snapshotCanvas.getContext("2d");
    }

    if (!worker1 && (globalThis.Tesseract || typeof Tesseract !== "undefined")) {
      logDebug("Initializing Triple Tesseract workers...");
      const tess = globalThis.Tesseract || Tesseract;

      const initWorker = async () => {
        const w = await tess.createWorker("eng");
        await w.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-:/() ",
          tessedit_pageseg_mode: "11",
        });
        return w;
      };

      [worker1, worker2, worker3] = await Promise.all([initWorker(), initWorker(), initWorker()]);
      logDebug("Triple Workers ready");
    }

    if (!worker1) throw new Error("Tesseract workers not available");

    setTimeout(() => {
      logDebug("Starting scan loop...");
      startLoop();
    }, 1000);

    showToast(TEXTS[state.currentLang].scanner.toastActive);
    if (toggleBtn) toggleBtn.querySelector(".label").innerText = TEXTS[state.currentLang].scanner.active;
    liveStream.getVideoTracks()[0].onended = () => {
      logDebug("Stream track ended");
      stopLiveSession();
    };
  } catch (e) {
    console.error("Scanner startup failed:", e);
    showToast("Error: " + e.message);
    stopLiveSession();
  } finally { isStartingSession = false; }
}

export function stopLiveSession() {
  if (scanInterval) clearTimeout(scanInterval);
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  if (liveStream) { liveStream.getTracks().forEach((track) => track.stop()); liveStream = null; }
  if (worker1) { worker1.terminate(); worker1 = null; }
  if (worker2) { worker2.terminate(); worker2 = null; }
  if (worker3) { worker3.terminate(); worker3 = null; }
  isScanning = false; detectionLocked = false; isStartingSession = false;
  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.remove("active");
    const label = toggleBtn.querySelector(".label");
    if (label) label.innerText = "LIVE RELIC SCANNER";
  }
  const drawer = document.getElementById("scanner-drawer");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.classList.add("closed");
  }
  document.getElementById("inv-hud")?.style && (document.getElementById("inv-hud").style.display = "none");
}

function startLoop() {
  if (scanInterval) clearTimeout(scanInterval);
  const loop = async () => {
    if (!liveStream?.active) return;
    const modal = document.getElementById("scan-success-modal");
    if (modal && !modal.classList.contains("hidden")) {
      detectionLocked = true;
      scanInterval = setTimeout(loop, 1000);
      return;
    }
    detectionLocked = false;
    if (!isScanning) await processFrame();

    const delay = isInventoryMode ? 2000 : currentScanRate;
    scanInterval = setTimeout(loop, delay);
  };
  loop();
  priceCache.clear();
}

async function processFrame() {
  if (isScanning) return;
  isScanning = true;
  scanCounter++;
  const video = document.getElementById("live-video");
  if (!video || video.videoWidth < 10) { isScanning = false; return; }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = 1080 / height;

  const hCropH = Math.floor(height * 0.15);
  virtualCanvas.width = Math.floor(width * scale);
  virtualCanvas.height = Math.floor(hCropH * scale);
  if (!vCtx) vCtx = virtualCanvas.getContext("2d");

  vCtx.filter = "grayscale(100%) brightness(1.3) contrast(200%)";
  vCtx.drawImage(video, 0, 0, width, hCropH, 0, 0, virtualCanvas.width, virtualCanvas.height);

  // Check for stability if in inventory mode
  if (isInventoryMode) {
    const currentHash = getFrameHash(vCtx, virtualCanvas.width, virtualCanvas.height);
    if (lastStableImageHash !== null && Math.abs(currentHash - lastStableImageHash) < 50) {
      // Screen hasn't changed enough to warrant a new heavy OCR scan
      isScanning = false;
      return;
    }
    lastStableImageHash = currentHash;
  }

  try {
    logDebug(`Processing frame ${scanCounter}...`);
    const { data: headerData } = await worker1.recognize(virtualCanvas);
    const headerText = headerData.text.toUpperCase();
    logDebug("Header OCR:", headerText);

    const hasRelic = /RELI|ELIC/.test(headerText);
    const hasRefinement = /REFI|NEME/.test(headerText);
    const hasInventory = /INVEN|TORY|SELL/.test(headerText);
    // Robust detection: Catch misreads like 'FISSIRE' or 'EEVIEDS'
    const hasReward = /REWA|WARD|FISSU|FISSI|VOID/.test(headerText);

    if (hasInventory) {
      const sh = TEXTS[state.currentLang].scannerHUD;
      isInventoryMode = true;
      currentScanRate = INV_SCAN_RATE;
      const hud = document.getElementById("inv-hud");
      if (hud) hud.style.display = "block";
      const badge = document.getElementById("hud-context-badge");
      if (badge) {
        badge.textContent = sh.statusInventory;
        badge.style.color = "#f1c40f";
        badge.style.borderColor = "rgba(241,196,15,0.4)";
        badge.style.background = "rgba(241,196,15,0.1)";
      }
      const msgEl = document.getElementById("live-inv-msg");
      if (msgEl) msgEl.innerText = sh.statusIdle === "IDLE" ? "READY" : "LISTO";
    } else if (hasRelic || hasRefinement) {
      const sh = TEXTS[state.currentLang].scannerHUD;
      isInventoryMode = false;
      currentScanRate = FAST_SCAN_RATE;
      const hud = document.getElementById("inv-hud");
      if (hud) hud.style.display = "none";
      const badge = document.getElementById("hud-context-badge");
      if (badge) {
        badge.textContent = sh.statusRelics;
        badge.style.color = "#00e5ff";
        badge.style.borderColor = "rgba(0,229,255,0.3)";
        badge.style.background = "rgba(0,229,255,0.1)";
      }
      await processRelicSelection(video, width, height, scale);
    } else if (hasReward && !isInventoryMode) {
      const sh = TEXTS[state.currentLang].scannerHUD;
      isInventoryMode = false;
      currentScanRate = SLOW_SCAN_RATE;
      const hud = document.getElementById("inv-hud");
      if (hud) hud.style.display = "none";
      const badge = document.getElementById("hud-context-badge");
      if (badge) {
        badge.textContent = sh.statusReward;
        badge.style.color = "#a0ff80";
        badge.style.borderColor = "rgba(160,255,128,0.3)";
        badge.style.background = "rgba(160,255,128,0.08)";
      }
      await processRewards(video, width, height, scale);
    } else {
      currentScanRate = 800;
      // Don't hide the HUD if it's already open
    }
    const counter = document.getElementById("hud-scan-counter");
    if (counter) counter.textContent = `FRAME ${scanCounter}`;
  } catch (e) {
    console.warn("OCR Error", e);
  } finally {
    isScanning = false;
  }
}

async function processInventoryGrid(snapshot, width, height, scale) {
  // --- CALIBRATION INTERCEPT ---
  if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
    logDebug("No Grid Calibration found. Pausing for user calibration.");
    const calibCvs = document.createElement("canvas");
    calibCvs.width = width; calibCvs.height = height;
    const calibCtx = calibCvs.getContext("2d");
    calibCtx.drawImage(snapshot, 0, 0);
    await globalThis.LiveCalibration.runCalibrationFlow(calibCtx.getImageData(0, 0, width, height));
    return null;
  }

  const grid = globalThis.LiveCalibration?.getGrid();
  if (!grid) return;

  // --- Build list of calibrated cell rects (with global fine-tune offset) ---
  const cellRects = [];
  const editor = globalThis.GridCellEditor;
  const globalOff = editor ? editor.getOffset() : { dx: 0, dy: 0 };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const sx = Math.floor(grid.gridX + c * (grid.cellW + grid.gapX) + globalOff.dx);
      const sy = Math.floor(grid.gridY + r * (grid.cellH + grid.gapY) + globalOff.dy);
      cellRects.push({ r, c, sx, sy, cx: sx + grid.cellW / 2, cy: sy + grid.cellH / 2 });
    }
  }

  // --- Diagnostic canvas ---
  const debugCanvas = document.createElement("canvas");
  debugCanvas.width = width; debugCanvas.height = height;
  const dCtx = debugCanvas.getContext("2d");
  dCtx.drawImage(snapshot, 0, 0);

  // Draw calibration cell outlines as cyan overlay
  dCtx.strokeStyle = "rgba(0,255,255,0.3)";
  dCtx.lineWidth = 1;
  cellRects.forEach(cell => dCtx.strokeRect(cell.sx, cell.sy, grid.cellW, grid.cellH));

  // --- Broad grayscale OCR on entire screen ---
  // Create a separate filtered canvas just for Tesseract
  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = width; ocrCanvas.height = height;
  const ocrCtx = ocrCanvas.getContext("2d");
  ocrCtx.drawImage(snapshot, 0, 0);

  // --- HIGH-PERFORMANCE PRE-PROCESSING ---
  // This filter creates high-contrast black text on a pure white background.
  const imgData = ocrCtx.getImageData(0, 0, width, height);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Isolation: Gold names (R > G > B) and White badges (High lum, low saturation)
    const isGold = (r > 110 && g > 90 && r > b * 1.3);
    const isWhite = (lum > 180 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20);

    if (isGold || isWhite) {
      px[i] = px[i + 1] = px[i + 2] = 0; // Text -> Black
    } else {
      px[i] = px[i + 1] = px[i + 2] = 255; // Background -> White
    }
  }
  ocrCtx.putImageData(imgData, 0, 0);

  logDebug("Running Inventory OCR Pass...");
  const { data: { words } } = await worker1.recognize(ocrCanvas);

  const textWords = [];
  const numberWords = [];
  words.forEach(w => {
    const txt = w.text.trim();
    if (txt.length < 1) return;
    if (/\d/.test(txt)) numberWords.push(w);
    if (/[A-Z]/i.test(txt)) textWords.push(w);
  });

  const primeItems = CACHED_DB_ITEMS.filter(it => it.isPrime);
  const detectedItemsThisFrame = [];

  // DRIVE BY CALIBRATED CELLS (STABLE)
  // We use the fixed calibration. The pre-processing ensures text is found inside.
  for (const cell of cellRects) {
    const TOL = 10;
    const clusterWords = textWords.filter(w =>
      w.bbox.x0 >= cell.sx - TOL && w.bbox.x1 <= cell.sx + grid.cellW + TOL &&
      w.bbox.y0 >= cell.sy - TOL && w.bbox.y1 <= cell.sy + grid.cellH + TOL
    );
    const clusterNums = numberWords.filter(w =>
      w.bbox.x0 >= cell.sx - TOL && w.bbox.x1 <= cell.sx + grid.cellW + TOL &&
      w.bbox.y0 >= cell.sy - TOL && w.bbox.y1 <= cell.sy + grid.cellH + TOL
    );

    if (clusterWords.length < 1 && clusterNums.length < 1) continue;
    const combinedText = [...clusterWords, ...clusterNums].map(w => w.text.toUpperCase());

    if (DEBUG_MODE) {
      logDebug(`[CELL r${cell.r}c${cell.c}] OCR words: [${combinedText.join(', ')}]`);
    }

    let bestMatch = null;
    let highestRatio = 0;
    const topScores = [];

    primeItems.forEach(dbItem => {
      let score = 0;
      const tWords = dbItem.searchWords;

      tWords.forEach(tw => {
        let maxS = 0;
        combinedText.forEach(cw => {
          const s = getSimilarity(cw, tw);
          maxS = Math.max(maxS, s);
        });
        if (maxS > 0.40) score += maxS;
      });

      const ratio = tWords.length > 0 ? score / tWords.length : 0;

      // Tie-breaker: if ratios are very close, prefer the more specific name (more words)
      const isBetter = ratio > highestRatio ||
        (Math.abs(ratio - highestRatio) < 0.01 && tWords.length > (bestMatch?.searchWords?.length || 0));

      if (isBetter) {
        highestRatio = ratio;
        bestMatch = dbItem;
      }
      if (DEBUG_MODE && ratio > 0.35) {
        topScores.push({ name: dbItem.originalName, ratio: ratio.toFixed(3) });
      }
    });

    if (DEBUG_MODE && topScores.length > 0) {
      topScores.sort((a, b) => b.ratio - a.ratio || b.name.length - a.name.length);
      logDebug(`[CELL r${cell.r}c${cell.c}] Top matches: ${topScores.slice(0, 5).map(s => `${s.name}(${s.ratio})`).join(' | ')}`);
    }

    if (!bestMatch || highestRatio < 0.45) continue;

    // Quantity detection zone (widened slightly for robustness)
    const qTopLimit = cell.sy + grid.cellH * 0.45;
    const qRightLimit = cell.sx + grid.cellW * 0.50;
    const qNumsTopLeft = clusterNums.filter(w =>
      w.bbox.x1 <= qRightLimit &&
      w.bbox.y1 <= qTopLimit
    );

    let qty = 1;
    if (qNumsTopLeft.length > 0) {
      qNumsTopLeft.sort((a, b) => b.bbox.y0 - a.bbox.y0);
      const m = qNumsTopLeft[0].text.match(/\d+/);
      if (m) qty = Math.max(1, Math.min(999, parseInt(m[0])));
    }

    detectedItemsThisFrame.push({ name: bestMatch.originalName, qty, x: cell.cx, y: cell.cy, cell });

    // Draw debug overlay
    dCtx.strokeStyle = "#ffff00"; dCtx.lineWidth = 2;
    dCtx.strokeRect(cell.sx, cell.sy, grid.cellW, grid.cellH);
    dCtx.fillStyle = "#ffe000"; dCtx.font = "bold 11px Arial";
    dCtx.fillText(`${bestMatch.originalName} x${qty}`, cell.sx + 4, cell.sy + 16);
  }

  // Dedup
  const uniqueInFrame = [];
  detectedItemsThisFrame.forEach(item => {
    const dup = uniqueInFrame.findIndex(it => Math.abs(it.x - item.x) < 20 && Math.abs(it.y - item.y) < 20);
    if (dup === -1) uniqueInFrame.push(item);
    else if (item.qty > uniqueInFrame[dup].qty) uniqueInFrame[dup] = item;
  });

  uniqueInFrame.forEach(item => {
    const existing = sessionInventory.get(item.name) || 0;
    if (item.qty >= existing) sessionInventory.set(item.name, item.qty);
  });

  // NOTE: Similarity-based session merging has been removed.
  // The grid-cell OCR assigns each item to its own calibrated cell, so
  // accidental duplicates cannot arise from position overlap.
  // Merging by name similarity (>0.85) was incorrectly collapsing distinct
  // items that share a common suffix (e.g. "Akarius Prime Barrel" and
  // "Afuris Prime Barrel" share most bigrams as full strings).


  logDebug(`Detected ${uniqueInFrame.length} items (hybrid grid+anchor scan).`);
  const sorted = [...uniqueInFrame].sort((a, b) => a.y - b.y || a.x - b.x);
  updateLiveInventoryUI(sorted[sorted.length - 1], sorted, grid.cellH * 0.1);
  return debugCanvas.toDataURL("image/jpeg", 0.7);
}



function updateLiveInventoryUI(lastFoundItem = null, currentFrameItems = [], avgU = 10) {
  // Count badge = total unique session items
  const countDisplay = document.getElementById("live-inv-count");
  if (countDisplay) countDisplay.innerText = sessionInventory.size;

  const listContainer = document.getElementById("live-inventory-items-list");
  if (!listContainer) return;

  if (currentFrameItems.length === 0) {
    listContainer.innerHTML = `<div style="text-align:center;color:#444;font-size:0.75em;padding:20px 0;">No items detected yet</div>`;
    return;
  }

  // Flat list sorted by row then column (Y then X)
  const sorted = [...currentFrameItems].sort((a, b) => a.y - b.y || a.x - b.x);
  listContainer.innerHTML = sorted.map(item => {
    const shortName = item.name.replace(/prime/gi, "").trim();
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;
          background:rgba(0,229,255,0.04);padding:5px 8px;border-radius:4px;
          border-left:2px solid rgba(0,229,255,0.4);
          font-size:0.78em;gap:6px;">
        <span style="color:#ddd;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${shortName}</span>
        <span style="color:#f1c40f;font-weight:900;flex-shrink:0;">×${item.qty}</span>
      </div>`;
  }).join("");

  const scrollGuide = document.getElementById("live-scroll-guide");
  if (scrollGuide && lastFoundItem) {
    const cleanName = lastFoundItem.name.replace(/PRIME/gi, "").trim();
    scrollGuide.innerHTML = `<span style="color:#0e9;font-weight:700;">${cleanName.toUpperCase()}</span> — last detected`;
  }
}

async function processRelicSelection(video, width, height, scale) {
  const rsCropX = Math.floor(width * 0.5);
  const rsCropY = Math.floor(height * 0.2);
  const rsCropW = Math.floor(width * 0.5);
  const rsCropH = Math.floor(height * 0.25);

  const canvas = virtualCanvas || document.createElement("canvas");
  canvas.width = Math.floor(rsCropW * scale * 0.75);
  canvas.height = Math.floor(rsCropH * scale * 0.75);
  const ctx = canvas.getContext("2d");
  ctx.filter = "grayscale(100%) brightness(1.2) contrast(300%)";
  ctx.drawImage(video, rsCropX, rsCropY, rsCropW, rsCropH, 0, 0, canvas.width, canvas.height);

  const { data } = await worker1.recognize(canvas);
  detectRelicSelection(data);
}

async function processRewards(video, width, height, scale) {
  // Reward mode optimization: Wider vertical window (30-65%) to ensure coverage
  const rCropY = Math.floor(height * 0.30);
  const rCropH = Math.floor(height * 0.35);
  const targetW = Math.floor(width * scale) * 1.5;
  const targetH = Math.floor(rCropH * scale) * 1.5;

  const canvas = virtualCanvas || document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  // Tuned filter for reward text contrast
  ctx.filter = "brightness(1.2) contrast(180%) grayscale(100%)";
  ctx.drawImage(video, 0, rCropY, width, rCropH, 0, 0, targetW, targetH);

  const { data } = await worker1.recognize(canvas);
  const foundItems = parseTextForItems(data);
  if (foundItems.length > 0 && !detectionLocked) {
    handleSuccessfulScan(video, width, height, foundItems);
  }
}

function detectRelicSelection(data) {
  const tiers = ["LITH", "MESO", "NEO", "AXI", "REQUIEM"];
  const text = data.text.toUpperCase();
  const pattern = tiers.join("|");
  const match = new RegExp(`(${pattern})[\\s\\S]*?([A-Z][0-9]{1,2}|[IVX]+)`, "i").exec(text);
  if (!match) return;

  const tier = match[1].toUpperCase();
  const codeRaw = match[2].trim().replace(/\s+/g, "");
  const isRequiem = tier === "REQUIEM";

  let code = codeRaw;
  if (!isRequiem && code.length >= 2) {
    code = code.replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6").replace(/O/g, "0").replace(/[IL]/g, "1");
  } else if (isRequiem) {
    code = code.replace(/1/g, "I").replace(/0/g, "O").replace(/2/g, "II").replace(/3/g, "III").replace(/4/g, "IV");
  }

  if (code && code.length >= 1) {
    const foundRelic = `${tier} ${code}`.toUpperCase();
    if (foundRelic === lastTrackedRelic) return;
    const exists = state.allRelicNames?.some(n => n.toUpperCase() === foundRelic);
    if (exists) {
      lastTrackedRelic = foundRelic;
      showTrackConfirm(foundRelic);
    }
  }
}

function showTrackConfirm(relicName) {
  const existing = document.getElementById("relic-track-popup");
  if (existing) existing.remove();
  const popup = document.createElement("div");
  popup.id = "relic-track-popup";
  popup.className = "track-popup-anim";
  popup.innerHTML = `
    <div class="track-popup-content">
      <div class="relic-icon-mini">${relicName.split(" ")[0][0]}</div>
      <div class="track-text">
        <span class="track-title">🔍 ${TEXTS[state.currentLang].scanner.relicDetected}</span>
        <span class="track-name">${relicName}</span>
      </div>
      <div class="track-actions">
        <button class="track-btn-no" id="btn-track-cancel">✕</button>
        <button class="track-btn-yes" id="btn-track-confirm">${TEXTS[state.currentLang].scanner.track}</button>
      </div>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById("btn-track-cancel").onclick = () => popup.remove();
  document.getElementById("btn-track-confirm").onclick = () => {
    if (globalThis.switchTab) globalThis.switchTab("relic");
    const input = document.getElementById("relicInput");
    if (input) {
      input.value = relicName;
      state.selectedRelic = relicName;
      if (globalThis.manualRelicUpdate) globalThis.manualRelicUpdate();
      showToast(TEXTS[state.currentLang].scanner.trackingToast.replace("{relic}", relicName));
    }
    popup.remove();
  };
  setTimeout(() => { if (popup.parentElement) popup.classList.add("fade-out"); }, 10000);
  setTimeout(() => { if (popup.parentElement) popup.remove(); }, 10500);
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
      rawWords.push({ text: part, x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 });
    });
  });
  const ocrWords = rawWords; // Restore context for Rewards
  const dbItems = CACHED_DB_ITEMS;
  const finalResults = [];
  const usedIndices = new Set();

  function runMatchingPass(lookAheadLimit) {
    for (let i = 0; i < ocrWords.length; i++) {
      if (usedIndices.has(i) || finalResults.length >= 32) continue;
      for (const item of dbItems) {
        const firstWordDB = item.firstWord;
        const similarityThreshold = firstWordDB.length <= 3 ? 0.9 : 0.85;
        if (getSimilarity(ocrWords[i].text, firstWordDB) > similarityThreshold) {
          let matchedIndices = [i];
          let currentPos = i;
          let possibleMatch = true;
          for (let j = 1; j < item.searchWords.length; j++) {
            let foundNext = false;
            const targetComp = item.searchWords[j];
            for (let dist = 1; dist <= lookAheadLimit; dist++) {
              const nextIdx = currentPos + dist;
              if (nextIdx >= ocrWords.length || usedIndices.has(nextIdx)) continue;
              if (getSimilarity(ocrWords[nextIdx].text, targetComp) > 0.75) {
                matchedIndices.push(nextIdx); currentPos = nextIdx; foundNext = true; break;
              }
            }
            if (!possibleMatch || !foundNext) {
              if (targetComp === "BLUEPRINT") {
                const prevWordDB = item.searchWords[j - 1];
                if (["NEUROPTICS", "SYSTEMS", "CHASSIS", "HARNESS", "WINGS", "CARAPACE", "CEREBRUM", "FORMA"].includes(prevWordDB)) foundNext = true;
                else { possibleMatch = false; break; }
              } else { possibleMatch = false; break; }
            }
          }
          if (possibleMatch) {
            const avgX = matchedIndices.reduce((sum, idx) => sum + ocrWords[idx].x, 0) / matchedIndices.length;
            const avgY = matchedIndices.reduce((sum, idx) => sum + ocrWords[idx].y, 0) / matchedIndices.length;
            finalResults.push({ name: item.originalName, xPos: avgX, yPos: avgY });
            matchedIndices.forEach((idx) => usedIndices.add(idx));
            break;
          }
        }
      }
    }
  }
  runMatchingPass(3);
  if (finalResults.length < 32) runMatchingPass(8);
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
  autoCloseTimer = setTimeout(() => { globalThis.closeScanModal(); }, AUTO_CLOSE_DELAY_MS);
  const itemsWithDetails = await Promise.all(items.map(async (item) => {
    let price = priceCache.get(item.name) || 0;
    if (price === 0) {
      try {
        const slug = getSlug(item.name);
        price = await getPriceValue(item.name, slug);
        if (price > 0) priceCache.set(item.name, price);
      } catch (e) { console.error(e); }
    }
    let ducats = 0;
    if (state.ducatsDatabase) {
      const itemData = Object.values(state.ducatsDatabase).find(d => d.name.toUpperCase() === item.name.toUpperCase());
      if (itemData) ducats = itemData.ducats;
    }
    return { ...item, price, ducats };
  }));
  const maxPl = Math.max(...itemsWithDetails.map((i) => i.price));
  const maxDuc = Math.max(...itemsWithDetails.map((i) => i.ducats));
  requestAnimationFrame(() => {
    const cvsHeight = virtualCanvas ? virtualCanvas.height : 100;
    const cvsWidth = virtualCanvas ? virtualCanvas.width : 1000;
    itemsWithDetails.forEach((item) => {
      const leftPercent = (item.xPos / cvsWidth) * 100;
      const topPercent = ((item.yPos + 35) / cvsHeight) * 100;
      createModalBadge(item.name, item.price, item.ducats, badgesContainer, leftPercent, topPercent, item.price === maxPl && item.price > 0, item.ducats === maxDuc && item.ducats > 0);
    });
  });
}

function createModalBadge(name, price, ducats, container, leftPercent, topPercent, isBestPl, isBestDuc) {
  const badge = document.createElement("div");
  badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestDuc ? "best-duc" : ""}`;
  const clampedLeft = Math.max(8, Math.min(92, leftPercent));
  badge.style.left = `${clampedLeft}%`;
  badge.style.top = `${Math.min(90, topPercent)}%`;
  const slug = getSlug(name);
  const cleanName = name.replaceAll(/PRIME/gi, "").replaceAll(/BLUEPRINT/gi, "BP").replaceAll(/NEUROPTICS/gi, "NEURO").replaceAll(/SYSTEMS/gi, "SYS").replaceAll(/CHASSIS/gi, "CHAS").trim();
  badge.innerHTML = `
    <a href="https://warframe.market/items/${slug}" target="_blank" class="modal-badge-link" style="display:block; text-decoration:none;">
        <div class="modal-badge-name" style="font-size:10px; color:#aaa; font-weight:bold; margin-bottom:4px; text-transform:uppercase;">${cleanName}</div>
        <div class="modal-badge-row" style="display:flex; justify-content:center; align-items:center; gap:10px; font-weight:bold;">
            <div class="modal-badge-price" style="display:flex; align-items:center; gap:2px; font-size:14px; color:#f1c40f;">
                <img src="assets/relic_contents/platinum.webp" style="width:14px; height:14px;">
                ${price > 0 ? price : "--"} pl
            </div>
            ${ducats > 0 ? `<div class="modal-badge-ducats" style="display:flex; align-items:center; gap:3px; font-size:13px; color:#D4AF37;">
                   <span style="background:#D4AF37; color:#000; width:14px; height:14px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9px; font-weight:900;">D</span>
                   ${ducats}
                </div>` : ""}
        </div>
    </a>`;
  container.appendChild(badge);
}

globalThis.saveLiveInventory = function () {
  if (sessionInventory.size === 0) return showToast("No items detected");
  for (const [name, count] of sessionInventory) {
    state.primeInventory[name] = (state.primeInventory[name] || 0) + count;
  }

  // Automagically promote completed sets
  checkAndPromoteSets();

  sessionInventory.clear();
  updateLiveInventoryUI();
  showToast("Inventory updated!");
  if (globalThis.saveAppState) globalThis.saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
};

globalThis.clearLiveSessionInventory = function () {
  sessionInventory.clear();
  updateLiveInventoryUI();
  showToast("Session cleared");
};

globalThis.startLiveSession = startLiveSession;
function copyScannerDebugLog() {
  if (debugLogArchive.length === 0) {
    if (typeof showToast === "function") showToast("No debug logs collected yet.");
    else alert("No debug logs collected yet.");
    return;
  }
  const text = debugLogArchive.join("\n");
  navigator.clipboard.writeText(text).then(() => {
    if (typeof showToast === "function") showToast("Diagnostic log copied to clipboard!");
    else alert("Diagnostic log copied to clipboard!");
  }).catch(err => {
    console.error("Copy failed", err);
  });
}

globalThis.stopLiveSession = stopLiveSession;
globalThis.isScannerActive = () => !!(liveStream?.active);
globalThis.copyScannerDebugLog = copyScannerDebugLog;
globalThis.closeScanModal = function () {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  const modal = document.getElementById("scan-success-modal");
  if (modal) modal.classList.add("hidden");
  detectionLocked = false;
};

globalThis.manualPrecisionScan = async function () {
  if (isScanning) return showToast("Scanner busy...");
  const video = document.getElementById("live-video");
  if (!video || !liveStream?.active) return showToast("Scanner not active");

  // Snapshot session BEFORE scanning to detect what's truly new
  _preSessionItemNames = new Set(sessionInventory.keys());

  showToast("Scanning page...");
  isScanning = true;
  const msgEl = document.getElementById("live-inv-msg");

  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = 1080 / height;

    snapshotCanvas.width = width;
    snapshotCanvas.height = height;
    snapshotCtx.drawImage(video, 0, 0);

    if (msgEl) msgEl.innerText = "SCANNING...";

    const diagnosticUrl = await processInventoryGrid(snapshotCanvas, width, height, scale);
    if (msgEl) msgEl.innerText = "DONE";

    if (!diagnosticUrl) { isScanning = false; return; }

    if (DEBUG_MODE) {
      const dbgImg = document.getElementById('live-debug-snapshot-img');
      const dbgPanel = document.getElementById('live-debug-snapshot');
      if (dbgImg) { dbgImg.src = diagnosticUrl; dbgImg.style.display = 'block'; }
      if (dbgPanel) dbgPanel.style.display = 'block';
    }

    // --- AUTO-SCAN PROGRESS FEEDBACK ---
    const newItems = [...sessionInventory.keys()].filter(k => !_preSessionItemNames.has(k));
    const newCount = newItems.length;
    const totalNow = sessionInventory.size;
    const scrollGuide = document.getElementById("live-scroll-guide");

    if (newCount > 0) {
      // Found new items → user should scroll and scan again
      if (msgEl) msgEl.innerText = `+${newCount} NEW`;
      if (scrollGuide) scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#f1c40f;font-weight:800;font-size:0.85em;">↓ ${newCount} NEW ITEM${newCount > 1 ? 'S' : ''} FOUND</div>
          <div style="color:#506070;margin:3px 0;">Scroll down, then press SCAN PAGE again.</div>
          <div style="display:flex;gap:5px;margin-top:5px;">
            <button onclick="globalThis.manualPrecisionScan()" style="flex:1;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.4);color:#00e5ff;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;font-weight:700;">↓ SCAN NEXT</button>
            <button onclick="globalThis.inventoryScanDone()" style="flex:1;background:none;border:1px solid rgba(255,255,255,0.1);color:#506070;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;">✓ DONE</button>
          </div>
        </div>`;
    } else {
      // No new items → likely at the bottom or already seen this page
      if (msgEl) msgEl.innerText = `${totalNow} ITEMS`;
      if (scrollGuide) scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#a0c0b0;font-weight:800;font-size:0.85em;">✓ No new items on this page</div>
          <div style="color:#506070;margin:3px 0;">${totalNow} total unique items found.</div>
          <button onclick="globalThis.inventoryScanDone()" style="width:100%;margin-top:5px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.3);color:#7cada8;font-size:0.7em;padding:5px;border-radius:4px;cursor:pointer;font-weight:700;">✓ FINISHED — SAVE INVENTORY</button>
        </div>`;
    }
  } catch (e) {
    console.error("Manual scan failed:", e);
    showToast("Scan failed: " + e.message);
  } finally {
    isScanning = false;
  }
};

globalThis.inventoryScanDone = function () {
  const scrollGuide = document.getElementById("live-scroll-guide");
  const msgEl = document.getElementById("live-inv-msg");
  if (msgEl) msgEl.innerText = `${sessionInventory.size} ITEMS`;
  if (scrollGuide) scrollGuide.innerHTML = `<span style="color:#a0c0b0;">✓ Scan complete — ${sessionInventory.size} unique items</span>`;
  showToast(`Scan complete! ${sessionInventory.size} unique Prime items found.`);
};

