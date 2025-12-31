import { initCanvas } from "./canvas.js";
import { downloadRelics, fetchRivenWeapons, fetchUserProfile } from "./api.js";
import {
  switchTab,
  changeLanguage,
  generateMessage,
  copyText,
  updateLFGUI,
  handleRelicTyping,
  handleSetTyping,
  handleRivenInput,
  openRivenMarket,
  changeCount,
  changeLFGCount,
  toggleLfgDropdown,
  selectLfgOption,
  calculateCaps,
  renderSetTracker,
  toggleLangDropdown,
  setLanguageManual,
  manualRelicUpdate,
  generateLFGMessage as genLFG,
  initSyncPanel,
  initFissurePanel,
  initGlobalTooltipSystem,
  initLFGPresets,
} from "./ui.js";
import { state, loadAppState, saveAppState } from "./state.js";

document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const clipMsg = urlParams.get("clip");
  if (clipMsg) {
    window.history.replaceState({}, document.title, window.location.pathname);
    navigator.clipboard
      .writeText(clipMsg)
      .then(() => alert(`📋 ¡Copiado!\n\n"${clipMsg}"`))
      .catch(() => prompt("Copia tu mensaje:", clipMsg));
    return;
  }

  loadAppState();
  initCanvas();

  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();

  switchTab(state.activeTab || "relic");

  initFissurePanel();
  initSyncPanel();
  initGlobalTooltipSystem();

  const relicsPromise = downloadRelics().then(() => {
    if (state.selectedRelic) {
      const input = document.getElementById("relicInput");
      if (input) input.value = state.selectedRelic;
      manualRelicUpdate();
    }
  });

  const rivensPromise = fetchRivenWeapons();

  if (state.currentActiveSet) {
    renderSetTracker();
  }

  if (state.activeTab === "lfg") {
    initLFGPresets();
  }
});

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
  generateLFGMessage: genLFG,
});

document.addEventListener("click", (e) => {
  const target = e.target;

  const langWrapper = document.getElementById("langSelectorWrapper");
  const langList = document.getElementById("langOptionsList");
  if (
    langWrapper &&
    !langWrapper.contains(target) &&
    langList &&
    !langList.classList.contains("hidden")
  ) {
    langList.classList.add("hidden");
  }

  const lfgList = document.getElementById("lfgDropdown");
  const lfgTrigger =
    target.closest("[onclick*='toggleLfgDropdown']") ||
    target.closest(".custom-select-wrapper");
  if (lfgList && !lfgList.classList.contains("hidden")) {
    if (!lfgList.contains(target) && !lfgTrigger) {
      lfgList.classList.add("hidden");
    }
  }

  if (window.innerWidth <= 768) {
    const closeSidePanel = (panelId, btnId) => {
      const panel = document.getElementById(panelId);
      const btn = document.getElementById(btnId);
      if (panel && panel.classList.contains("open")) {
        if (!panel.contains(target) && (!btn || !btn.contains(target))) {
          panel.classList.remove("open");
        }
      }
    };

    closeSidePanel("best-missions-container", "mission-toggle-btn");
    closeSidePanel("cloud-sync-container", "sync-toggle-btn");
  }
});

setTimeout(() => {
  const disclaimer = document.getElementById("txt-disclaimer");
  if (disclaimer) {
    disclaimer.classList.add("fade-out");
    setTimeout(() => {
      disclaimer.style.display = "none";
    }, 2000);
  }
}, 8000);
