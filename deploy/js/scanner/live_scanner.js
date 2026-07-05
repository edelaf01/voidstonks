import { state, saveAppState } from "../state.js";
import { showToast } from "../ui.components/ui_components.js";
import { TEXTS } from "../config.js";
import { warmupPrices } from "../api.js";
import { ScannerService } from "../services/scanner.service.js";
import { OCRService } from "../services/ocr.service.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { WF_THEMES } from "../services/vision.service.js";

globalThis._OCRService = OCRService;
globalThis._ScannerModal = ScannerModal;
globalThis._OCRRepository = OCRRepository;
globalThis._WF_THEMES = WF_THEMES;

let DEBUG_MODE = false;

/**
 * Toggles debug mode for the scanner, showing/hiding technical overlays.
 */
globalThis.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  globalThis._scannerDebug = DEBUG_MODE;
  const btn = document.getElementById("btn-debug-toggle");
  if (btn) btn.classList.toggle("active", DEBUG_MODE);
  const dbgPanel = document.getElementById("live-debug-snapshot");
  if (dbgPanel) dbgPanel.style.display = DEBUG_MODE ? "block" : "none";

  showToast(DEBUG_MODE ? "Debug mode ON" : "Debug mode OFF");
};

/**
 * Copies the current scan session info to the clipboard for debugging.
 */
globalThis.copyScannerDebugLog = async () => {
  try {
    let logLines = ["=== VOIDSTONKS SCANNER DEBUG LOG ===", `Timestamp: ${new Date().toISOString()}`];

    const inv = globalThis.ScannerService?.sessionInventory;
    if (inv && inv.size > 0) {
      logLines.push(`\n[Inventory Scan Cache]`);
      for (const [name, qty] of inv) {
        logLines.push(`${name}: x${qty}`);
      }
    } else {
      logLines.push("\n[Inventory Scan Cache]: EMPTY");
    }

    const rawOcr = globalThis.ScannerService?.lastRawOcrLog;
    if (rawOcr && rawOcr.length > 0) {
      logLines.push("\n[RAW OCR Per Cell]", rawOcr.sort().join("\n"));
    }

    const logText = logLines.join("\n");
    await navigator.clipboard.writeText(logText);
  } catch (e) {
    showToast("Error copiando log");
    console.error(e);
  }
};

let liveStream = null;
let isStartingSession = false;

/**
 * Starts a live scanning session by capturing display media.
 */
export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;

  const toggleBtn = document.getElementById("scanner-toggle");
  const t = TEXTS[state.currentLang].scanner;

  if (toggleBtn) {
    toggleBtn.classList.add("active");
    toggleBtn.querySelector(".label").innerText = t.starting;
  }

  try {
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", displaySurface: "window", frameRate: { ideal: 10, max: 15 } },
      audio: false,
    });

    const video = document.getElementById("live-video");
    video.srcObject = liveStream;
    await video.play();

    const drawer = document.getElementById("scanner-drawer");
    if (drawer) {
      drawer.classList.remove("closed");
      drawer.classList.add("open");
    }

    globalThis.syncScannerModeUI();
    await ScannerService.start();
    showToast(t.toastActive);

    if (toggleBtn) toggleBtn.querySelector(".label").innerText = t.active;

    liveStream.getVideoTracks()[0].onended = () => stopLiveSession();
  } catch (e) {
    console.error("Scanner startup failed:", e);
    showToast("Error: " + e.message);
    stopLiveSession();
  } finally {
    isStartingSession = false;
  }
}

/**
 * Stops the live scanning session and cleans up resources.
 */
export function stopLiveSession() {
  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }
  ScannerService.stop();
  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.remove("active");
    const label = toggleBtn.querySelector(".label");
    if (label) label.innerText = "LIVE SCANNER";
  }
  const drawer = document.getElementById("scanner-drawer");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.classList.add("closed");
  }
  if (globalThis.RivenScannerHUD) {
    globalThis.RivenScannerHUD.dismiss();
  }
}

/**
 * UI Hook called by ScannerService when Riven card(s) are parsed.
 */
globalThis.showRivenAppraisal = async (parsedL, parsedR, screenshotDataURL) => {
  const { RivenScannerHUD } = await import("../ui.components/ui_riven_scanner_hud.js");
  RivenScannerHUD.show(parsedL, parsedR, screenshotDataURL);
};

/**
 * UI Hook called by ScannerService when a relic is detected.
 */
globalThis.showTrackConfirm = (relicName) => {
  const t = TEXTS[state.currentLang].scanner;
  showToast(`${t.relicDetected}: ${relicName}`, {
    action: {
      text: t.track,
      callback: () => {
        if (globalThis.trackRelic) globalThis.trackRelic(relicName);
        showToast(t.trackingToast.replace("{relic}", relicName));
      }
    }
  });
};

/**
 * UI Hook called when a user selects a reward from the modal or PiP.
 */
globalThis.selectRewardToInventory = (itemName) => {
  const modal = globalThis.ScannerModal;
  if (modal) modal.selectedItem = itemName;
  globalThis.selectedScanItem = itemName;

  const t = TEXTS[state.currentLang].rewardScanner;
  const msg = t.rewardSelectedConfirmation
    ? t.rewardSelectedConfirmation.replace("{item}", itemName)
    : `Seleccionado: ${itemName}`;
  showToast(msg);

  const willSyncInClose = state.autoSyncRewards && modal && modal.currentResults && !modal.isHistoric;
  if (!willSyncInClose) {
    state.primeInventory[itemName] = (state.primeInventory[itemName] || 0) + 1;
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
  }
};

/**
 * Saves detected inventory items from the current session to the app state.
 */
globalThis.saveLiveInventory = () => {
  const sh = TEXTS[state.currentLang].scannerHUD;
  for (const [name, count] of ScannerService.sessionInventory) {
    state.primeInventory[name] = count;
  }
  ScannerService.sessionInventory.clear();
  showToast(sh.saved);
  saveAppState();

  if (typeof warmupPrices === "function") {
    warmupPrices().catch(console.error);
  }

  if (globalThis.renderInventory) globalThis.renderInventory();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
};

/**
 * Triggers a manual, high-precision inventory grid scan.
 */
globalThis.manualPrecisionScan = async () => {
  if (!liveStream?.active) return showToast("START SCANNER FIRST");
  state.isPrecisionScanActive = true;
  const sh = TEXTS[state.currentLang].scannerHUD;
  showToast(sh.autoScanScanning);

  const video = document.getElementById("live-video");
  const snapshot = document.createElement("canvas");
  snapshot.width = video.videoWidth; snapshot.height = video.videoHeight;
  snapshot.getContext("2d").drawImage(video, 0, 0);

  await ScannerService.processInventoryGrid(snapshot, video.videoWidth, video.videoHeight, video.videoHeight / 1080);
  state.isPrecisionScanActive = false;
};

/**
 * Toggles the auto-scan mode when scrolling in the inventory.
 */
globalThis.toggleAutoScrollScan = () => {
  state.autoScanEnabled = !state.autoScanEnabled;
  const btn = document.getElementById("btn-auto-scan");
  if (btn) {
    btn.dataset.active = state.autoScanEnabled ? "1" : "0";
    btn.style.color = state.autoScanEnabled ? "#00ff78" : "#4a7a5a";
    btn.style.borderColor = state.autoScanEnabled ? "#00ff78" : "rgba(0,255,120,0.25)";
    btn.style.background = state.autoScanEnabled ? "rgba(0,255,120,0.15)" : "rgba(0,255,120,0.06)";
  }
  const sh2 = TEXTS[state.currentLang].scannerHUD;
  showToast(state.autoScanEnabled ? sh2.autoScanOn : sh2.autoScanOff);
};

// Global exports for UI button interactions
globalThis.startLiveSession = startLiveSession;
globalThis.stopLiveSession = stopLiveSession;
globalThis.toggleScanner = () => {
  if (liveStream?.active) stopLiveSession();
  else startLiveSession();
};

/**
 * Changes active scan sub-mode between Prime and Riven scanning.
 */
globalThis.setScannerMode = (mode) => {
  state.scannerModsMode = (mode === "mods");
  saveAppState();
  globalThis.syncScannerModeUI();
  showToast(state.currentLang === "es" 
    ? (mode === "prime" ? "Modo Prime activado" : "Modo Riven activado")
    : (mode === "prime" ? "Prime mode active" : "Riven mode active")
  );
};

/**
 * Updates toggle visual styles based on state.scannerModsMode.
 */
globalThis.syncScannerModeUI = () => {
  const mode = state.scannerModsMode ? "mods" : "prime";
  const primeBtn = document.getElementById("btn-mode-prime");
  const modsBtn = document.getElementById("btn-mode-mods");
  if (primeBtn && modsBtn) {
    if (mode === "prime") {
      primeBtn.style.background = "rgba(0, 229, 255, 0.2)";
      primeBtn.style.color = "#00e5ff";
      modsBtn.style.background = "none";
      modsBtn.style.color = "#888";
    } else {
      modsBtn.style.background = "rgba(208, 96, 255, 0.2)";
      modsBtn.style.color = "#d060ff";
      primeBtn.style.background = "none";
      primeBtn.style.color = "#888";
    }
  }
};