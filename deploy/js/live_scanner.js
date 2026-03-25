import { state } from "./state.js";
import { getPriceValue, getSlug } from "./api.js";
import { showToast } from "./ui.components/ui_components.js";
import { TEXTS } from "./config.js";
import {
  initOcrWorkers,
  stopOcrWorkers,
  getBadgeWorkers,
  initScannerMatcherData,
  findBestItemMatch,
  parseTextForItems,
} from "./scanner_ocr.js";
import {
  getFrameHash,
  createFilteredOcrCanvas,
  createTextCanvas,
  createBadgeCanvas,
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
const AUTO_CLOSE_DELAY_MS = 12000;
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

    const sCtx = sampleCvs.getContext("2d");
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
let trackingDebounce = 0;
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
    logDebug("Header OCR:", headerText);

    const contextType = determineContext(headerText);
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

  vCtx.filter = "grayscale(100%) brightness(1.3) contrast(200%)";
  vCtx.drawImage(
    video,
    0,
    0,
    width,
    hCropH,
    0,
    0,
    virtualCanvas.width,
    virtualCanvas.height,
  );

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
    // Keep last detected message, only clear the list if it's really the start
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
  const rCropY = Math.floor(height * 0.3);
  const rCropH = Math.floor(height * 0.35);
  const targetW = Math.floor(width * scale) * 1.5;
  const targetH = Math.floor(rCropH * scale) * 1.5;

  const canvas = virtualCanvas || document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
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
      showToast(
        TEXTS[state.currentLang].scanner.trackingToast.replace(
          "{relic}",
          relicName,
        ),
      );
    }
    popup.remove();
  };
  setTimeout(() => {
    if (popup.parentElement) popup.classList.add("fade-out");
  }, 10000);
  setTimeout(() => {
    if (popup.parentElement) popup.remove();
  }, 10500);
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
      let ducats = 0;
      if (state.ducatsDatabase) {
        const itemData = Object.values(state.ducatsDatabase).find(
          (d) => d.name.toUpperCase() === item.name.toUpperCase(),
        );
        if (itemData) ducats = itemData.ducats;
      }
      return { ...item, price, ducats };
    }),
  );
  const maxPl = Math.max(...itemsWithDetails.map((i) => i.price));
  const maxDuc = Math.max(...itemsWithDetails.map((i) => i.ducats));
  requestAnimationFrame(() => {
    const cvsHeight = virtualCanvas ? virtualCanvas.height : 100;
    const cvsWidth = virtualCanvas ? virtualCanvas.width : 1000;
    const fragment = document.createDocumentFragment();
    
    itemsWithDetails.forEach((item) => {
      const leftPercent = (item.xPos / cvsWidth) * 100;
      const topPercent = ((item.yPos + 35) / cvsHeight) * 100;
      createModalBadge(
        {
          name: item.name,
          price: item.price,
          ducats: item.ducats,
          leftPercent: leftPercent,
          topPercent: topPercent,
          isBestPl: item.price === maxPl && item.price > 0,
          isBestDuc: item.ducats === maxDuc && item.ducats > 0,
        },
        fragment,
      );
    });
    
    badgesContainer.innerHTML = "";
    badgesContainer.appendChild(fragment);
  });
}

function createModalBadge(
  { name, price, ducats, leftPercent, topPercent, isBestPl, isBestDuc },
  container,
) {
  const badge = document.createElement("div");
  badge.className = `modal-badge ${isBestPl ? "best-pl" : ""} ${isBestDuc ? "best-duc" : ""}`;
  const clampedLeft = Math.max(8, Math.min(92, leftPercent));

  badge.style.left = `${clampedLeft}%`;
  badge.style.top = `${Math.min(90, topPercent)}%`;

  const slug = getSlug(name);
  const cleanName = name
    .replaceAll(/PRIME/gi, "")
    .replaceAll(/BLUEPRINT/gi, "BP")
    .replaceAll(/NEUROPTICS/gi, "NEURO")
    .replaceAll(/SYSTEMS/gi, "SYS")
    .replaceAll(/CHASSIS/gi, "CHAS")
    .trim();

  badge.innerHTML = `
    <a href="https://warframe.market/items/${slug}" target="_blank" class="modal-badge-link" style="display:block; text-decoration:none;">
        <div class="modal-badge-name" style="font-size:10px; color:#aaa; font-weight:bold; margin-bottom:4px; text-transform:uppercase;">${cleanName}</div>
        <div class="modal-badge-row" style="display:flex; justify-content:center; align-items:center; gap:10px; font-weight:bold;">
            <div class="modal-badge-price" style="display:flex; align-items:center; gap:2px; font-size:14px; color:#f1c40f;">
                <img src="assets/relic_contents/platinum.webp" style="width:14px; height:14px;">
                ${price > 0 ? price : "--"} pl
            </div>
            ${
              ducats > 0
                ? `<div class="modal-badge-ducats" style="display:flex; align-items:center; gap:3px; font-size:13px; color:#D4AF37;">
                   <img src="assets/Ducats.webp" class="ducat-icon" style="width:16px; height:16px;">
                   ${ducats}
                </div>`
                : ""
            }
        </div>
    </a>`;

  container.appendChild(badge);
}
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
globalThis.isScannerActive = () => !!liveStream?.active;
globalThis.copyScannerDebugLog = copyScannerDebugLog;
globalThis.closeScanModal = function () {
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  const modal = document.getElementById("scan-success-modal");
  if (modal) modal.classList.add("hidden");
  detectionLocked = false;
};

globalThis.manualPrecisionScan = async function () {
  const video = document.getElementById("live-video");
  if (!video || !liveStream?.active) return showToast("Scanner not active");

  _preSessionItemNames = new Set(sessionInventory.keys());
  isScanning = true;

  try {
    const msgEl = document.getElementById("live-inv-msg");
    if (msgEl) msgEl.innerText = "S-C-A-N-N-I-N-G...";
    
    // Perform two pass scan for accuracy
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
  if (msgEl) msgEl.innerText = `+${newCount} NEW`;
  if (scrollGuide) {
    scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#f1c40f;font-weight:800;font-size:0.85em;">↓ ${newCount} NEW ITEM${newCount > 1 ? "S" : ""} FOUND</div>
          <div style="color:#506070;margin:3px 0;">Scroll down, then press SCAN PAGE again.</div>
          <div style="display:flex;gap:5px;margin-top:5px;">
            <button onclick="globalThis.manualPrecisionScan()" style="flex:1;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.4);color:#00e5ff;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;font-weight:700;">↓ SCAN NEXT</button>
            <button onclick="globalThis.inventoryScanDone()" style="flex:1;background:none;border:1px solid rgba(255,255,255,0.1);color:#506070;font-size:0.7em;padding:4px;border-radius:4px;cursor:pointer;">✓ DONE</button>
          </div>
        </div>`;
  }
}

function renderNoNewItemsUI(msgEl, scrollGuide, totalNow) {
  if (msgEl) msgEl.innerText = `${totalNow} ITEMS`;
  if (scrollGuide) {
    scrollGuide.innerHTML = `
        <div style="line-height:1.5;">
          <div style="color:#a0c0b0;font-weight:800;font-size:0.85em;">✓ No new items on this page</div>
          <div style="color:#506070;margin:3px 0;">${totalNow} total unique items found.</div>
          <button onclick="globalThis.inventoryScanDone()" style="width:100%;margin-top:5px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.3);color:#7cada8;font-size:0.7em;padding:5px;border-radius:4px;cursor:pointer;font-weight:700;">✓ FINISHED — SAVE INVENTORY</button>
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
  if (!matchOpts.bestMatch || matchOpts.highestRatio < 0.45) return null;
  return matchOpts.bestMatch;
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
  if (msgEl) msgEl.innerText = `${sessionInventory.size} ITEMS`;
  if (scrollGuide)
    scrollGuide.innerHTML = `<span style="color:#a0c0b0;">✓ Scan complete — ${sessionInventory.size} unique items</span>`;
  showToast(
    `Scan complete! ${sessionInventory.size} unique Prime items found.`,
  );
};
