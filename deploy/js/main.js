import { initCanvas } from "./canvas.js";
import { downloadRelics, fetchRivenWeapons, fetchUserProfile, fetchPrimeManifest, warmupPrices } from "./api.js";
import { state, loadAppState, saveAppState } from "./state.js";
import { startLiveSession, stopLiveSession } from "./live_scanner.js";
import {
  openScanner,
  closeScanner,
  captureRelics,
  handleFileUpload,
} from "./scanner.js";
import {
  switchTab,
  changeLanguage,
  initSyncPanel,
  initFissurePanel,
  initGlobalTooltipSystem,
  initLFGPresets,
  manualRelicUpdate,
  initDisclaimerSystem,
  setupGlobalClickListeners,
  renderSetTracker,
  generateMessage,
  copyText,
  changeCount,
  changeLFGCount,
  handleRelicTyping,
  handleSetTyping,
  handleRivenInput,
  openRivenMarket,
  calculateCaps,
  toggleLfgDropdown,
  checkUpdates,
  selectLfgOption,
  toggleLangDropdown,
  setLanguageManual,
  generateLFGMessage,
  toggleInventoryPanel,
  renderInventory,
  clearInventory,
  updateSelectExclusions,
  preloadCriticalAssets,
} from "./ui.js";
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    for (let registration of registrations) {
      console.log("Service Worker desregistrado para evitar conflictos.");
      registration.unregister();
    }
  });
}
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(globalThis.location.search);
  if (urlParams.get("clip")) {
    handleClipboardAction(urlParams.get("clip"));
    return;
  }
  checkUpdates();
  loadAppState();
  initCanvas();
  initDisclaimerSystem();
  setupGlobalClickListeners();
  initGlobalTooltipSystem();
  initSyncPanel();
  preloadCriticalAssets();
  setupScannerDrawer();

  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();
  switchTab(state.activeTab || "relic");

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
    } else {
      if (isNoticeVisible) {
        noticePanel.classList.add("hidden");
        toggleBtn.classList.remove("active");
      } else {
        noticePanel.classList.remove("hidden");
        toggleBtn.classList.add("active");
      }
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
    initFissurePanel().catch(console.error);

    // 1. Fetch static definitions (Weapons, Entities) to build Ducat DB first
    await Promise.all([
      fetchRivenWeapons(),
      fetchPrimeManifest()
    ]);

    // 2. Fetch Relics (dynamic) - now safe to use Ducat DB
    // We treat this as critical, so we await it.
    await downloadRelics();

    // Success actions
    if (state.selectedRelic) {
      const input = document.getElementById("relicInput");
      if (input) input.value = state.selectedRelic;
      manualRelicUpdate();
    }
    if (state.currentActiveSet) renderSetTracker();

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

globalThis.startMobileScanner = async function () {
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
    const { MobileScanner } = await import("./mobile_scanner.js");
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

globalThis.closeScanModal = function () {
  const modal = document.getElementById("scan-success-modal");
  if (modal) {
    modal.classList.add("hidden");
  }

  if (activeScannerInstance) {
    try {
      activeScannerInstance.close();
    } catch (e) {
      console.warn("Error al cerrar scanner desde modal:", e);
    }

    activeScannerInstance = null;
    isScannerActive = false;
  }

  const scanBtn = document.getElementById("mobile-scan-btn");
  if (scanBtn) {
    scanBtn.classList.remove("scanning", "processing");
  }
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

globalThis.switchTab = wrapperSwitchTab;

Object.assign(globalThis, {
  startMobileScanner: globalThis.startMobileScanner,
  switchTab: wrapperSwitchTab,
  changeLanguage,
  generateMessage,
  copyText,
  changeCount,
  changeLFGCount,
  handleRelicTyping,
  handleSetTyping,
  handleRivenInput,
  openRivenMarket,
  fetchUserProfile,
  calculateCaps,
  toggleLfgDropdown,
  selectLfgOption,
  toggleLangDropdown,
  setLanguageManual,
  generateLFGMessage,
  openScanner,
  closeScanner,
  captureRelics,
  handleFileUpload,
  toggleInventoryPanel,
  renderInventory,
  clearInventory,
  startLiveSession,
  stopLiveSession,
  checkUpdates,
  updateSelectExclusions,
});
