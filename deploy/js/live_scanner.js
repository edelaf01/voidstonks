import { state } from "./state.js";
import { getPriceValue, getSlug } from "./api.js";
import { showToast, escapeHTML } from "./ui.components/ui_components.js";
import { TEXTS } from "./config.js";
import {
  initOcrWorkers,
  stopOcrWorkers,
  getBadgeWorkers,
  initScannerMatcherData,
  findBestItemMatch,
  parseTextForRewards,
} from "./scanner_ocr.js";
import {
  getFrameHash,
  createFilteredOcrCanvas,
  createTextCanvas,
  createBadgeCanvas,
  applyClusteringThreshold,
  detectCheckmark,
} from "./scanner_vision.js";

let DEBUG_MODE = false;
globalThis.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  const btn = document.getElementById("btn-debug-toggle");
  if (btn) btn.classList.toggle("active", DEBUG_MODE);
  const dbgPanel = document.getElementById("live-debug-snapshot");
  if (dbgPanel) dbgPanel.style.display = DEBUG_MODE ? "block" : "none";
  showToast(DEBUG_MODE ? "Debug mode ON" : "Debug mode OFF");
};

let liveStream = null;
let scanInterval = null;
let isScanning = false;
let isDeepScanning = false;
let worker1 = null;
let worker2 = null;
let worker3 = null;
let isStartingSession = false;
let detectionLocked = false;
let autoCloseTimer = null;
const AUTO_CLOSE_DELAY_MS = 20000;
let currentScanRate = 1200;
const FAST_SCAN_RATE = 600;
const SLOW_SCAN_RATE = 1500;
const INV_SCAN_RATE = 2000;

let autoScrollMode = false;
let autoScrollHash = null;
let autoScrollStableTimer = null;

globalThis.toggleAutoScrollScan = function () {
  autoScrollMode = !autoScrollMode;
  autoScrollHash = null;

  if (autoScrollStableTimer) {
    clearTimeout(autoScrollStableTimer);
    autoScrollStableTimer = null;
  }

  const btn = document.getElementById("btn-auto-scan");
  if (btn) {
    const theme = autoScrollMode
      ? {
        alpha: "0.15",
        border: "0.7",
        color: "#00ff78",
        shadow: "0 0 12px rgba(0,255,120,0.3)",
        label: "⟳ AUTO ✓",
      }
      : {
        alpha: "0.06",
        border: "0.25",
        color: "#4a7a5a",
        shadow: "none",
        label: "⟳ AUTO",
      };

    btn.dataset.active = autoScrollMode ? "1" : "0";
    btn.textContent = theme.label;

    Object.assign(btn.style, {
      background: `rgba(0,255,120,${theme.alpha})`,
      borderColor: `rgba(0,255,120,${theme.border})`,
      color: theme.color,
      boxShadow: theme.shadow,
    });
  }

  const scrollGuide = document.getElementById("live-scroll-guide");
  const sh = TEXTS[state.currentLang]?.scannerHUD;

  if (scrollGuide) {
    scrollGuide.innerHTML = autoScrollMode
      ? `<div style="color:#00ff78;font-weight:800;font-size:0.82em;">${sh?.autoScanOn || "⟳ AUTO SCAN ACTIVO"}</div>
         <div style="color:#506070;font-size:0.75em;margin-top:3px;">${sh?.autoScanDesc || "↓ Haz scroll suavemente en el inventario.<br>Se escaneará automático al estabilizar."}</div>`
      : `<div style="color:#506070;font-size:0.75em;">Auto scan OFF</div>`;
  }

  showToast(`Auto-scroll scan ${autoScrollMode ? "ON" : "OFF"}`);
};

function updateScrollUI(status, count = 0) {
  const scrollGuide = document.getElementById("live-scroll-guide");
  if (!scrollGuide) return;
  const sh = TEXTS[state.currentLang]?.scannerHUD;

  if (status === "detected") {
    scrollGuide.innerHTML = `<div style="color:#f1c40f;font-weight:800;font-size:0.82em;">${sh?.autoScanDetected || "MOVIMIENTO DETECTADO"}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${sh?.autoScanDetectedDesc || "Esperando estabilización..."}</div>`;
  } else if (status === "scanning") {
    scrollGuide.innerHTML = `<div style="color:#00e5ff;font-weight:800;font-size:0.82em;">${sh?.autoScanScanning || "ESCANEANDO PÁGINA..."}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${sh?.autoScanScanningDesc || "Por favor no muevas el inventario ni la pantalla."}</div>`;
  } else if (status === "done") {
    const doneDesc = (sh?.autoScanDoneDesc || "{count} items únicos en total.<br>Puedes seguir bajando la página.").replace("{count}", count);
    scrollGuide.innerHTML = `<div style="color:#00ff78;font-weight:800;font-size:0.82em;">${sh?.autoScanDone || "ESCANEO COMPLETADO"}</div><div style="color:#506070;font-size:0.75em;margin-top:3px;">${doneDesc}</div>`;
  }
}

async function checkAutoScrollScan(externalHash = null) {
  if (!autoScrollMode || isDeepScanning) return;

  const video = document.getElementById("live-video");
  if (!video || !liveStream?.active || video.videoHeight < 10) return;

  let currentHash = externalHash;

  if (currentHash === null) {
    const vw = video.videoWidth,
      vh = video.videoHeight;
    const sampleCvs = document.createElement("canvas");
    sampleCvs.width = 48;
    sampleCvs.height = 27;

    const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(
      video,
      0,
      Math.floor(vh * 0.25),
      vw,
      Math.floor(vh * 0.65),
      0,
      0,
      48,
      27,
    );
    currentHash = getFrameHash(sCtx, 48, 27);
  }

  if (autoScrollHash === null) {
    autoScrollHash = currentHash;
    return;
  }

  if (Math.abs(currentHash - autoScrollHash) < 80) return;

  updateScrollUI("detected");
  autoScrollHash = null;

  if (autoScrollStableTimer) clearTimeout(autoScrollStableTimer);

  autoScrollStableTimer = setTimeout(async () => {
    if (!autoScrollMode || isDeepScanning) return;

    isDeepScanning = true;
    if (!globalThis.currentStabilizationId) globalThis.currentStabilizationId = 0;
    globalThis.currentStabilizationId++;
    updateScrollUI("scanning");

    try {
      const scale = 1080 / video.videoHeight;
      snapshotCanvas.width = video.videoWidth;
      snapshotCanvas.height = video.videoHeight;
      snapshotCtx.drawImage(video, 0, 0);

      await processInventoryGrid(
        snapshotCanvas,
        video.videoWidth,
        video.videoHeight,
        scale,
      );
      await processInventoryGrid(
        snapshotCanvas,
        video.videoWidth,
        video.videoHeight,
        scale,
      );

      updateScrollUI("done", sessionInventory.size);
      autoScrollHash = currentHash;
    } catch (e) {
      console.warn("Auto-scan error", e);
    } finally {
      isDeepScanning = false;
    }
  }, 2000);
}

let virtualCanvas = null;
let vCtx = null;
let snapshotCanvas = null;
let snapshotCtx = null;
const priceCache = new Map();

let lastTrackedRelic = "";
//NO SE USA
//let trackingDebounce = 0;
let scanCounter = 0;

let sessionInventory = new Map();
let isInventoryMode = false;
let _preSessionItemNames = new Set();

let debugLogArchive = [];
function logDebug(...args) {
  if (DEBUG_MODE) {
    console.log(" [DEBUG]:", ...args);
    debugLogArchive.push(
      `[${new Date().toLocaleTimeString()}] ` +
      args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : a))
        .join(" "),
    );
    if (debugLogArchive.length > 500) debugLogArchive.shift();
  }
}

let lastStableImageHash = null;

function getRequiredCountLocal(setName, partName) {
  const manifest = state.primeManifest || [];
  const item = manifest.find((i) => i.name === setName);
  if (!item?.components) return 1;

  let cleanPart =
    partName === setName ? "Blueprint" : partName.replace(setName, "").trim();
  if (cleanPart.endsWith(" Blueprint"))
    cleanPart = cleanPart.replace(" Blueprint", "").trim();

  const comp = item.components.find(
    (c) =>
      c.name === cleanPart ||
      c.name + " Blueprint" === cleanPart ||
      setName + " " + c.name === partName,
  );
  return comp ? comp.itemCount : 1;
}

function checkAndPromoteSets() {
  const inv = state.primeInventory;
  if (!inv) return;

  const allSetNames = Object.keys(state.itemsDatabase).filter((n) =>
    n.endsWith(" Set"),
  );

  allSetNames.forEach((setName) => {
    const baseName = setName.replace(" Set", "");
    const parts = Object.keys(state.itemsDatabase).filter(
      (n) => (n === baseName || n.startsWith(baseName + " ")) && n !== setName,
    );

    if (parts.length < 2) return;

    let canComplete = true;
    let minSets = Infinity;

    parts.forEach((part) => {
      const required = getRequiredCountLocal(baseName, part);
      const owned = inv[part] || 0;
      const possible = Math.floor(owned / required);
      if (possible < 1) canComplete = false;
      if (possible < minSets) minSets = possible;
    });

    if (canComplete && minSets > 0) {
      logDebug(`SET COMPLETED: Promoting parts to ${setName} x${minSets}`);
      parts.forEach((part) => {
        const required = getRequiredCountLocal(baseName, part);
        inv[part] -= required * minSets;
        if (inv[part] <= 0) delete inv[part];
      });
      inv[setName] = (inv[setName] || 0) + minSets;
    }
  });
}

function canItemCompleteSet(itemName) {
  if (!state.primeInventory || !state.primeManifest) return false;

  // Find sets this item belongs to
  const allSetNames = Object.keys(state.itemsDatabase).filter(n => n.endsWith(" Set"));

  for (const setName of allSetNames) {
    const baseName = setName.replace(" Set", "");
    const parts = Object.keys(state.itemsDatabase).filter(
      n => (n === baseName || n.startsWith(baseName + " ")) && n !== setName
    );

    // If this item is part of this set
    if (parts.includes(itemName)) {
      const requiredForThis = getRequiredCountLocal(baseName, itemName);
      const ownedForThis = state.primeInventory[itemName] || 0;

      // If adding 1 would make us hit a set multiple
      const currentSets = Math.floor(ownedForThis / requiredForThis);
      const futureSets = Math.floor((ownedForThis + 1) / requiredForThis);

      if (futureSets > currentSets) {
        // Now check if we have enough of EVERY OTHER part to actually complete that set
        let othersReady = true;
        for (const other of parts) {
          if (other === itemName) continue;
          const req = getRequiredCountLocal(baseName, other);
          const own = state.primeInventory[other] || 0;
          if (Math.floor(own / req) < futureSets) {
            othersReady = false;
            break;
          }
        }
        if (othersReady) return true;
      }
    }
  }
  return false;
}

export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;
  detectionLocked = false;
  isScanning = false;
  lastTrackedRelic = "";
  trackingDebounce = 0;
  sessionInventory.clear();
  globalThis.currentStabilizationId = 0;
  globalThis.lastProcessedStabilization = -1;
  globalThis.processedItemsInStability = new Set();
  isInventoryMode = false;
  initScannerMatcherData();
  const video = document.getElementById("live-video");
  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.add("active");
    toggleBtn.querySelector(".label").innerText =
      TEXTS[state.currentLang].scanner.starting;
  }
  try {
    logDebug("Requesting display media...");
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "never",
        displaySurface: "window",
        frameRate: { ideal: 10, max: 15 },
      },
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

    if (
      !worker1 &&
      (globalThis.Tesseract || typeof Tesseract !== "undefined")
    ) {
      logDebug("Initializing Triple Tesseract workers...");
      const workers = await initOcrWorkers();
      worker1 = workers[0];
      worker2 = workers[1];
      worker3 = workers[2];
      logDebug("Triple Workers ready");
    }

    if (!worker1) throw new Error("Tesseract workers not available");

    setTimeout(() => {
      logDebug("Starting scan loop...");
      startLoop();
    }, 1000);

    showToast(TEXTS[state.currentLang].scanner.toastActive);
    if (toggleBtn)
      toggleBtn.querySelector(".label").innerText =
        TEXTS[state.currentLang].scanner.active;
    liveStream.getVideoTracks()[0].onended = () => {
      logDebug("Stream track ended");
      stopLiveSession();
    };
  } catch (e) {
    console.error("Scanner startup failed:", e);
    showToast("Error: " + e.message);
    stopLiveSession();
  } finally {
    isStartingSession = false;
  }
}

export function stopLiveSession() {
  if (scanInterval) clearTimeout(scanInterval);
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }
  stopOcrWorkers();
  worker1 = null;
  worker2 = null;
  worker3 = null;
  isScanning = false;
  detectionLocked = false;
  isStartingSession = false;
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
  document.getElementById("inv-hud")?.style &&
    (document.getElementById("inv-hud").style.display = "none");
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
  if (isScanning || isDeepScanning) return;
  isScanning = true;
  scanCounter++;

  try {
    const video = document.getElementById("live-video");
    if (!video || video.videoWidth < 10) return;

    const dims = prepareVirtualCanvas(video);

    if (isInventoryMode && isStableInventoryFrame()) return;

    logDebug(`Processing frame ${scanCounter}...`);
    const { data: headerData } = await worker1.recognize(virtualCanvas);
    const headerText = headerData.text.toUpperCase();
    console.log("[SCAN] Header OCR:", headerText);

    const contextType = determineContext(headerText);
    console.log("[SCAN] Context:", contextType);
    await routeFrameAction(contextType, video, dims);

    const counter = document.getElementById("hud-scan-counter");
    if (counter) counter.textContent = `FRAME ${scanCounter}`;
  } catch (e) {
    console.warn("OCR Error", e);
  } finally {
    isScanning = false;
  }
}

function prepareVirtualCanvas(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = 1080 / height;

  const hCropH = Math.floor(height * 0.15);

  virtualCanvas.width = Math.floor(width * scale);
  virtualCanvas.height = Math.floor(hCropH * scale);

  if (!vCtx) vCtx = virtualCanvas.getContext("2d");

  vCtx.drawImage(
    video,
    0, 0, width, hCropH,
    0, 0, virtualCanvas.width, virtualCanvas.height,
  );

  const imgData = vCtx.getImageData(0, 0, virtualCanvas.width, virtualCanvas.height);
  const px = imgData.data;

  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];

    let luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);

    let isOrange = (r > 140 && g > 70 && b < 100 && r > b + 40);

    // 2. Regla para el texto blanco/gris claro del contexto extra

    let isWhiteText = (luma > 160 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30);

    if (isOrange || isWhiteText) {
      px[i] = px[i + 1] = px[i + 2] = 0;
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
  }
  vCtx.putImageData(imgData, 0, 0);

  return { width, height, scale };
}

function isStableInventoryFrame() {
  checkAutoScrollScan();
  const currentHash = getFrameHash(
    vCtx,
    virtualCanvas.width,
    virtualCanvas.height,
  );

  if (
    lastStableImageHash !== null &&
    Math.abs(currentHash - lastStableImageHash) < 50
  ) {
    return true;
  }

  lastStableImageHash = currentHash;
  return false;
}

function determineContext(headerText) {
  if (/INVEN|TORY|SELL/.test(headerText)) return "INVENTORY";
  if (/RELI|ELIC/.test(headerText) || /REFI|NEME/.test(headerText))
    return "RELICS";
  if (/REWA|WARD|FISSU|FISSI|VOID/.test(headerText)) return "REWARD";
  return "UNKNOWN";
}

async function routeFrameAction(contextType, video, dims) {
  const { width, height, scale } = dims;

  if (contextType === "INVENTORY") {
    isInventoryMode = true;
    currentScanRate = INV_SCAN_RATE;
    updateHUD("INVENTORY");

    const frameHash = getFrameHash(
      vCtx,
      virtualCanvas.width,
      virtualCanvas.height,
    );
    checkAutoScrollScan(frameHash);
  } else if (contextType === "RELICS") {
    isInventoryMode = false;
    currentScanRate = FAST_SCAN_RATE;
    updateHUD("RELICS");
    await processRelicSelection(video, width, height, scale);
  } else if (contextType === "REWARD" && !isInventoryMode) {
    isInventoryMode = false;
    currentScanRate = SLOW_SCAN_RATE;
    updateHUD("REWARD");
    await processRewards(video, width, height, scale);
  } else {
    currentScanRate = 800;
  }
}

function updateHUD(contextType) {
  const sh = TEXTS[state.currentLang].scannerHUD;
  const hud = document.getElementById("inv-hud");
  const badge = document.getElementById("hud-context-badge");

  if (contextType === "INVENTORY") {
    if (hud) hud.style.display = "block";
    setUIBadge(
      badge,
      sh.statusInventory,
      "#f1c40f",
      "rgba(241,196,15,0.4)",
      "rgba(241,196,15,0.1)",
    );

    const msgEl = document.getElementById("live-inv-msg");
    if (msgEl && !autoScrollMode) {
      msgEl.innerText = sh.statusIdle === "IDLE" ? "READY" : "LISTO";
    }
  } else {
    if (hud) hud.style.display = "none";

    if (contextType === "RELICS") {
      setUIBadge(
        badge,
        sh.statusRelics,
        "#00e5ff",
        "rgba(0,229,255,0.3)",
        "rgba(0,229,255,0.1)",
      );
    } else if (contextType === "REWARD") {
      setUIBadge(
        badge,
        sh.statusReward,
        "#a0ff80",
        "rgba(160,255,128,0.3)",
        "rgba(160,255,128,0.08)",
      );
    }
  }
}

function setUIBadge(badgeElement, text, color, borderColor, background) {
  if (!badgeElement) return;
  badgeElement.textContent = text;
  badgeElement.style.color = color;
  badgeElement.style.borderColor = borderColor;
  badgeElement.style.background = background;
}

async function processInventoryGrid(snapshot, width, height, scale) {
  if (
    globalThis.LiveCalibration &&
    !globalThis.LiveCalibration.hasCalibration()
  ) {
    logDebug("No Grid Calibration found. Pausing for user calibration.");
    const calibCvs = document.createElement("canvas");
    calibCvs.width = width;
    calibCvs.height = height;
    const calibCtx = calibCvs.getContext("2d");
    calibCtx.drawImage(snapshot, 0, 0);
    await globalThis.LiveCalibration.runCalibrationFlow(
      calibCtx.getImageData(0, 0, width, height),
    );
    return null;
  }

  const grid = globalThis.LiveCalibration?.getGrid();
  if (!grid) return;

  const cellRects = [];
  const editor = globalThis.GridCellEditor;
  const globalOff = editor ? editor.getOffset() : { dx: 0, dy: 0 };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const sx = Math.floor(
        grid.gridX + c * (grid.cellW + grid.gapX) + globalOff.dx,
      );
      const sy = Math.floor(
        grid.gridY + r * (grid.cellH + grid.gapY) + globalOff.dy,
      );
      cellRects.push({
        r,
        c,
        sx,
        sy,
        cx: sx + grid.cellW / 2,
        cy: sy + grid.cellH / 2,
      });
    }
  }

  const debugCanvas = document.createElement("canvas");
  debugCanvas.width = width;
  debugCanvas.height = height;
  const dCtx = debugCanvas.getContext("2d");
  dCtx.drawImage(snapshot, 0, 0);

  dCtx.strokeStyle = "rgba(0,255,255,0.3)";
  dCtx.lineWidth = 1;
  cellRects.forEach((cell) =>
    dCtx.strokeRect(cell.sx, cell.sy, grid.cellW, grid.cellH),
  );

  const ocrCanvas = createFilteredOcrCanvas(
    snapshot,
    width,
    height,
    grid,
    cellRects,
  );

  logDebug(
    `Iniciando OCR en paralelo con 3 workers para ${cellRects.length} celdas...`,
  );

  const chunks = [[], [], []];
  cellRects.forEach((cell, i) => chunks[i % 3].push(cell));
  const workers = [worker1, worker2, worker3];
  const detectedItemsThisFrame = [];

  const processChunk = async (chunk, worker, bWorker) => {
    for (const cell of chunk) {
      const combinedText = await extractCellText(cell, worker, ocrCanvas, grid);
      if (!combinedText) continue;

      handleDebugLogging(cell, combinedText);

      const bestMatch = getValidItemMatch(combinedText);
      if (!bestMatch) continue;

      const qty = await extractCellQuantity(cell, bWorker, snapshot, grid);

      detectedItemsThisFrame.push({
        name: bestMatch.originalName,
        qty,
        x: cell.cx,
        y: cell.cy,
        cell,
      });

      drawCellDebugOverlay(dCtx, cell, grid, bestMatch.originalName, qty);
    }
  };

  const bWorkers = getBadgeWorkers();

  await Promise.all([
    processChunk(chunks[0], workers[0], bWorkers[0]),
    processChunk(chunks[1], workers[1], bWorkers[1]),
    processChunk(chunks[2], workers[2], bWorkers[2]),
  ]);

  detectedItemsThisFrame.forEach((item) => {
    const existing = sessionInventory.get(item.name) || 0;
    if (item.qty >= existing) sessionInventory.set(item.name, item.qty);
  });

  logDebug(`Scan completo: ${detectedItemsThisFrame.length} items detectados.`);
  const sorted = [...detectedItemsThisFrame].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  if (sorted.length > 0) {
    updateLiveInventoryUI(sorted.at(-1), sorted, grid.cellH * 0.1);
  }

  return debugCanvas.toDataURL("image/jpeg", 0.7);
}

function updateLiveInventoryUI(
  lastFoundItem = null,
  currentFrameItems = [],
  avgU = 10,
) {
  const countDisplay = document.getElementById("live-inv-count");
  if (countDisplay) countDisplay.innerText = sessionInventory.size;

  const listContainer = document.getElementById("live-inventory-items-list");
  if (!listContainer) return;

  if (currentFrameItems.length === 0) {
    if (sessionInventory.size === 0) {
      listContainer.innerHTML = `<div style="text-align:center;color:#444;font-size:0.75em;padding:20px 0;">${TEXTS[state.currentLang].scannerHUD.lblEmpty}</div>`;
    }
    return;
  }

  const sorted = [...currentFrameItems].sort((a, b) => a.y - b.y || a.x - b.x);
  listContainer.innerHTML = sorted
    .map((item) => {
      const shortName = item.name.replaceAll(/prime/gi, "").trim();
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;
          background:rgba(0,229,255,0.04);padding:5px 8px;border-radius:4px;
          border-left:2px solid rgba(0,229,255,0.4);
          font-size:0.78em;gap:6px;">
        <span style="color:#ddd;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${shortName}</span>
        <span style="color:#f1c40f;font-weight:900;flex-shrink:0;">×${item.qty}</span>
      </div>`;
    })
    .join("");

  const scrollGuide = document.getElementById("live-scroll-guide");
  if (scrollGuide && lastFoundItem) {
    const cleanName = lastFoundItem.name.replaceAll(/PRIME/gi, "").trim();
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
  ctx.drawImage(
    video,
    rsCropX,
    rsCropY,
    rsCropW,
    rsCropH,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const { data } = await worker1.recognize(canvas);
  detectRelicSelection(data);
}

async function processRewards(video, width, height, scale) {
  const rCropY = Math.floor(height * 0.18);
  const rCropH = Math.floor(height * 0.50);
  const targetW = Math.floor(width * scale);
  const targetH = Math.floor(rCropH * scale);

  const canvas = virtualCanvas || document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(video, 0, rCropY, width, rCropH, 0, 0, targetW, targetH);

  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = targetW; ocrCanvas.height = targetH;
  const ocrCtx = ocrCanvas.getContext('2d', { willReadFrequently: true }); ocrCtx.drawImage(canvas, 0, 0);


  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = targetW; originalCanvas.height = targetH;
  const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: true }); originalCtx.drawImage(canvas, 0, 0);

  applyClusteringThreshold(ocrCtx, targetW, targetH);
  const { data: pass1Data } = await worker1.recognize(ocrCanvas);
  let finalData = pass1Data;
  let foundItems = parseTextForRewards(pass1Data);
  const metaCount = pass1Data.words.filter(w => /OWNED|CRAFTED|CRAFT/i.test(w.text)).length;

  if (foundItems.length < 2 || foundItems.length < metaCount) {
    const anchorKeywords = new Set(["PRIME", "BLUEPRINT", "OWNED", "CHASSIS", "SYSTEMS", "NEUROPTICS", "HANDLE", "BARREL"]);
    let bestAnchor = null;

    for (const w of pass1Data.words) {
      const text = w.text.toUpperCase().replaceAll(/[^A-Z]/g, '');
      if (anchorKeywords.has(text) && w.confidence > 75) {
        bestAnchor = w;
        break;
      }
    }

    if (bestAnchor) {
      console.log(`[COLOR MATCH] Rescate activado. Ancla: ${bestAnchor.text}`);
      const exactColor = getAnchorColorFromBBox(originalCtx, bestAnchor.bbox);
      ocrCtx.drawImage(originalCanvas, 0, 0);
      applyTargetColorThreshold(ocrCtx, targetW, targetH, exactColor, 75);

      const { data: pass2Data } = await worker1.recognize(ocrCanvas);
      finalData = pass2Data;

      // Re-evaluamos con los datos limpios de la segunda pasada
      foundItems = parseTextForRewards(finalData);
    }
  } else {
    console.log(`[FAST PATH] Pasada 1 exitosa. Saltando corrección de color.`);
  }


  const rawOcr = finalData.text || "";
  console.log("[SCAN] Rewards Raw OCR:", rawOcr);

  clearRewardDebugLogs();
  addRewardDebugLog("OCR", `Text read: ${rawOcr.substring(0, 50)}...`, "info");

  console.log("[SCAN] Rewards Found Items:", foundItems.length);
  addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

  if (foundItems.length > 0 && !detectionLocked) {
    foundItems.forEach(item => {
      addRewardDebugLog("ITEM", `Detected: ${item.name}`, "match");
      const tickX = item.xPos + 50;
      const tickY = item.yPos - 150;
      item.isSelected = detectCheckmark(ocrCanvas, tickX, tickY, 70, 70);
    });

    handleSuccessfulScan(video, width, height, foundItems, rawOcr);
  }
}

function clearRewardDebugLogs() {
  const container = document.getElementById("rewards-raw-ocr-content");
  if (container) container.innerHTML = "";
}

function addRewardDebugLog(tag, msg, type = "info") {
  const container = document.getElementById("rewards-raw-ocr-content");
  if (!container) return;

  const entry = document.createElement("div");
  entry.className = `dbg-log-entry dbg-log-${type}`;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  entry.innerHTML = `
    <span class="dbg-log-time">[${timeStr}]</span>
    <span class="dbg-log-tag">${tag.toUpperCase()}</span>
    <span class="dbg-log-msg">${msg}</span>
  `;

  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

function detectRelicSelection(data) {
  const tiers = ["LITH", "MESO", "NEO", "AXI", "REQUIEM"];
  const text = data.text.toUpperCase();
  const pattern = tiers.join("|");
  const match = new RegExp(
    String.raw`(${pattern})[\s\S]*?([A-Z][0-9]{1,2}|[IVX]+)`,
    "i",
  ).exec(text);
  if (!match) return;

  const tier = match[1].toUpperCase();
  const codeRaw = match[2].trim().replaceAll(/\s+/g, "");
  const isRequiem = tier === "REQUIEM";

  let code = codeRaw;
  if (!isRequiem && code.length >= 2) {
    code = code
      .replaceAll("Z", "2")
      .replaceAll("S", "5")
      .replaceAll("B", "8")
      .replaceAll("G", "6")
      .replaceAll("O", "0")
      .replaceAll(/[IL]/g, "1");
  } else if (isRequiem) {
    code = code
      .replaceAll("1", "I")
      .replaceAll("0", "O")
      .replaceAll("2", "II")
      .replaceAll("3", "III")
      .replaceAll("4", "IV");
  }

  if (code && code.length >= 1) {
    const foundRelic = `${tier} ${code}`.toUpperCase();
    if (foundRelic === lastTrackedRelic) return;
    const exists = state.allRelicNames?.some(
      (n) => n.toUpperCase() === foundRelic,
    );
    if (exists) {
      lastTrackedRelic = foundRelic;
      showTrackConfirm(foundRelic, text);
    }
  }
}

function showTrackConfirm(relicName, rawOcr = "") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const safeId = `track-${relicName.replaceAll(/\s+/g, "-")}`;
  if (document.getElementById(safeId)) return;

  const popup = document.createElement("div");
  popup.id = safeId;
  popup.className = "wf-toast track-confirm-toast";
  popup.style.flexDirection = "column";
  popup.style.alignItems = "stretch";
  popup.style.minWidth = "300px";

  popup.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="relic-icon-mini" style="margin:0;">${relicName.split(" ")[0][0]}</div>
        <span style="font-size:0.9em; font-weight:800; color:var(--wf-blue);">${TEXTS[state.currentLang].scanner.relicDetected}</span>
      </div>
      <span class="toast-close">×</span>
    </div>
    <div style="font-size:1.1em; font-weight:900; color:#fff; margin-bottom:12px; border-left:3px solid var(--wf-blue); padding-left:8px;">${relicName}</div>
    <div class="track-actions" style="display:flex; gap:8px; justify-content:flex-end;">
      <button class="track-btn-no" id="btn-cancel-${safeId}" style="padding:4px 12px; font-size:0.8em;">✕</button>
      <button class="track-btn-yes" id="btn-confirm-${safeId}" style="padding:4px 16px; font-size:0.8em; font-weight:800;">${TEXTS[state.currentLang].scanner.track}</button>
    </div>
    <div id="relic-dbg-${safeId}" class="hidden" style="font-size:9px; color:#ff9800; margin-top:8px; font-family:monospace; background:rgba(0,0,0,0.3); padding:4px; border-radius:4px; border:1px solid rgba(255,152,0,0.2);">
      RAW: ${rawOcr.substring(0, 100)}
    </div>
  `;

  const removeAlert = () => {
    popup.classList.add("fade-out");
    setTimeout(() => popup.remove(), 400);
  };

  container.appendChild(popup);

  popup.querySelector(".toast-close").onclick = removeAlert;
  document.getElementById(`btn-cancel-${safeId}`).onclick = removeAlert;
  document.getElementById(`btn-confirm-${safeId}`).onclick = () => {
    if (globalThis.switchTab) globalThis.switchTab("relic");
    const input = document.getElementById("relicInput");
    if (input) {
      input.value = relicName;
      state.selectedRelic = relicName;
      if (globalThis.manualRelicUpdate) globalThis.manualRelicUpdate();
      showToast(
        TEXTS[state.currentLang].scanner.trackingToast.replace("{relic}", relicName),
        { type: "success" }
      );
    }
    removeAlert();
  };

  setTimeout(removeAlert, 60000);
}

function handleSuccessfulScan(video, width, height, foundItems, rawOcr = "") {
  detectionLocked = true;
  if (!snapshotCanvas) {
    snapshotCanvas = document.createElement("canvas");
    snapshotCtx = snapshotCanvas.getContext("2d");
  }
  snapshotCanvas.width = width;
  snapshotCanvas.height = height;
  snapshotCtx.drawImage(video, 0, 0, width, height);
  const scale = 1080 / height;
  openScanModal(snapshotCanvas.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
}

globalThis.openScanModal = async function (imageUrl, items, width, height, scale, rawOcr = "") {
  const modal = document.getElementById("scan-success-modal");
  const imgEl = document.getElementById("scan-snapshot");
  const badgesContainer = document.getElementById("scan-badges-container");

  if (!modal || !imgEl || !badgesContainer) return;

  currentScanResults = items;

  const syncToggle = document.getElementById("sync-rewards-toggle");
  if (syncToggle) syncToggle.checked = !!state.autoSyncRewards;

  const copyToggle = document.getElementById("auto-copy-toggle");
  if (copyToggle) copyToggle.checked = !!state.autoCopyScanResults;

  if (TEXTS?.[state.currentLang]?.rewardScanner) {
    const tScan = TEXTS[state.currentLang].rewardScanner;
    const syncLabel = modal.querySelector(".sync-toggle-label");
    if (syncLabel) syncLabel.innerText = tScan.autoSyncLabel;
    const copyLabel = modal.querySelector(".copy-toggle-label");
    if (copyLabel) copyLabel.innerText = tScan.autoCopyLabel;
    const helpIcon = modal.querySelector(".help-icon");
    if (helpIcon) helpIcon.dataset.tooltip = tScan.autoSyncTooltip + " | " + tScan.autoCopyTooltip;
  }

  // Hide selection status initially
  const statusMsg = document.getElementById("scan-selection-status");
  if (statusMsg) statusMsg.classList.add("hidden");

  // Si no hay logs (porque no han pasado por add RewardDebugLog), mostramos el rawOcr
  const dbgContent = document.getElementById("rewards-raw-ocr-content");
  if (dbgContent?.children.length === 0) {
    dbgContent.innerText = rawOcr || "NO OCR DATA AVAILABLE";
  }
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  badgesContainer.innerHTML = "";
  imgEl.src = imageUrl;
  modal.classList.remove("hidden");
  autoCloseTimer = setTimeout(() => {
    globalThis.closeScanModal();
  }, AUTO_CLOSE_DELAY_MS);
  if (!globalThis.lastSeenOcrCache) globalThis.lastSeenOcrCache = {};

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
      let ducats = 0;
      if (state.ducatsDatabase) {
        const itemVal = Object.values(state.ducatsDatabase).find(
          (d) => d.name.toUpperCase() === item.name.toUpperCase(),
        );
        if (itemVal) ducats = itemVal.ducats;
      }
      return { ...item, price, ducats, xPos: item.xPos || 0 };
    }),
  );

  currentScanResults = itemsWithDetails;
  console.log("[Auto-Copy] Results stored:", currentScanResults.length);

  const maxPl = Math.max(...itemsWithDetails.map((i) => i.price));

  // Calculate Potential Ducat Value (Direct Ducats vs Market Fodder potential at ~10d/1p)
  const potentialMap = itemsWithDetails.map(item => ({
    ...item,
    potential: Math.max(item.ducats, item.price * 10)
  }));
  const maxPotential = Math.max(...potentialMap.map(i => i.potential));

  requestAnimationFrame(() => {
    const fragment = document.createDocumentFragment();

    const wrapper = document.getElementById("scan-badges-wrapper");
    if (imgEl.clientWidth > 0 && wrapper) {
      const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
      const elRatio = imgEl.clientWidth / imgEl.clientHeight;
      let visualW = imgEl.clientWidth;
      let visualH = imgEl.clientHeight;

      if (imgRatio > elRatio) {
        visualH = visualW / imgRatio;
      } else {
        visualW = visualH * imgRatio;
      }

      wrapper.style.width = `${Math.floor(visualW)}px`;
      wrapper.style.height = `${Math.floor(visualH)}px`;
    }

    // Compute left% from xPos and apply grid fallback if clumped
    let positionedItems = potentialMap.map(item => {
      const referenceW = item.imgW || (width * scale);
      // Si xPos es 0 o muy cercano al centro (indicio de fallback), marcamos para grid
      const isClumped = !item.xPos || Math.abs(item.xPos - (referenceW / 2)) < 5;

      let rawPct = (typeof item.xPos === 'number' && referenceW > 0 && !isClumped)
        ? (item.xPos / referenceW) * 100
        : -1; // -1 significa "usar rejilla"

      return { ...item, leftPct: rawPct };
    }).sort((a, b) => a.leftPct - b.leftPct);

    // Fallback: Si no hay datos espaciales reales, distribuir equitativamente
    const itemsWithoutPos = positionedItems.filter(i => i.leftPct < 0);
    if (itemsWithoutPos.length > 0) {
      positionedItems = positionedItems.map((item, idx) => {
        if (item.leftPct < 0) {
          return { ...item, leftPct: (idx + 0.5) * (100 / positionedItems.length), isGrid: true };
        }
        return item;
      });
    }

    // Anti-overlap: ensure each badge is at least BADGE_GAP_PCT apart
    const BADGE_GAP_PCT = 18;
    for (let i = 1; i < positionedItems.length; i++) {
      const prev = positionedItems[i - 1];
      const curr = positionedItems[i];
      if (prev.leftPct !== null && curr.leftPct !== null) {
        if (curr.leftPct - prev.leftPct < BADGE_GAP_PCT) {
          curr.leftPct = prev.leftPct + BADGE_GAP_PCT;
        }
      }
    }
    // Clamp all within 2%–98%
    positionedItems.forEach(item => {
      if (item.leftPct !== null) item.leftPct = Math.min(98, Math.max(2, item.leftPct));
    });

    positionedItems.forEach((item) => {
      const currentAppCount = state.primeInventory ? (state.primeInventory[item.name] || 0) : 0;
      const isCurrentlySelected = item.name && selectedScanItem &&
        item.name.toUpperCase().trim() === selectedScanItem.toUpperCase().trim();
      const isCompletingSet = canItemCompleteSet(item.name);

      createModalBadge(
        {
          name: item.name,
          price: item.price,
          ducats: item.ducats,
          owned: item.owned,
          appOwned: currentAppCount,
          crafted: item.crafted,
          isSelected: isCurrentlySelected,
          isBestPl: item.price === maxPl && item.price > 0,
          isBestEff: item.potential === maxPotential && item.potential > 0,
          isCompletingSet: isCompletingSet,
          leftPct: item.leftPct,
        },
        fragment,
      );
    });

    badgesContainer.innerHTML = "";
    badgesContainer.appendChild(fragment);

    if (state.autoCopyScanResults) {
      console.log("[Auto-Copy] Triggering copy...");
      setTimeout(() => globalThis.copyScanResultsToClipboard(true), 100);
    }
  });

}
//todo fix 
function createModalBadge(
  { name, price, ducats, owned, appOwned, crafted, isSelected, isBestPl, isBestEff, isCompletingSet, leftPct, isGrid },
  container,
) {
  const badge = document.createElement("div");
  badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestEff ? "best-duc" : ""} ${isSelected ? "selected-reward" : ""}`;

  if (leftPct !== null && leftPct !== undefined) {
    badge.style.left = `${leftPct}%`;
  }

  const mode = isGrid ? "GRID" : "REAL";
  const diagnosticHtml = `<div style="position:absolute; bottom:5px; left:0; width:100%; font-size:8px; color:rgba(255,255,255,0.4); pointer-events:none; text-align:center;">${mode}: ${Math.round(leftPct)}%</div>`;

  const displayName = name.toUpperCase();

  const labels = {
    es: { add: "✓ AÑADIR AL INVENTARIO", owned: "Vista", crafted: "Forja", inv: "PROPIO", bestPl: "¡MEJOR PLAT!", bestDuc: "¡MEJOR DUCAT!", completes: "¡COMPLETA SET!" },
    en: { add: "✓ ADD TO INVENTORY", owned: "Seen", crafted: "Forge", inv: "OWNED", bestPl: "BEST PLAT!", bestDuc: "BEST DUCAT!", completes: "COMPLETES SET!" }
  };
  const lang = state.currentLang === "en" ? "en" : "es";
  const t = labels[lang];

  const isForma = name.toUpperCase().includes("FORMA");

  let tagsHtml = "";
  if (isBestPl) tagsHtml += `<div class="best-badge pl">${t.bestPl}</div>`;
  if (isBestEff && !isForma) tagsHtml += `<div class="best-badge duc">${t.bestDuc}</div>`;
  if (isCompletingSet) tagsHtml += `<div class="best-badge set-finisher">${t.completes}</div>`;

  const bestLabelHtml = tagsHtml ? `<div class="modal-badge-labels">${tagsHtml}</div>` : "";

  let metadataHtml = "";
  metadataHtml = `
    <div class="metadata-row">
        <div class="inventory-app-count" style="background: rgba(0, 255, 120, 0.15); border-color: #00ff78;">
            ${t.owned.toUpperCase()}: <span class="metadata-seen" style="font-size: 14px;">${owned > 0 ? owned : 0}</span>
        </div>
        <div style="display:flex; justify-content:center; gap:12px; margin-top:6px; font-size:10px; font-weight:700;">
          <span style="color: #00e5ff;" class="app-owned-val" data-part="${escapeHTML(name)}">${t.inv}: ${appOwned}</span>
        </div>
    </div>`;

  const selectionHtml = isSelected
    ? '<div style="background:#00ff78; color:#000; font-size:8px; padding:1px 4px; border-radius:3px; margin-top:2px; font-weight:bold; display:inline-block; box-shadow:0 0 10px rgba(0,255,120,0.5);">✓</div>'
    : '';

  if (!isForma) {
    badge.onclick = () => {
      if (typeof globalThis.selectRewardToInventory === 'function') {
        globalThis.selectRewardToInventory(name);
      }
    };
  }

  badge.innerHTML = String.raw`
        ${diagnosticHtml}
        ${bestLabelHtml}
        <div class="modal-badge-link">
          <div class="modal-badge-content-wrapper">
            ${metadataHtml}
            <div class="modal-badge-name">${displayName}</div>
            
            <div class="modal-badge-row">
                <div class="modal-badge-price">
                    <img src="assets/relic_contents/platinum.webp" class="currency-icon">
                    ${price > 0 ? price : "—"}
                </div>
                ${ducats > 0
      ? `<div class="modal-badge-ducats">
                        <img src="assets/Ducats.webp" class="currency-icon">
                        ${ducats}
                    </div>`
      : ""
    }
            </div>
          </div>
          
          ${!isForma ? `<div class="badge-add-inventory-hint">${t.add}</div>` : ''}
          ${selectionHtml ? `<div style="position:absolute; top:-10px; right:-10px; z-index:110;">${selectionHtml}</div>` : ''}
        </div>`;

  if (price === 0) badge.classList.add('loading-price');

  container.appendChild(badge);
}

globalThis.copyScanResultsToClipboard = function (isAuto = false) {
  if (!currentScanResults || currentScanResults.length === 0) {
    if (!isAuto) showToast("No rewards to copy!");
    console.warn("[Auto-Copy] No results available to copy.");
    return;
  }

  const lang = state.currentLang === "en" ? "en" : "es";

  const parts = currentScanResults.map(item => {
    const displayName = item.name || "Unknown Item";
    const name = `[${displayName}]`;
    const pl = item.price > 0 ? `${item.price} :platinum:` : "";
    const duc = item.ducats > 0 ? `${item.ducats} :ducats:` : "";
    return `${name} ${pl} ${duc}`.trim();
  });

  const text = parts.join(" | ");

  const finalizeCopy = (success) => {
    if (success) {
      console.log("[Auto-Copy] Success!");
      showToast(lang === "en" ? "Results copied to clipboard!" : "Resultados copiados al portapapeles!", { type: "success" });
    } else {
      console.error("[Auto-Copy] Failed");
      if (!isAuto) {
        showToast("Failed to copy results", { type: "error" });
      } else if (!document.hasFocus()) {
        console.warn("[Auto-Copy] Blocked: Document not focused.");
        showToast(lang === "en" ? "Focus app to copy automatically!" : "¡Focaliza la app para copiar!", { type: "warn" });
      }
    }
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => finalizeCopy(true)).catch(err => {
      console.warn("[Auto-Copy] navigator.clipboard failed, trying fallback...", err);
      fallbackCopyTextToClipboard(text, finalizeCopy);
    });
  } else {
    fallbackCopyTextToClipboard(text, finalizeCopy);
  }
};


function fallbackCopyTextToClipboard(text, callback) {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "0";
    textArea.style.top = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    textArea.style.opacity = "0.01";
    textArea.style.zIndex = "-1";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    //TODO FIX THIS no funciona como queria dfe todas formasw
    const successful = document.execCommand('copy');
    textArea.remove();

    if (!successful) {
      console.warn("[Auto-Copy] execCommand('copy') returned false.");
    }
    callback(successful);
  } catch (err) {
    console.error("[Auto-Copy] Fallback critical failure:", err);
    callback(false);
  }
}


globalThis.toggleAutoCopyScanResults = function (val) {
  state.autoCopyScanResults = val;
  if (globalThis.saveAppState) globalThis.saveAppState();
  showToast(`Auto-Copy: ${val ? "ON" : "OFF"}`);
};

globalThis.saveLiveInventory = function () {
  if (sessionInventory.size === 0) return showToast("No items detected");
  for (const [name, count] of sessionInventory) {
    state.primeInventory[name] = count;
  }

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
    if (typeof showToast === "function")
      showToast("No debug logs collected yet.");
    else alert("No debug logs collected yet.");
    return;
  }
  const text = debugLogArchive.join("\n");
  navigator.clipboard
    .writeText(text)
    .then(() => {
      if (typeof showToast === "function")
        showToast("Diagnostic log copied to clipboard!");
      else alert("Diagnostic log copied to clipboard!");
    })
    .catch((err) => {
      console.error("Copy failed", err);
    });
}

globalThis.stopLiveSession = stopLiveSession;
let currentScanResults = [];
let selectedScanItem = null;
//TODO: Fix this
globalThis.closeScanModal = function () {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);

  const successModal = document.getElementById("scan-success-modal");
  if (successModal) successModal.classList.add("hidden");

  detectionLocked = false;

  if (currentScanResults.length > 0 && state?.primeInventory) {
    // TODO: Fix this
    let anyChange = false; state !== undefined
    const normalizedSelection = selectedScanItem ? selectedScanItem.toUpperCase().trim() : null;

    currentScanResults.forEach(item => {
      if (item.name && typeof item.owned === 'number' && item.owned >= 0) {
        const itemNameNorm = item.name.toUpperCase().trim();
        const isSelected = normalizedSelection && itemNameNorm === normalizedSelection;

        if (state.autoSyncRewards) {
          const targetQty = item.owned + (isSelected ? 1 : 0);
          if (state.primeInventory[item.name] !== targetQty) {
            state.primeInventory[item.name] = targetQty;
            anyChange = true;
            addRewardDebugLog("AUTO_SYNC", `${item.name}: synced to ${targetQty}${isSelected ? ' (+1 selected)' : ''}`, "match");
          }
        } else {
          if (isSelected) {
            const currentQty = state.primeInventory[item.name] || 0;
            state.primeInventory[item.name] = currentQty + 1;
            anyChange = true;
            addRewardDebugLog("MANUAL_ADD", `${item.name}: +1 (App New: ${currentQty + 1})`, "match");
          }
        }
      }
    });
    if (anyChange) {
      if (typeof globalThis.saveAppState === "function") globalThis.saveAppState();
      if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    }
  }
  //TODO  FIX THIS  
  if (selectedScanItem && typeof globalThis.showToast === "function") {
    const t = (typeof TEXTS !== 'undefined') ? TEXTS[state.currentLang] : null;
    let msg = `TEXTS !== undefinedse()} SELECCIONADA +1`; // Fallback
    if (t?.rewardScanner?.rewardSelectedConfirmation) {
      msg = t.rewardScanner.rewardSelectedConfirmation.replace("{item}", selectedScanItem.toUpperCase());
    }
    globalThis.showToast(msg);
  }

  currentScanResults = [];
  selectedScanItem = null;
};

globalThis.selectRewardToInventory = function (itemName) {
  selectedScanItem = itemName;

  const modal = document.getElementById("scan-success-modal");
  if (modal) {
    modal.querySelectorAll('.modal-badge').forEach(b => b.classList.remove('selected-reward'));
    const badges = modal.querySelectorAll('.modal-badge');
    badges.forEach(b => {
      if (b.innerText.toUpperCase().includes(itemName.toUpperCase().trim())) {
        b.classList.add('selected-reward');

        const ownedValSpan = b.querySelector('.app-owned-val');
        if (ownedValSpan) {
          const rawOcr = b.querySelector('.metadata-seen')?.innerText || "0";
          const seen = Number.parseInt(rawOcr) || 0;
          const labelPrefix = ownedValSpan.innerText.split(':')[0];
          ownedValSpan.innerText = `${labelPrefix}: ${seen + 1}`;
        }
      }
    });
  }

  if (typeof showToast === "function") showToast(`SELECCIONADO: ${itemName}`);
  addRewardDebugLog("SELECT", `Reward selected (sync pending close): ${itemName}`, "match");

  setTimeout(() => globalThis.closeScanModal(), 600);
};

globalThis.toggleRewardsAutoSync = function (val) {
  state.autoSyncRewards = val;
  if (globalThis.saveAppState) globalThis.saveAppState();
  showToast(`Auto-Sync: ${val ? "ON" : "OFF"}`);
};


globalThis.manualPrecisionScan = async function () {
  const video = document.getElementById("live-video");
  if (!video || !liveStream?.active) return showToast("Scanner not active");

  _preSessionItemNames = new Set(sessionInventory.keys());
  isScanning = true;

  try {
    const msgEl = document.getElementById("live-inv-msg");
    if (msgEl) msgEl.innerText = "S-C-A-N-N-I-N-G...";

    const diagnosticUrl = await performTwoPassScan(video, msgEl);

    if (DEBUG_MODE) updateDebugUI(diagnosticUrl);

    updatePostScanUI(msgEl);
    showToast("Página escaneada con éxito");
  } catch (e) {
    console.error("Manual scan failed:", e);
    showToast("Scan failed: " + e.message);
  } finally {
    isScanning = false;
  }
};

async function waitForScannerReady() {
  if (!isScanning) return true;
  let waited = 0;
  while (isScanning && waited < 2000) {
    await new Promise((r) => setTimeout(r, 200));
    waited += 200;
  }
  return !isScanning;
}

async function performTwoPassScan(video, msgEl) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const scale = 1080 / height;

  snapshotCanvas.width = width;
  snapshotCanvas.height = height;
  snapshotCtx.drawImage(video, 0, 0);

  if (msgEl) msgEl.innerText = "SCANNING 1/2...";
  await processInventoryGrid(snapshotCanvas, width, height, scale);

  if (msgEl) msgEl.innerText = "SCANNING 2/2...";
  const diagnosticUrl = await processInventoryGrid(
    snapshotCanvas,
    width,
    height,
    scale,
  );

  if (msgEl) msgEl.innerText = "DONE";

  return diagnosticUrl;
}

function updateDebugUI(diagnosticUrl) {
  const dbgImg = document.getElementById("live-debug-snapshot-img");
  const dbgPanel = document.getElementById("live-debug-snapshot");
  if (dbgImg) {
    dbgImg.src = diagnosticUrl;
    dbgImg.style.display = "block";
  }
  if (dbgPanel) dbgPanel.style.display = "block";
}

function updatePostScanUI(msgEl) {
  const newItems = [...sessionInventory.keys()].filter(
    (k) => !_preSessionItemNames.has(k),
  );
  const newCount = newItems.length;
  const totalNow = sessionInventory.size;
  const scrollGuide = document.getElementById("live-scroll-guide");

  if (newCount > 0) {
    renderNewItemsFoundUI(msgEl, scrollGuide, newCount);
  } else {
    renderNoNewItemsUI(msgEl, scrollGuide, totalNow);
  }
}

function renderNewItemsFoundUI(msgEl, scrollGuide, newCount) {
  const sh = TEXTS[state.currentLang].scannerHUD;
  if (msgEl) msgEl.innerText = `+${newCount} ${state.currentLang === 'es' ? 'NUEVOS' : 'NEW'}`;
  if (scrollGuide) {
    scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#f1c40f;font-weight:800;font-size:0.85em;">${sh.lblNewItemsFound.replace("{count}", newCount)}</div>
          <div style="color:#506070;margin:3px 0;">${sh.btnScrollManualScan}</div>
          <div style="display:flex;gap:5px;margin-top:5px;">
            <button onclick="globalThis.manualPrecisionScan()" style="flex:1;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.4);color:#00e5ff;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;font-weight:700;">${sh.btnScanNext}</button>
            <button onclick="globalThis.inventoryScanDone()" style="flex:1;background:none;border:1px solid rgba(255,255,255,0.1);color:#506070;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;">${sh.btnDone}</button>
          </div>
        </div>`;
  }
}

function renderNoNewItemsUI(msgEl, scrollGuide, totalNow) {
  if (msgEl) msgEl.innerText = `${totalNow} ITEMS`;
  if (scrollGuide) {
    const sh = TEXTS[state.currentLang].scannerHUD;
    scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#a0c0b0;font-weight:800;font-size:0.85em;">${sh.lblNoNewItems}</div>
          <div style="color:#506070;margin:3px 0;">${sh.lblTotalUnique.replace("{total}", totalNow)}</div>
          <button onclick="globalThis.inventoryScanDone()" style="width:100%;margin-top:5px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.3);color:#7cada8;font-size:0.75em;padding:5px;border-radius:4px;cursor:pointer;font-weight:700;">${sh.btnFinishedSave}</button>
        </div>`;
  }
}
async function extractCellText(cell, worker, ocrCanvas, grid) {
  const textCvs = createTextCanvas(ocrCanvas, cell, grid);
  const {
    data: { words },
  } = await worker.recognize(textCvs);

  if (words.length < 1) return null;
  return words.map((w) => w.text.toUpperCase());
}

function handleDebugLogging(cell, combinedText) {
  if (DEBUG_MODE) {
    logDebug(
      `[CELL r${cell.r}c${cell.c}] OCR words: [${combinedText.join(", ")}]`,
    );
  }
}

function getValidItemMatch(combinedText) {
  const matchOpts = findBestItemMatch(combinedText);
  const bestMatch = matchOpts?.item || matchOpts?.bestMatch;
  const score = matchOpts?.score || matchOpts?.highestRatio || 0;

  if (!bestMatch || score < 0.45) return null;
  return bestMatch;
}
async function extractCellQuantity(cell, bWorker, snapshot, grid) {
  const badgeCvs = createBadgeCanvas(snapshot, cell, grid);
  const {
    data: { words: badgeWords },
  } = await bWorker.recognize(badgeCvs);

  const badgeNums = badgeWords.filter((w) => /\d/.test(w.text));
  if (badgeNums.length === 0) return 1;

  badgeNums.sort((a, b) => b.bbox.x0 - a.bbox.x0);
  const pureDigit = badgeNums[0].text.replaceAll(/\D/g, "");

  if (pureDigit && pureDigit.length > 0) {
    const val = Number.parseInt(pureDigit);
    return val > 1 && val < 1000 ? val : 1;
  }
  return 1;
}

function drawCellDebugOverlay(dCtx, cell, grid, originalName, qty) {
  dCtx.strokeStyle = "#ffff00";
  dCtx.lineWidth = 2;
  dCtx.strokeRect(cell.sx, cell.sy, grid.cellW, grid.cellH);
  dCtx.fillStyle = "#ffe000";
  dCtx.font = "bold 11px Arial";

  const shortName = originalName.replace("PRIME ", "").substring(0, 18);
  dCtx.fillText(`${shortName} x${qty}`, cell.sx + 4, cell.sy + 15);
}
globalThis.inventoryScanDone = function () {
  const scrollGuide = document.getElementById("live-scroll-guide");
  const msgEl = document.getElementById("live-inv-msg");
  const sh = TEXTS[state.currentLang].scannerHUD;

  if (msgEl) msgEl.innerText = `${sessionInventory.size} ITEMS`;
  if (scrollGuide)
    scrollGuide.innerHTML = `<span style="color:#a0c0b0;">${sh.lblTotalUnique.replace("{total}", sessionInventory.size)}</span>`;

  showToast(
    sh.toastScanComplete.replace("{count}", sessionInventory.size),
    { type: "success" }
  );
};
/**
 * Extrae el color RGB promedio del texto dentro de un Bounding Box de Tesseract.
 * Busca los píxeles más brillantes (texto) ignorando el fondo oscuro.
 */
export function getAnchorColorFromBBox(originalCtx, bbox) {
  const w = Math.max(1, bbox.x1 - bbox.x0);
  const h = Math.max(1, bbox.y1 - bbox.y0);

  const imgData = originalCtx.getImageData(bbox.x0, bbox.y0, w, h).data;
  let pixels = [];

  for (let i = 0; i < imgData.length; i += 4) {
    let r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
    let luma = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
    pixels.push({ r, g, b, luma });
  }
  pixels.sort((a, b) => b.luma - a.luma);
  const topCount = Math.max(1, Math.floor(pixels.length * 0.10));
  let sumR = 0, sumG = 0, sumB = 0;

  for (let i = 0; i < topCount; i++) {
    sumR += pixels[i].r;
    sumG += pixels[i].g;
    sumB += pixels[i].b;
  }

  return {
    r: Math.floor(sumR / topCount),
    g: Math.floor(sumG / topCount),
    b: Math.floor(sumB / topCount)
  };
}

/**
 * Binarización Estricta por Color. 
 */
export function applyTargetColorThreshold(ctx, w, h, targetColor, tolerance = 70) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;

  const tolSq = tolerance * tolerance;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    let dr = r - targetColor.r;
    let dg = g - targetColor.g;
    let db = b - targetColor.b;
    let distSq = (dr * dr) + (dg * dg) + (db * db);
    if (distSq < tolSq) {
      px[i] = px[i + 1] = px[i + 2] = 0;
    } else {
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}