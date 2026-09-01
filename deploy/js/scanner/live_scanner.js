import { state, saveAppState } from "../state.js";
import { applyRewardCommit, undoRewardCommit } from "../utils/inventory/reward_commit.js";
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
import { RelicScreenService } from "../services/scanner/relic_screen.service.js";
import { exposeGlobals } from "../utils/global_registry.js";

// Clave propia y no la del escáner de móvil: son dos flujos distintos, y haber visto uno no
// explica el otro.
const HOWTO_KEY = "vs_live_howto_seen";

globalThis._OCRService = OCRService;
globalThis._ScannerModal = ScannerModal;
globalThis._OCRRepository = OCRRepository;
// Los CROMÁTICOS, no todos: esta lista la usa la máscara del escáner por foto, que cubre la
// pantalla entera. Un tema acromático casa con cualquier gris de la interfaz porque
// matchesThemeHue normaliza el brillo — medido sobre una captura real de inventario, con los 20
// temas la tinta de la máscara pasaba del 4,62 % al 7,01 %, y eso es ruido para el OCR. La lista
// completa se queda donde se midió que ayuda: la pasada de nombres de recompensas.
globalThis._WF_THEMES = WF_THEMES_VOTABLES;

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

    // Con historial de debug: copia el log del escaneo SELECCIONADO en la tira de
    // miniaturas (no necesariamente el último). Sin historial, cae al log crudo actual.
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

/** Textos del escáner en el idioma activo; se lee en cada uso porque cambia en caliente. */
const st = () => TEXTS[state.currentLang]?.scanner || {};

let liveStream = null;
let isStartingSession = false;

/**
 * Starts a live scanning session by capturing display media.
 */
export async function startLiveSession() {
  if (isStartingSession || liveStream?.active) return;
  isStartingSession = true;

  // El motor elegido en una sesión anterior, y su descarga lanzada YA: si el modelo se pidiera
  // al detectar la primera pantalla de recompensas, ese frame se perdería esperándolo.
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

    // Después de conceder el permiso, no antes: el panel taparía el diálogo del navegador.
    if (!oneTimeNoticeSeen(HOWTO_KEY)) {
      showHowToPanel({
        title: t.howToTitle, steps: t.howToSteps || [], gotIt: t.howToGot,
        onDismiss: () => markOneTimeNoticeSeen(HOWTO_KEY),
      });
    }

    RelicScreenService.reset();
    // Los apuntes de "ya la conté a mano" son de la partida anterior: si esa sesión acabó sin
    // pasar por el resumen (misión abortada, escáner cerrado, auto-añadir apagado) se quedan
    // vivos y se tragan la primera recompensa buena de esta.
    pendingManualAdds.length = 0;
    await ScannerService.start();
    showToast(t.toastActive);

    if (toggleBtn) toggleBtn.querySelector(".label").innerText = t.active;

    liveStream.getVideoTracks()[0].onended = () => stopLiveSession();
  } catch (e) {
    console.error("Scanner startup failed:", e);
    // Cancelar el selector de ventanas también llega aquí como NotAllowedError, y el mensaje
    // crudo del navegador ("Permission denied") no dice qué hacer para seguir.
    showToast(e.name === "NotAllowedError"
      ? (st().toastShareDenied || "No window was shared.")
      : (st().toastError || "Error: {msg}").replace("{msg}", e.message));
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
    // Antes volvía a "LIVE SCANNER" a pelo, un tercer nombre para el mismo botón además del
    // del HTML y el de la sesión activa, y encima siempre en inglés.
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

/**
 * UI Hook called by ScannerService when Riven card(s) are parsed.
 */
globalThis.showRivenAppraisal = async (parsedL, parsedR, screenshotDataURL) => {
  const { RivenScannerHUD } = await import("../ui.components/rivens/ui_riven_scanner_hud.js");
  RivenScannerHUD.show(parsedL, parsedR, screenshotDataURL);
};

// Las cantidades de la pantalla VOID RELICS/REFINEMENT se escriben en el inventario solas,
// así que el aviso no es decorativo: es la única señal de que algo cambió sin pedirlo.
RelicScreenService.onApplied = (changed) => {
  const t = TEXTS[state.currentLang].scanner;
  showToast((t.relicCountsApplied || "{n} relic counts updated").replace("{n}", String(changed.length)));
  saveAppState();
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
/**
 * Sincroniza el inventario con la cantidad que MOSTRABA EL JUEGO ("N Owned" en el badge).
 *
 * Es una asignación, no una suma: el badge dice cuántos tienes en total, así que sumar +1
 * sobre lo que la app tuviera guardado arrastra cualquier desfase previo (juego 14, app 3 →
 * quedaría en 4, igual de mal). Misma semántica que saveLiveInventory con el grid.
 *
 * `crafted` no toca el inventario: significa que ya está forjado, no cuántos quedan.
 *
 * @returns {boolean} true si se sincronizó desde el juego.
 */
globalThis.syncRewardFromGame = (itemName, owned) => {
    if (!itemName || typeof owned !== "number" || owned <= 0) return false;
    if (state.primeInventory[itemName] === owned) return true;   // ya coincide
    state.primeInventory[itemName] = owned;
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    return true;
};

/**
 * Piezas dadas de alta A MANO desde la pantalla de selección de reliquia, aún sin confirmar
 * por la de fin de misión.
 *
 * Las dos pantallas hablan de la MISMA pieza: primero eliges la recompensa, y al acabar la
 * misión el juego te la enseña otra vez en el resumen. Sin esta lista, elegirla a mano y
 * escanear el resumen la sumaría dos veces. Se vacía en cada alta automática, que es lo que
 * marca el final de la partida.
 */
const pendingManualAdds = [];

globalThis.selectRewardToInventory = (itemName) => {
  const modal = globalThis.ScannerModal;
  if (modal) modal.selectedItem = itemName;
  globalThis.selectedScanItem = itemName;
  pendingManualAdds.push(itemName);

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
 * Alta automática de las piezas leídas en MISSION COMPLETE.
 *
 * Semántica de SUMA, no de asignación: esta pantalla enseña lo que acabas de recibir, no
 * cuántas tienes. (El grid del inventario sí dice el total y por eso allí se asigna.)
 *
 * Se ofrece deshacer porque el alta ocurre sin que el usuario pulse nada: si el OCR se
 * equivoca en un nombre, tiene que poder devolverlo sin ir a buscarlo al inventario.
 */
function commitMissionCompleteRewards(items) {
  if (!state.autoAddMissionRewards || !items?.length) return;

  const t = TEXTS[state.currentLang].scanner;
  const { inventario, previo, anadidas: añadidas } = applyRewardCommit(
    state.primeInventory, items, pendingManualAdds);
  state.primeInventory = inventario;
  pendingManualAdds.length = 0;
  if (!añadidas.length) return;

  saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();

  const toast = showToast(`${t.mcAdded}: ${añadidas.join(", ")}`, { type: "success", tag: "mc-rewards" });
  if (!toast) return;
  const undo = document.createElement("button");
  undo.className = "toast-action";
  undo.textContent = t.mcUndo;
  undo.onclick = () => {
    state.primeInventory = undoRewardCommit(state.primeInventory, previo);
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    showToast(t.mcUndone, { tag: "mc-rewards" });
  };
  toast.appendChild(undo);
}

// Lo llama scanner.service.js por globalThis: un service no puede importar de scanner/
// (capa superior), así que el global es el único camino — pero pasa por el registro.
exposeGlobals({ commitMissionCompleteRewards }, "scanner/live_scanner.js");

/**
 * Saves detected inventory items from the current session to the app state.
 */
globalThis.saveLiveInventory = () => {
  const sh = TEXTS[state.currentLang].scannerHUD;
  for (const [name, count] of ScannerService.sessionInventory) {
    state.primeInventory[name] = count;
  }
  ScannerService.sessionInventory.clear();

  // Reliquias detectadas en el mismo grid (fallback de OCRService.getRelicMatch): se persisten
  // en state.inventory (array {name, count}), NO en primeInventory.
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

/**
 * Descarta la sesión de escaneo actual SIN persistir: vacía los items/reliquias
 * detectados y sus votos de cantidad, y refresca el HUD. (El botón ✕ del HUD.)
 */
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

/**
 * Resetea la rejilla por completo: descarta la autodetección cacheada
 * (_autoCalibCache) Y la calibración manual guardada, de modo que el siguiente
 * frame vuelva a autodetectar desde cero (grid_detect.js). Útil si la rejilla
 * quedó anclada mal (p.ej. tras un cambio de resolución/tema) o para forzar
 * una re-detección limpia.
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
 * DEBUG: descarga el frame EXACTO que ve la app (del <video>, a su resolución real
 * videoWidth×videoHeight — no el screenshot fullscreen del monitor). Sirve para
 * reproducir offline bugs que dependen de la resolución/ventana del juego (p.ej. el
 * conteo de columnas cuando el inventario no llena todo el ancho). Ejecutar en consola:
 *   globalThis.dumpScanFrame()
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

/**
 * Triggers a manual, high-precision inventory grid scan.
 */
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

/**
 * Toggles the auto-scan mode when scrolling in the inventory.
 */
globalThis.toggleAutoScrollScan = () => {
  state.autoScanEnabled = !state.autoScanEnabled;
  // Solo el dataset: el color lo pinta .hud-btn.toggle[data-active="1"] en scanner.css.
  // Poniéndolo inline aquí, el estilo ganaba al :hover y el botón se quedaba con el
  // color de encendido pegado al pasar el ratón por encima.
  const btn = document.getElementById("btn-auto-scan");
  if (btn) {
    btn.dataset.active = state.autoScanEnabled ? "1" : "0";
    btn.setAttribute("aria-pressed", state.autoScanEnabled ? "true" : "false");
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