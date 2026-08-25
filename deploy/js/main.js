import "./utils/debug_log.js"; // PRIMERO: silencia console.log/info/debug/warn si DEBUG_LOGS=false
import { initCanvas } from "./utils/canvas.js";
import { downloadRelics } from "./services/inventory/relics.service.js";
import { renderFarmRoutes } from "./ui.components/farms/ui_farm_routes.js";
import { fetchRivenWeapons } from "./services/rivens/rivens.service.js";
// import { fetchUserProfile } from "./services/profile.service.js";  // ver nota del perfil abajo
import { fetchPrimeManifest } from "./repositories/api.repository.js";
import { warmupPrices } from "./services/inventory/inventory.service.js";
import { preloadPricesToMemory, ensurePriceSnapshot } from "./repositories/storage.repository.js";
import { exposeGlobals } from "./utils/global_registry.js";
import { state, loadAppState, saveAppState, hydrateDOM } from "./state.js";
import { startLiveSession, stopLiveSession } from "./scanner/live_scanner.js";
import { openPiP, initPiP } from "./utils/pip_overlay.js";
import {
  openScanner,
  closeScanner,
  handleFileUpload,
} from "./scanner/scanner_controller.js";
import {
  switchTab,
  tabFromUrl,
  initTabRouting,
  refreshActiveTab,
  changeLanguage,
  initDisclaimerSystem,
  setupGlobalClickListeners,
  checkUpdates,
  toggleLangDropdown,
  setLanguageManual,
} from "./ui.js?v=2.4";
import { initFissurePanel } from "./ui.components/farms/ui_fissures.js?v=1.1";
import { initSyncPanel } from "./ui.components/market/ui_sync.js";
// Perfil / calculadora de MR DESACTIVADO, igual que el traductor de Kubrows: no hay pestaña
// que lo aloje. renderProfileStats() pinta en #profile-data y calculateCaps() lee #mrInput, y
// ninguno de los dos existe en index.html desde hace tiempo — se publicaban tres globales que
// nadie podía invocar. El módulo y profile.service.js quedan intactos; para reactivarlo hacen
// falta el marcado y descomentar estas líneas y sus entradas de exposeGlobals.
// import { calculateCaps, renderProfileStats } from "./ui.components/market/ui_profile.js";
import {
  initGlobalTooltipSystem,
  keepPanelInertWhileClosed,
  preloadCriticalAssets,
} from "./ui.components/ui_components.js";
import {
  toggleInventoryPanel,
  renderInventory,
  clearInventory,
} from "./ui.components/inventory/ui_inventory.js";
import { renderPrimeInventory } from "./ui.components/inventory/ui_prime_inventory.js";
import { manualRelicUpdate, updateProfitLabel } from "./ui.components/inventory/ui_relics.js";
import { renderSetTracker } from "./ui.components/inventory/ui_set_tracker.js";
import { initLFGPresets } from "./ui.components/ui_lfg.js";
import {
  handleRivenInput,
  openRivenMarket,
  updateSelectExclusions,
} from "./ui.components/rivens/ui_rivens.js?v=1.11";
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    for (let registration of registrations) {
      console.log("Service Worker desregistrado para evitar conflictos.");
      registration.unregister();
    }
  });
}
import { initVosforTab } from "./ui.components/ui_vosfor.js?v=2.9";
import "./ui.components/market/ui_orders.js?v=1.0";
import "./ui.components/ui_squad_run.js?v=1.0";
import { initTabFan } from "./ui.components/ui_tab_fan.js?v=1.1";
import { initMobileFooter } from "./ui.components/ui_mobile_footer.js?v=1.0";

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(globalThis.location.search);
  if (urlParams.get("clip")) {
    handleClipboardAction(urlParams.get("clip"));
    return;
  }
  const { domValues } = loadAppState();
  hydrateDOM(domValues);
  // Después de loadAppState y no dentro de updateUILabels: el save escribe `lang` antes que
  // `squadSize`, así que la pasada de idioma que dispara el primero todavía ve la escuadra por
  // defecto y el rótulo se quedaba diciendo "4 Jugadores" a quien juega solo.
  updateProfitLabel();
  checkUpdates();
  initCanvas();
  initDisclaimerSystem();
  setupGlobalClickListeners();
  initGlobalTooltipSystem();
  for (const id of ["inventory-container", "best-missions-container"]) {
    keepPanelInertWhileClosed(document.getElementById(id));
  }
  // initSyncPanel();  // Interfaz de nube (sync) desactivada de momento
  preloadCriticalAssets();
  setupScannerDrawer();
  initPiP();
  initVosforTab().catch(console.error);

  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();
  // La URL manda sobre el save: si alguien te pasa voidstonks.com/#riven, ahí es donde
  // quieres entrar, no en la pestaña que dejaste abierta la última vez.
  initTabRouting();
  switchTab(tabFromUrl() || state.activeTab || "relic");
  // El panel de inventario nace en la vista de reliquias por HTML; solo hay que moverlo si
  // el save dice otra cosa. Va después de switchTab porque el botón que lo abre depende de
  // la pestaña activa.
  if (state.currentInvView === "parts") globalThis.switchInvView?.("parts");
  initTabFan();
  initMobileFooter();

  if (state.activeTab === "lfg") initLFGPresets();

  loadAsyncData();
});

function setupScannerDrawer() {
  const toggleBtn = document.getElementById("scanner-toggle");
  const drawer = document.getElementById("scanner-drawer");
  const closeBtn = document.getElementById("close-drawer-btn");

  const noticePanel = document.getElementById("scanner-privacy-notice");
  const acceptBtn = document.getElementById("btn-accept-scan");

  if (!toggleBtn || !drawer) return;

  toggleBtn.addEventListener("click", () => {
    const isActive = toggleBtn.classList.contains("active");
    const isNoticeVisible = !noticePanel.classList.contains("hidden");

    if (isActive) {
      closeFullScanner();
    } else if (isNoticeVisible) {
      noticePanel.classList.add("hidden");
      toggleBtn.classList.remove("active");
    } else {
      noticePanel.classList.remove("hidden");
      toggleBtn.classList.add("active");
    }
  });

  if (acceptBtn) {
    acceptBtn.addEventListener("click", () => {
      noticePanel.classList.add("hidden");
      toggleBtn.classList.add("active");

      startLiveSession();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeFullScanner);
  }

  function closeFullScanner() {
    drawer.classList.remove("open");
    drawer.classList.add("closed");
    toggleBtn.classList.remove("active");
    if (noticePanel) noticePanel.classList.add("hidden");
    stopLiveSession();
  }
}

function handleClipboardAction(msg) {
  globalThis.history.replaceAllState(
    {},
    document.title,
    globalThis.location.pathname,
  );
  navigator.clipboard
    .writeText(msg)
    .then(() => alert(` Copied!\n\n"${msg}"`))
    .catch(() => prompt("Copy your message:", msg));
}

async function loadAsyncData() {
  try {
    //Preload should look into this later TODO no deberia hacer esto
    initFissurePanel().catch(console.error);
    preloadPricesToMemory().catch(console.error);
    // Se lanza aquí, en paralelo con la descarga de reliquias: cuando la primera reliquia
    // se pinta, sus 6 precios ya están en memoria y no generan ninguna petición.
    ensurePriceSnapshot().catch(console.error);
    await Promise.all([fetchRivenWeapons(), fetchPrimeManifest()]);
    await downloadRelics();
    if (state.selectedRelic) {
      const input = document.getElementById("relicInput");
      if (input) input.value = state.selectedRelic;
      manualRelicUpdate();
    }
    renderSetTracker();

    // Todo lo que monta una pestaña necesita las bases que acaban de llegar. switchTab() ya lo
    // pidió al arrancar, pero eso corre ANTES de esta descarga: la pestaña se encontraba las
    // bases vacías y se quedaba a medias — solo se completaba al cambiar de pestaña y volver,
    // que es cuando se ejecuta otra vez. Le pasaba al panel de rutas y le pasa igual a Set,
    // Ducados, Riven y Farms.
    refreshActiveTab();
    // Y las rutas aparte: viven en tres pestañas Y en el cajón de inventario, que se abre
    // desde cualquiera, así que se pintan esté el usuario donde esté.
    renderFarmRoutes().catch((e) => console.warn("[rutas] tras cargar datos:", e));

    warmupPrices().catch(console.error);
  } catch (error) {
    console.error("Error crítico cargando datos:", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveAppState();
});

let activeScannerInstance = null;
let isScannerActive = false;

async function startMobileScanner() {
  const scanBtn = document.getElementById("mobile-scan-btn");

  if (isScannerActive && activeScannerInstance) {
    console.log(" Cerrando escáner anterior...");

    try {
      activeScannerInstance.close();
    } catch (e) {
      console.warn("Error al cerrar escáner:", e);
    }

    activeScannerInstance = null;
    isScannerActive = false;

    if (scanBtn) {
      scanBtn.classList.remove("scanning", "processing");
    }

    return;
  }

  if (scanBtn) {
    if (scanBtn.classList.contains("processing")) {
      console.log("Ya hay un proceso en marcha...");
      return;
    }

    scanBtn.classList.add("processing");
  }

  console.log("Iniciando Mobile Scanner...");

  if (globalThis.stopLiveSession) {
    try {
      globalThis.stopLiveSession();
    } catch (e) {
      console.warn("Error al detener live session:", e);
    }
  }

  if (globalThis.closeScanner) {
    try {
      globalThis.closeScanner();
    } catch (e) {
      console.warn("Error al cerrar scanner:", e);
    }
  }

  try {
    const { MobileScanner } = await import("./scanner/mobile_scanner.js");
    const scanner = new MobileScanner();

    activeScannerInstance = scanner;
    isScannerActive = true;

    if (scanBtn) {
      scanBtn.classList.remove("processing");
      scanBtn.classList.add("scanning");
    }

    const originalClose = scanner.close.bind(scanner);
    scanner.close = function () {
      console.log(" Scanner cerrado");

      originalClose();

      activeScannerInstance = null;
      isScannerActive = false;

      if (scanBtn) {
        scanBtn.classList.remove("scanning", "processing");
      }
    };

    await scanner.start();
  } catch (err) {
    console.error(" Error al iniciar Mobile Scanner:", err);

    activeScannerInstance = null;
    isScannerActive = false;

    if (scanBtn) {
      scanBtn.classList.remove("scanning", "processing");
    }

    if (globalThis.showToast) {
      const errorMsg =
        state.currentLang === "es"
          ? "Error al abrir la cámara"
          : "Error opening camera";
      globalThis.showToast(errorMsg);
    }
  }
};



const wrapperSwitchTab = function (mode) {
  if (activeScannerInstance && mode !== "relic") {
    try {
      activeScannerInstance.close();
    } catch (e) {
      console.warn("Cerrando scanner al cambiar tab:", e);
    }
    activeScannerInstance = null;
    isScannerActive = false;

    const scanBtn = document.getElementById("mobile-scan-btn");
    if (scanBtn) scanBtn.classList.remove("scanning", "processing");
  }

  const scanBtn = document.getElementById("mobile-scan-btn");
  if (scanBtn) {
    if (mode === "relic") {
      scanBtn.classList.remove("hidden");
    } else {
      scanBtn.classList.add("hidden");
    }
  }

  switchTab(mode);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && activeScannerInstance) {
    console.log("📱 App en segundo plano, cerrando scanner...");

    try {
      activeScannerInstance.close();
    } catch (e) {
      console.warn("Error al cerrar scanner por visibilitychange:", e);
    }

    activeScannerInstance = null;
    isScannerActive = false;

    const scanBtn = document.getElementById("mobile-scan-btn");
    if (scanBtn) {
      scanBtn.classList.remove("scanning", "processing");
    }
  }
});
globalThis.switchTab = wrapperSwitchTab;

// Los handlers inline de index.html. Los que publica su propio módulo (inventario, escáner)
// NO se repiten aquí: el registro avisaría del choque, y hasta ahora se pisaban en silencio.
exposeGlobals({
  startMobileScanner,
  switchTab: wrapperSwitchTab,
  changeLanguage,
  handleRivenInput,
  openRivenMarket,
  toggleLangDropdown,
  setLanguageManual,
  openScanner,
  handleFileUpload,
  startLiveSession,
  stopLiveSession,
  checkUpdates,
  updateSelectExclusions,
  saveAppState,
  togglePiP: openPiP,
}, "main.js");
