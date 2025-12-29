/* main.js */
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
  manualRelicUpdate,
  initFissures,
} from "./ui.js";
import { state, loadAppState, saveAppState } from "./state.js";

document.addEventListener("DOMContentLoaded", async () => {
  loadAppState();

  initCanvas();
  initFissures().then(() => console.log("Sidebar de fisuras listo"));
  const langSelect = document.getElementById("langSelect");
  if (langSelect) langSelect.value = state.currentLang;
  changeLanguage();

  switchTab("relic");

  await downloadRelics();
  fetchRivenWeapons();

  if (state.selectedRelic) {
    const input = document.getElementById("relicInput");
    if (input) input.value = state.selectedRelic;
    manualRelicUpdate();
  }

  if (state.currentActiveSet) {
    renderSetTracker();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveAppState();
});

window.switchTab = switchTab;
window.changeLanguage = changeLanguage;
window.generateMessage = generateMessage;
window.copyText = copyText;
window.changeCount = changeCount;
window.changeLFGCount = changeLFGCount;
window.handleRelicTyping = handleRelicTyping;
window.handleSetTyping = handleSetTyping;
window.handleRivenInput = handleRivenInput;
window.openRivenMarket = openRivenMarket;
window.fetchUserProfile = fetchUserProfile;
window.calculateCaps = calculateCaps;
window.toggleLfgDropdown = toggleLfgDropdown;
window.selectLfgOption = selectLfgOption;

import { generateLFGMessage as genLFG } from "./ui.js";
window.generateLFGMessage = genLFG;
