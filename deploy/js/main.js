import { initCanvas } from "./canvas.js";
import { downloadRelics, fetchRivenWeapons, fetchUserProfile } from "./api.js";
import { state, loadAppState, saveAppState } from "./state.js";
import "./scanner.js";
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
  selectLfgOption,
  toggleLangDropdown,
  setLanguageManual,
  generateLFGMessage,
  toggleInventoryPanel,
  renderInventory,
  clearInventory,
} from "./ui.js";
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const clipMsg = urlParams.get("clip");
  if (clipMsg) {
    handleClipboardAction(clipMsg);
    return;
  }

  loadAppState();
  initCanvas();
  initDisclaimerSystem();
  setupGlobalClickListeners();
  initGlobalTooltipSystem();
  initSyncPanel();

  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();
  switchTab(state.activeTab || "relic");

  if (state.currentActiveSet) renderSetTracker();
  if (state.activeTab === "lfg") initLFGPresets();

  loadAsyncData();
});

function handleClipboardAction(msg) {
  window.history.replaceState({}, document.title, window.location.pathname);
  navigator.clipboard
    .writeText(msg)
    .then(() => alert(`📋 ¡Copiado!\n\n"${msg}"`))
    .catch(() => prompt("Copia tu mensaje:", msg));
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
    console.error("Error crítico cargando datos iniciales:", error);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveAppState();
});

const globalExports = {
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
};

Object.assign(window, globalExports);
