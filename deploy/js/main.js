import { initCanvas } from "./canvas.js";
import { downloadRelics, fetchRivenWeapons, fetchUserProfile } from "./api.js";
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
  const urlParams = new URLSearchParams(window.location.search);
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
  setupScannerDrawer();

  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();
  switchTab(state.activeTab || "relic");

  if (state.currentActiveSet) renderSetTracker();
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
    const isClosed = drawer.classList.contains("closed");
    const isNoticeVisible = !noticePanel.classList.contains("hidden");

    if (!isClosed) {
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

      drawer.classList.remove("closed");
      drawer.classList.add("open");
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
  window.history.replaceState({}, document.title, window.location.pathname);
  navigator.clipboard
    .writeText(msg)
    .then(() => alert(` Copied!\n\n"${msg}"`))
    .catch(() => prompt("Copy your message:", msg));
}

async function loadAsyncData() {
  try {
    initFissurePanel().catch(console.error);
    const [relicsResult] = await Promise.allSettled([
      downloadRelics(),
      fetchRivenWeapons(),
    ]);
    if (relicsResult.status === "fulfilled" && state.selectedRelic) {
      const input = document.getElementById("relicInput");
      if (input) input.value = state.selectedRelic;
      manualRelicUpdate();
    }
  } catch (error) {
    console.error("Error crítico cargando datos:", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveAppState();
});

Object.assign(window, {
  switchTab,
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
