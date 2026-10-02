import { DEBUG_ACTIVO } from "../utils/debug_log.js";
import { state, saveAppState } from "../state.js";
import { applyRewardCommit, undoRewardCommit, pickManualReward, aplicaTradeo } from "../utils/inventory/reward_commit.js";
import { esPantallaRecordada, huellaPantalla, memoriaPantalla } from "../utils/inventory/reward_ledger.js";
import { showToast } from "../ui.components/ui_components.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
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
import { sumaReliquias, restaReliquia, applyRelicCounts } from "../utils/inventory/relic_votes.js";
import { RelicScreenService } from "../services/scanner/relic_screen.service.js";
import { DucatKioskService } from "../services/scanner/ducat_kiosk.service.js";
import { TradeService } from "../services/scanner/trade.service.js";
import { applyDucatSale, vuelcaSesion } from "../utils/inventory/ducat_kiosk.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { DebugRecorder } from "../services/scanner/debug_recorder.service.js";
import { motorElegido } from "../services/scanner/ocr_engine.service.js";
import { APP_VERSION } from "../config.js";
import { piezasParaBaro, copiasQueSobran } from "../utils/inventory/baro_picks.js";
import { ducadosDePieza } from "../utils/inventory/catalog_parts.js";
import { ducatsBeatSale } from "../utils/inventory/reward_value.js";
import { getSetName, getRequiredCount } from "../utils/ui_utils.js";
import { getPriceValue, MEMORY_CACHE } from "../services/market/prices.service.js";
import { getSlug } from "../utils/slugs.utils.js";
import { rankRelicPicks, mejorRefinamiento, REFINOS_POR_COSTE } from "../utils/inventory/relic_picks.js";
import { relicSetValue } from "../utils/inventory/relic_set_value.js";
import { getRelicCounts } from "../utils/inventory/relic_counts.js";
import { getPlayerOdds } from "../utils/inventory/relic_drop_odds.utils.js";
import { fetchAllFissures } from "../services/farms/fissures.service.js";
import { EELogLive } from "../services/scanner/eelog_live.service.js";
import { eraDeLaMision } from "../utils/inventory/relic_route.js";
import { mostrarPaneles, quitarTodosLosPaneles } from "../services/desktop.service.js";
import { panelReliquias, MAX_RELIQUIAS, POR_ERA, ORDEN_ERAS } from "../utils/overlay_paneles.js";

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

const sh = () => TEXTS[state.currentLang]?.scannerHUD || {};

function pintaGrabadora() {
  for (const id of ["btn-debug-record", "btn-rec-drawer"]) {
    const rec = document.getElementById(id);
    if (rec) { rec.textContent = DebugRecorder.enabled ? sh().btnRecordOn : sh().btnRecord; rec.classList.toggle("is-recording", DebugRecorder.enabled); }
  }
  const exp = document.getElementById("btn-debug-export");
  const cuenta = DebugRecorder.size + (DebugRecorder.size ? ` · ${Math.round(DebugRecorder.mb)} MB${DebugRecorder.llena ? " · " + sh().recFull : ""}` : "");
  if (exp) exp.textContent = (sh().btnExport || "ZIP ({n})").replace("{n}", cuenta);
}

/**
 * records each scanner frame alongside its result (services/scanner/debug_recorder.service.js)
 */
function enciendeGrabadora(on) {
  DebugRecorder.enabled = on;
  DebugRecorder.onChange = pintaGrabadora;
  if (on) {
    const v = document.getElementById("live-video");
    DebugRecorder.sesion = { version: APP_VERSION, motor: motorElegido(), frame: v?.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : null, get workers() { return OCRRepository.workers.length; }, navegador: navigator.userAgent }; // getter: read at export time, not when recording starts
  }
  pintaGrabadora();
}

function toggleDebugRecorder() {
  enciendeGrabadora(!DebugRecorder.enabled);
  showToast(DebugRecorder.enabled ? sh().toastRecordOn : sh().toastRecordOff);
}

async function exportDebugRecorder() {
  if (!DebugRecorder.size) { showToast(sh().toastRecordEmpty); return; }
  const zip = await DebugRecorder.export();
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `voidstonks-debug-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast((sh().toastRecordExported || "{n}").replace("{n}", DebugRecorder.size));
}

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
    const nativa = (() => { try { return localStorage.getItem("vs_capture_native") === "1"; } catch { return false; } })();
    liveStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", displaySurface: "window", frameRate: { ideal: 10, max: 15 }, ...(nativa ? {} : { height: { ideal: 1080 } }) },
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
    DucatKioskService.reset();
    enciendeGrabadora(DEBUG_ACTIVO);
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
  quitarTodosLosPaneles();
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
globalThis.showRivenAppraisal = async (parsedL, parsedR, captura) => {
  const { RivenScannerHUD } = await import("../ui.components/rivens/ui_riven_scanner_hud.js");
  RivenScannerHUD.show(parsedL, parsedR, captura);
};

const RELIQUIAS_DURACION_MS = 120_000;
let eraElegida = null;
let eligiendoReliquia = false;

function oddsPorRefino(p, deps) {
  const drops = state.relicsDatabase?.[p.relic] || state.relicsDatabase?.[`${p.relic} Relic`];
  return Object.fromEntries(REFINOS_POR_COSTE.map((ref) => {
    const v = relicSetValue(drops, { ...deps, dropChances: DROP_CHANCES[ref], stock: p.owned });
    return [ref, Number.isFinite(v.runs) && v.runs > 0 ? 1 / v.runs : 0];
  }));
}

async function pintaReliquias(era = eraElegida) {
  eraElegida = era;
  const fissures = await fetchAllFissures().catch(() => []);
  const relicCounts = getRelicCounts();
  const { squadSize } = getPlayerOdds();
  const refino = DROP_CHANCES[state.refinement] ? state.refinement : "Rad";
  const deps = { setsDatabase: state.setsDatabase, primeInventory: state.primeInventory, getSetName, getRequiredCount, squadSize };
  const picks = rankRelicPicks({
    ...deps, relicCounts, relicsDatabase: state.relicsDatabase, fissures,
    getPrice: (n) => Number.parseInt(MEMORY_CACHE.get(getSlug(n)) || 0, 10) || 0,
    dropChances: DROP_CHANCES[refino],
  }, Number.MAX_SAFE_INTEGER).filter((p) => !era || p.tier === era);
  const visibles = era ? picks.slice(0, MAX_RELIQUIAS) : ORDEN_ERAS.flatMap((e) => picks.filter((p) => p.tier === e).slice(0, POR_ERA));
  for (const p of visibles) p.refino = mejorRefinamiento(oddsPorRefino(p, deps));
  const panel = panelReliquias(picks, era, TEXTS[state.currentLang].scannerHUD, {
    reliquiasEnApp: Object.keys(relicCounts).length, refino, escuadra: squadSize,
  });
  mostrarPaneles("reliquias", [panel], { duracionMs: RELIQUIAS_DURACION_MS });
}

RelicScreenService.onEra = (era) => pintaReliquias(era);

EELogLive.escuchar(async (live) => {
  if (live.estado !== "leyendo") return;
  const ahora = !!live.juego.eligiendoReliquia;
  if (ahora && !eligiendoReliquia) {
    eraElegida = eraDeLaMision(live.juego.mision, await fetchAllFissures().catch(() => []));
    pintaReliquias();
  }
  eligiendoReliquia = ahora;
});

RelicScreenService.onApplied = (changed) => {
  const t = TEXTS[state.currentLang].scanner;
  showToast((t.relicCountsApplied || "{n} relic counts updated").replace("{n}", String(changed.length)));
  saveAppState();
  if (eligiendoReliquia) pintaReliquias();
};

TradeService.onUpdate = (mesa) => ScannerHUD.updateTrade(mesa);
TradeService.onTrade = (mesa) => {
  if (!state.autoAddMissionRewards) return;
  const { inventario, previo, movidas } = aplicaTradeo(state.primeInventory, mesa);
  if (!movidas.length) return;
  state.primeInventory = inventario;
  saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
  avisaConDeshacer(`${TEXTS[state.currentLang].scanner.tradeDone}: ${movidas.join(", ")}`, "tradeo", () => {
    state.primeInventory = undoRewardCommit(state.primeInventory, previo);
  });
};

ScannerService.onPaginaKiosco = () => {
  state.primeInventory = vuelcaSesion(state.primeInventory, ScannerService.sessionInventory);
  saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
  recomiendaParaBaro().catch(console.warn);
};
const TOPE_PARA_BARO = 8;
let pidiendoPrecios = false;
async function recomiendaParaBaro() {
  const deps = {
    primeInventory: state.primeInventory, setsDatabase: state.setsDatabase, getSetName, getRequiredCount,
    ducadosDe: ducadosDePieza, rentaFundir: ducatsBeatSale,
    precioDe: (n) => { const r = MEMORY_CACHE.get(getSlug(n)); return r === undefined ? null : (Number.parseInt(r, 10) || 0); },
  };
  const pinta = () => ScannerHUD.updateKioskSale(piezasParaBaro(deps).slice(0, TOPE_PARA_BARO)
    .map((p) => ({ name: p.name, qty: p.qty, ducats: p.ducats * p.qty, plat: p.plat, ratio: p.ratio })),
  TEXTS[state.currentLang].scannerHUD.kioskSuggest);
  pinta();
  const sinPrecio = Object.keys(state.primeInventory).filter((n) => ducadosDePieza(n) && deps.precioDe(n) === null
    && copiasQueSobran(n, deps).sobran > 0);
  if (!sinPrecio.length || pidiendoPrecios) return;
  pidiendoPrecios = true;
  try {
    await Promise.all(sinPrecio.map((n) => getPriceValue(n, getSlug(n)).catch(() => null)));
  } finally {
    pidiendoPrecios = false;
  }
  pinta();
}
DucatKioskService.onPanel = () => recomiendaParaBaro().catch(console.warn);

DucatKioskService.onSale = (venta) => {
  const t = TEXTS[state.currentLang].scanner;
  const { inventario, restadas, ausentes } = applyDucatSale(state.primeInventory, venta);
  state.primeInventory = inventario;
  for (const { name } of venta) {
    ScannerService.sessionInventory.delete(name);
    ScannerService.qtyVotes.delete(name);
  }
  saveAppState();
  if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
  ScannerHUD.updateDetectedItems(ScannerService.sessionInventory, ScannerService.sessionRelics);
  recomiendaParaBaro().catch(console.warn);
  const lista = restadas.map((r) => `${r.qty}× ${r.name}`).join(", ") || "—";
  const faltan = ausentes.length ? (t.ducatSoldMissing || "").replace("{missing}", ausentes.join(", ")) : "";
  showToast((t.ducatSold || "Sold: {items}").replace("{items}", lista) + faltan, { duration: 8000 });
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
const ultimaEleccion = memoriaPantalla(() => localStorage, "vs_reward_ultima_eleccion");

globalThis.selectRewardToInventory = (itemName) => {
  const modal = globalThis.ScannerModal;
  const willSyncInClose = state.autoSyncRewards && modal && modal.currentResults && !modal.isHistoric;

  const recordada = modal?.selectedItem == null && esPantallaRecordada(modal?.currentResults, ultimaEleccion.lee())
    ? ultimaEleccion.lee().item : null;
  const { inventario, pendientes, cambio } = pickManualReward(
    state.primeInventory, pendingManualAdds, modal?.selectedItem ?? recordada, itemName, !willSyncInClose);
  if (!cambio) return;
  state.primeInventory = inventario;
  pendingManualAdds.length = 0;
  pendingManualAdds.push(...pendientes);
  if (modal?.currentResults?.length) ultimaEleccion.guarda({ huella: huellaPantalla(modal.currentResults), item: itemName, t: Date.now() });

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
  ultimaEleccion.guarda(null);
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
  avisaConDeshacer(`${t.mcAdded}: ${movidas.join(", ")}`, "mc-rewards", () => {
    state.primeInventory = undoRewardCommit(state.primeInventory, previo);
    state.inventory = relicPrevio;
  });
}

const unidades = (inventario) => applyRelicCounts(inventario, []).reduce((n, i) => n + Number(i.count), 0);

function gastaReliquiaAbierta(nombre) {
  if (!state.autoAddMissionRewards) return;
  const previo = (state.inventory || []).map((i) => (typeof i === "string" ? i : { ...i }));
  const nuevo = restaReliquia(state.inventory, nombre);
  if (unidades(nuevo) === unidades(previo)) return; // the relic was not in the inventory
  state.inventory = nuevo;
  saveAppState();
  const t = TEXTS[state.currentLang].scanner;
  avisaConDeshacer(`${t.relicSpent}: ${nombre}`, "reliquia-gastada", () => { state.inventory = previo; });
}

function avisaConDeshacer(texto, tag, deshacer) {
  const t = TEXTS[state.currentLang].scanner;
  const toast = showToast(texto, { type: "success", tag });
  if (!toast) return;
  const undo = document.createElement("button");
  undo.className = "toast-action";
  undo.textContent = t.mcUndo;
  undo.onclick = () => {
    deshacer();
    saveAppState();
    if (globalThis.renderPrimeInventory) globalThis.renderPrimeInventory();
    showToast(t.mcUndone, { tag });
  };
  toast.appendChild(undo);
}

exposeGlobals({ commitMissionCompleteRewards, gastaReliquiaAbierta, toggleDebugRecorder, exportDebugRecorder }, "scanner/live_scanner.js");

globalThis.saveLiveInventory = () => {
  const sh = TEXTS[state.currentLang].scannerHUD;
  state.primeInventory = vuelcaSesion(state.primeInventory, ScannerService.sessionInventory);
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