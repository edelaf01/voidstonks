import { state, saveAppState } from "../state.js";
import { applyRewardCommit, undoRewardCommit, pickManualReward } from "../utils/inventory/reward_commit.js";
import { showToast } from "../ui.components/ui_components.js";
import { TEXTS } from "../config.js";
import { warmupPrices } from "../services/inventory/inventory.service.js";
import { ScannerService } from "../services/scanner/scanner.service.js";
import { OCRService } from "../services/scanner/ocr.service.js?v=264";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { ScannerHUD, renderOcrEngine } from "../ui.components/ui_scanner_hud.js";
import { restauraMotor } from "../services/scanner/ocr_engine.service.js";
import { showHowToPanel } from "../ui.components/ui_howto_panel.js";
import { oneTimeNoticeSeen, markOneTimeNoticeSeen } from "../repositories/storage.repository.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { WF_THEMES_VOTABLES } from "../utils/vision/wf_themes.js";
import { mergeRelicCounts } from "../utils/inventory/relic_counts.js";
import { sumaReliquias, restaReliquia } from "../utils/inventory/relic_votes.js";
import { RelicScreenService } from "../services/scanner/relic_screen.service.js";
import { exposeGlobals } from "../utils/global_registry.js";

//Two contexts
const HOWTO_KEY = "vs_live_howto_seen";

globalThis._OCRService = OCRService;
globalThis._ScannerModal = ScannerModal;
globalThis._OCRRepository = OCRRepository;
// Expose globals for debugging and testing 
globalThis._WF_THEMES = WF_THEMES_VOTABLES;

let DEBUG_MODE = false;

globalThis.toggleScannerDebug = () => {
  DEBUG_MODE = !DEBUG_MODE;
  globalThis._scannerDebug = DEBUG_MODE;
  const btn = document.getElementById("btn-debug-toggle");
  if (btn) btn.classList.toggle("active", DEBUG_MODE);
  const dbgPanel = document.getElementById("live-debug-snapshot");
  if (dbgPanel) dbgPanel.style.display = DEBUG_MODE ? "block" : "none";

  showToast(DEBUG_MODE ? "Debug mode ON" : "Debug mode OFF");
};

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

    const hist = ScannerService.debugHistory;
    const selected = hist && hist[ScannerHUD.debugSelectedIndex];
    if (selected) {
      logLines.push(`\n[Scan ${selected.time}] ${selected.summary}`, "[RAW OCR Per Cell]", [...selected.log].sort().join("\n"));
    } else {
      const rawOcr = globalThis.ScannerService?.lastRawOcrLog;
      if (rawOcr && rawOcr.length > 0) {
        logLines.push("\n[RAW OCR Per Cell]", rawOcr.sort().join("\n"));
      }
    }

    const logText = logLines.join("\n");
    await navigator.clipboard.writeText(logText);
  } catch (e) {
    showToast(st().toastLogCopyError);
    console.error(e);
  }
};

const st = () => TEXTS[state.currentLang]?.scanner || {};

let liveStream = null;
let isStartingSession = false;

export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;

  restauraMotor();
  renderOcrEngine();

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

    if (!oneTimeNoticeSeen(HOWTO_KEY)) {
      showHowToPanel({
        title: t.howToTitle, steps: t.howToSteps || [], gotIt: t.howToGot,
        onDismiss: () => markOneTimeNoticeSeen(HOWTO_KEY),
      });
    }

    RelicScreenService.reset();
    pendingManualAdds.length = 0;
    await ScannerService.start();
    showToast(t.toastActive);

    if (toggleBtn) toggleBtn.querySelector(".label").innerText = t.active;

    const pista = liveStream.getVideoTracks()[0];
    if (pista) pista.onended = () => stopLiveSession();
  } catch (e) {
    console.error("Scanner startup failed:", e);
    showToast(e.name === "NotAllowedError"
      ? (st().toastShareDenied || "No window was shared.")
      : (st().toastError || "Error: {msg}").replace("{msg}", e.message));
    stopLiveSession();
  } finally {
    isStartingSession = false;
  }
}

export function stopLiveSession() {
  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }
  const v = document.getElementById("live-video");
  if (v) {
    v.pause();
    v.srcObject = null;
  }
  ScannerService.stop();
  const toggleBtn = document.getElementById("scanner-toggle");
  if (toggleBtn) {
    toggleBtn.classList.remove("active");
    const label = toggleBtn.querySelector(".label");
    if (label) label.innerText = TEXTS[state.currentLang].scanner.idle;
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

/** Called by ScannerService when riven cards are parsed. */
globalThis.showRivenAppraisal = async (parsedL, parsedR, screenshotDataURL) => {
  const { RivenScannerHUD } = await import("../ui.components/rivens/ui_riven_scanner_hud.js");
  RivenScannerHUD.show(parsedL, parsedR, screenshotDataURL);
};

RelicScreenService.onApplied = (changed) => {
  const t = TEXTS[state.currentLang].scanner;
  showToast((t.relicCountsApplied || "{n} relic counts updated").replace("{n}", String(changed.length)));
  saveAppState();
};

/** Called by ScannerService when a relic is detected. */
globalThis.showTrackConfirm = (relicName) => {
  const t = TEXTS[state.currentLang].scanner;
  showToast(`${t.relicDetected}: ${relicName}`, {
    duration: 20000,
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
//TODO no pip at the moment drop it off maybe
/**
 * syncs inventory with the quantity shown in-game ("N Owned" badge)
 * @returns {boolean} true if synced from the game
 */
globalThis.syncRewardFromGame = (itemName, owned) => {
    if (!itemName || typeof owned !== "number" || owned <= 0) return false;
    if (state.primeInventory[itemName] === owned) return true;
    state.primeInventory[itemName] = owned;
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    return true;
};

/**
 * items added manually from the relic selection screen, pending confirmation on mission complete
 */
const pendingManualAdds = [];

globalThis.selectRewardToInventory = (itemName) => {
  const modal = globalThis.ScannerModal;
  const willSyncInClose = state.autoSyncRewards && modal && modal.currentResults && !modal.isHistoric;

  const { inventario, pendientes, cambio } = pickManualReward(
    state.primeInventory, pendingManualAdds, modal?.selectedItem, itemName, !willSyncInClose);
  if (!cambio) return;
  state.primeInventory = inventario;
  pendingManualAdds.length = 0;
  pendingManualAdds.push(...pendientes);

  if (modal) modal.selectedItem = itemName;
  globalThis.selectedScanItem = itemName;

  const t = TEXTS[state.currentLang].rewardScanner;
  const msg = t.rewardSelectedConfirmation
    ? t.rewardSelectedConfirmation.replace("{item}", itemName)
    : `Seleccionado: ${itemName}`;
  showToast(msg);

  if (!willSyncInClose) {
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
  }
};

/**
 * updates rewards read in mission complete context
 */
function commitMissionCompleteRewards(items, gastada = null) {
  if (!state.autoAddMissionRewards) { pendingManualAdds.length = 0; return; }
  const reliquias = (items || []).filter((i) => i.reliquia);
  const piezas = (items || []).filter((i) => !i.reliquia);
  if (!piezas.length && !reliquias.length && !gastada) return;

  const t = TEXTS[state.currentLang].scanner;
  const { inventario, previo, anadidas: añadidas } = applyRewardCommit(
    state.primeInventory, piezas, pendingManualAdds);
  state.primeInventory = inventario;
  pendingManualAdds.length = 0;

  const relicPrevio = (state.inventory || []).map((i) => (typeof i === "string" ? i : { ...i }));
  if (reliquias.length) state.inventory = sumaReliquias(state.inventory, reliquias);
  if (gastada) state.inventory = restaReliquia(state.inventory, gastada);
  const movidas = [...añadidas, ...reliquias.map((r) => (r.qty > 1 ? `${r.name} ×${r.qty}` : r.name))];
  if (gastada) movidas.push(`−1 ${gastada}`);
  if (!movidas.length) return;

  saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();

  const toast = showToast(`${t.mcAdded}: ${movidas.join(", ")}`, { type: "success", tag: "mc-rewards" });
  if (!toast) return;
  const undo = document.createElement("button");
  undo.className = "toast-action";
  undo.textContent = t.mcUndo;
  undo.onclick = () => {
    state.primeInventory = undoRewardCommit(state.primeInventory, previo);
    state.inventory = relicPrevio;
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    showToast(t.mcUndone, { tag: "mc-rewards" });
  };
  toast.appendChild(undo);
}

exposeGlobals({ commitMissionCompleteRewards }, "scanner/live_scanner.js");

globalThis.saveLiveInventory = () => {
  const sh = TEXTS[state.currentLang].scannerHUD;
  for (const [name, count] of ScannerService.sessionInventory) {
    state.primeInventory[name] = count;
  }
  ScannerService.sessionInventory.clear();

  state.inventory = mergeRelicCounts(state.inventory, ScannerService.sessionRelics);
  ScannerService.sessionRelics.clear();
  ScannerService.relicQtyVotes.clear();

  showToast(sh.saved);
  saveAppState();

  if (typeof warmupPrices === "function") {
    warmupPrices().catch(console.error);
  }

  if (globalThis.renderInventory) globalThis.renderInventory();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
};

/** Clears the scan session without saving (the HUD ✕ button). */
globalThis.clearLiveSessionInventory = () => {
  const sh = TEXTS[state.currentLang].scannerHUD;
  ScannerService.sessionInventory.clear();
  ScannerService.sessionRelics.clear();
  ScannerService.qtyVotes.clear();
  ScannerService.relicQtyVotes.clear();
  ScannerService.inventoryHasScanned = false;

  ScannerHUD.updateDetectedItems(ScannerService.sessionInventory, ScannerService.sessionRelics);
  showToast(sh.cleared ?? "Sesión limpiada");
};

//TODO not in use, remove?
/**
 * resets the grid completely: clears cached autodetection (_autoCalibCache) and saved manual
 * calibration so the next frame autodetects from scratch (grid_detect.js)
 */
globalThis.resetGrid = () => {
  ScannerService._autoCalibCache = null;
  ScannerService._nameColorCache = null;
  ScannerService._frameZoneCache = null;
  ScannerService._invQueue?.clear();
  ScannerService.detectionLocked = false;
  ScannerService.inventoryHasScanned = false;
  globalThis.LiveCalibration?.clearCalibration?.();
  console.log("[INV] Grid reseteado — se re-autodetectará en el próximo escaneo.");
  showToast(st().toastGridReset);
};

/**
 * DEBUG: downloads the current frame
 */
globalThis.dumpScanFrame = () => {
  const video = document.getElementById("live-video");
  if (!video || !video.videoWidth) { showToast(st().toastNotActive); return; }
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = `scan-frame-${video.videoWidth}x${video.videoHeight}-${Date.now()}.png`;
  a.click();
  console.log(`[DEBUG] Frame volcado: ${video.videoWidth}x${video.videoHeight}`);
};

globalThis.manualPrecisionScan = async () => {
  if (!liveStream?.active) return showToast(st().toastStartFirst);
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

globalThis.toggleAutoScrollScan = () => {
  state.autoScanEnabled = !state.autoScanEnabled;
  const btn = document.getElementById("btn-auto-scan");
  if (btn) {
    btn.dataset.active = state.autoScanEnabled ? "1" : "0";
    btn.setAttribute("aria-pressed", state.autoScanEnabled ? "true" : "false");
  }
  const sh2 = TEXTS[state.currentLang].scannerHUD;
  showToast(state.autoScanEnabled ? sh2.autoScanOn : sh2.autoScanOff);
};

globalThis.startLiveSession = startLiveSession;
globalThis.stopLiveSession = stopLiveSession;
globalThis.toggleScanner = () => {
  if (liveStream?.active) stopLiveSession();
  else startLiveSession();
};

globalThis.setScannerMode = (mode) => {
  state.scannerModsMode = (mode === "mods");
  saveAppState();
  globalThis.syncScannerModeUI();
  showToast(state.currentLang === "es" 
    ? (mode === "prime" ? "Modo Prime activado" : "Modo Riven activado")
    : (mode === "prime" ? "Prime mode active" : "Riven mode active")
  );
};

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