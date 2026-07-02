import { calculateRivenGrade } from "./utils/riven_logic.js";
import {
  TEXTS,
  TIER_URLS,
  RIVEN_STATS,
  DROP_CHANCES,
  WORKER_URL,
  RIVEN_BASE_STATS,
  WEAPON_TYPE_IDX,
  APP_VERSION,
} from "./config.js";
import {
  showToast,
  showCustomConfirm,
  closeUpdateModal,
  openUpdateHistory,
} from "./ui.components/ui_components.js";

import {
  manualRelicUpdate,
  updateRelicTotal,
  generateMessage,
} from "./ui.components/ui_relics.js";
import {
  renderSetTracker,
} from "./ui.components/ui_sets.js?v=1.9";
import {
  updateLFGUI,
} from "./ui.components/ui_lfg.js";
import { populateRivenSelects, initRivenMarketIndex, updateIndexTranslations, filterRivenIndex, stopRivenShowcase } from "./ui.components/ui_rivens.js?v=1.10";
import { applyArbTexts } from "./ui.components/ui_arbitrage.js";
import { initSyncPanel } from "./ui.components/ui_sync.js";
import { initFissurePanel, updateRecommendedMissions } from "./ui.components/ui_fissures.js";
import { state, saveAppState, updateInventoryCount } from "./state.js";
import { renderBountiesTab } from "./ui.components/ui_bounties.js";
import { renderInventory, renderPrimeInventory } from "./ui.components/ui_inventory.js";
import { ScannerHUD } from "./ui.components/ui_scanner_hud.js";
import { ScannerModal } from "./ui.components/ui_scanner_modal.js";
globalThis.TEXTS = TEXTS;

const iconPathCache = new Map();

/**
 * Preloads critical UI assets to avoid network calls during interaction.
 */
export function preloadCriticalAssets() {
  const assets = [
    "assets/relic_contents/platinum.webp",
    ...Object.values(TIER_URLS),
  ];
  assets.forEach((url) => {
    const img = new Image();
    img.src = url;
  });
}

export function finishLoading() {
  const loadEl = document.getElementById("loading");
  if (loadEl) loadEl.style.display = "none";

  const countEl = document.getElementById("relicCount");
  if (countEl) countEl.innerText = `${state.allRelicNames.length} reliquias`;

  const modeRelic = document.getElementById("mode-relic");
  if (modeRelic) modeRelic.classList.remove("hidden");

  if (state.selectedRelic) manualRelicUpdate();
}

export function switchTab(mode) {
  state.activeTab = mode;
  saveAppState();
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const btn = document.getElementById("btn-" + mode);
  if (btn) btn.classList.add("active");

  const mainCard = document.getElementById("main-card");
  if (mainCard) {
    mainCard.className = "card";
    mainCard.classList.add(`theme-${mode}`);
  }

  document.body.className = document.body.className
    .replace(/\btheme-\S+/g, "")
    .trim();
  document.body.classList.add(`theme-${mode}`);

  if (mode === "bounties" && mainCard) mainCard.classList.add("theme-bounties");
  ["relic", "set", "riven", "profile", "lfg", "bounties"].forEach((m) => {
    document.getElementById("mode-" + m)?.classList.add("hidden");
  });
  document.getElementById("mode-" + mode)?.classList.remove("hidden");

  if (mode === "riven") {
    if (typeof initRivenMarketIndex === "function") {
      initRivenMarketIndex().catch(console.error);
    }
    applyArbTexts();
  } else if (mode === "set") {
    if (typeof globalThis.searchSet === "function") {
      globalThis.searchSet();
    }
  }

  const footer = document.getElementById("footer-relic");
  const msgText = document.getElementById("finalMessage");

  if (footer) {
    if (mode === "lfg") {
      footer.style.display = "block";
      footer.style.borderTopColor = "#42f56c";
      if (msgText) msgText.style.color = "#42f56c";
    } else if (mode === "relic") {
      footer.style.display = "block";
      footer.style.borderTopColor = "#333";
      if (msgText) msgText.style.color = "#00e5ff";
      else if (mode === "live") {
        document.getElementById("mode-live").classList.remove("hidden");
      }
    } else {
      footer.style.display = "none";
    }
  }
  const invBtn = document.getElementById("inv-toggle-btn");
  if (invBtn) {
    const tabsWithInventory = ["relic", "set", "bounties"];
    if (tabsWithInventory.includes(mode)) {
      invBtn.classList.remove("hidden");
      invBtn.style.display = "flex";
    } else {
      invBtn.classList.add("hidden");
      invBtn.style.display = "none";
    }
  }
  if (mode === "bounties") {
    renderBountiesTab();
    document.querySelector(".card").classList.add("theme-bounties");
  } else {
    const card = document.querySelector(".card");
    if (card) card.classList.remove("theme-bounties");
  }
  const resultsPanel = document.getElementById("scanned-results-panel");
  if (resultsPanel) {
    resultsPanel.classList.add("hidden");
  }
  const overlay = document.getElementById("ocr-overlay");
  if (overlay && !overlay.classList.contains("hidden")) {
    overlay.classList.add("hidden");
    if (globalThis.closeScanner) globalThis.closeScanner();
  }
  if (mode === "lfg") updateLFGUI();
  else generateMessage();
}
export function changeLanguage(langCode) {
  if (langCode) state.currentLang = langCode;

  localStorage.setItem("app_lang", state.currentLang);
  saveAppState();
}

/**
 * Updates all UI text labels based on the current language.
 */

const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el && text) el.innerText = text;
};

const setTab = (id, text, tip) => {
  const el = document.getElementById(id);
  if (el) {
    const img = el.querySelector("img");
    el.innerHTML = "";
    if (img) el.appendChild(img);
    el.appendChild(document.createTextNode(" " + text));
    if (tip) el.dataset.tooltip = tip;
  }
};

const setPlaceholder = (id, text) => {
  const el = document.getElementById(id);
  if (el && text) el.placeholder = text;
};


function updateNavTabs(t) {
  setTab("btn-relic", t.menuRelic || "Reliquia", t.tooltips.tabRelic);
  setTab("btn-set", t.menuSet || "Set", t.tooltips.tabSet);
  setTab("btn-riven", t.menuRiven || "Riven", t.tooltips.tabRiven);
  setTab("btn-profile", t.menuProfile || "Perfil", t.tooltips.tabProfile);
  setTab("btn-lfg", t.menuLfg || "LFG", t.tooltips.tabLfg);
  setTab("btn-bounties", t.menuBounties || "Farms", t.tooltips.tabBounties);
}

function updateStaticTexts(t) {
  setText("txt-header-title", t.headerTitle);
  setText("txt-header-sub", t.headerSub);
  setText("txt-footer-data", t.footerData);
  setText("txt-contact-label", t.contactLabel);
  setText("txt-contact-link", t.contactLink);
  setText("btn-footer-updates", t.btnShowUpdates);
  setText("lbl-update-title", t.updateModalTitle);
  setText("btn-update-gotit", t.updateModalGotIt);
  setText("loadingText", t.loading);
  setText("loadingSub", t.loadingSub);

  setText("lbl-relic-name", t.lblRelic);
  setText("lbl-missing", t.lblMiss);
  setText("lbl-profit", t.lblProfit);
  setText("lbl-search-item", t.lblItem);
  setText("lbl-riven-weapon", t.lblRivenW);
  setText("lbl-riven-stats", t.lblRivenS);
  setText("btn-riven-search", t.rivenSearch);

  setText("txt-mod-preview", t.lblModPreview);
  setText("txt-weapon-guide", t.lblWeaponGuide);
  setText("txt-variants-header", t.rivenIndex?.variantsLabel || "VARIANTS");

  setText("lbl-riven-median-price", t.lblRivenMedian);
  setText("lbl-riven-low-price", t.lblRivenLow);
  setText("lbl-riven-high-price", t.lblRivenHigh);

  setText("lbl-username", t.lblUser);
  setText("txt-mr-label", t.lblMrCalc);
  setText("lbl-lfg-activity", t.lblLfgActivity);
  setText("lbl-lfg-players", t.lblLfgPlayers);
  setText("btn-copy", t.btnCopy);

  setText("txt-inv-title", t.inventory?.title);
  setText("tracker-title", t.trackerTitle);
  setText("txt-fissure-title", t.lblFissures);
  setText("lbl-fast-farms-title", t.lblFastFarms || "Misiones Rápidas");

  const disclaimer = document.getElementById("txt-disclaimer");
  if (disclaimer) disclaimer.innerHTML = t.disclaimer;

  const btnCheck = document.querySelector("#mode-profile button");
  if (btnCheck) btnCheck.innerText = t.btnCheck;

  const guideText = document.getElementById("relic-add-guide");
  if (guideText) guideText.innerText = t.addGuide;

  const guideIcon = document.getElementById("relic-guide-icon");
  if (guideIcon) guideIcon.dataset.tooltip = t.addGuide;
}

function updateInputsAndContent(t) {
  setPlaceholder("relicInput", t.phRelic);
  setPlaceholder("setItemInput", t.phItem);
  setPlaceholder("rivenWeaponInput", t.phRivenW);
  setPlaceholder("inv-search-input", t.inventory?.searchPlaceholder);
  setPlaceholder("prime-inv-search", t.inventory?.primeSearchPlaceholder);

  const elContents = document.getElementById("lbl-content");
  if (elContents) {
    elContents.innerText = t.lblContent;
    elContents.dataset.tooltip = t.tooltipContent;
    Object.assign(elContents.style, {
      cursor: "help", color: "#888", textTransform: "uppercase",
      letterSpacing: "1px", fontWeight: "800", fontSize: "0.75em",
      display: "inline-block", width: "max-content", marginBottom: "8px",
      borderBottom: "none", filter: "none"
    });
  }

  const refLabel = document.getElementById("lbl-refinement");
  if (refLabel) {
    refLabel.innerHTML = `${t.lblRef} <span data-tooltip="${t.tooltips.refinement}" style="cursor:help; opacity:0.7"> (?)</span>`;
  }

  const imgInv = document.getElementById("img-inv-toggle");
  if (imgInv) imgInv.alt = t.lblInventory;

  const imgFissure = document.getElementById("img-fissure-toggle");
  if (imgFissure) imgFissure.alt = t.lblFissures;
}

function updateSelectDropdowns(t) {
  const updateOptions = (id, dict) => {
    const select = document.getElementById(id);
    if (!select || !dict) return;
    Array.from(select.options).forEach((opt) => {
      const key = opt.value.toLowerCase();
      if (dict[key]) opt.innerText = dict[key];
    });
  };

  updateOptions("refinement", t.refs);
  updateOptions("prime-inv-sort", t.inventory?.primeSort);

  const relicSortSelect = document.getElementById("inv-sort");
  if (relicSortSelect && t.inventory?.sort) {
    Array.from(relicSortSelect.options).forEach((opt) => {
      const key = opt.value;
      if (key === "plat_intact") opt.innerText = t.inventory.sort.valIntact;
      else if (key === "plat_rad") opt.innerText = t.inventory.sort.valRad;
      else if (t.inventory.sort[key]) opt.innerText = t.inventory.sort[key];
    });
  }

  const lfgItems = document.querySelectorAll("#lfgDropdown .dropdown-item");
  const lfgKeys = ["eidolon", "profit", "eda", "temporal", "netra", "archon", "sortie", "arbi", "radshare"];
  lfgKeys.forEach((key, idx) => {
    if (lfgItems[idx] && t.lfgOpts?.[key]) {
      lfgItems[idx].innerText = t.lfgOpts[key];
    }
  });

  const currentLfgVal = document.getElementById("lfgActivity")?.value;
  if (currentLfgVal && t.lfgOpts?.[currentLfgVal]) {
    setText("lfgSelectedText", t.lfgOpts[currentLfgVal]);
  }
}

function updateRivenSelects(t) {
  const phStat = t.lblRivenPos || "+ STAT";
  const phNeg = t.lblRivenNeg || "- NEGATIVA";

  document.querySelectorAll(".riven-stat-select").forEach((sel) => {
    const isNeg = sel.classList.contains("negative");
    const firstOpt = sel.options[0];
    if (firstOpt?.value === "") {
      if (isNeg) {
        firstOpt.innerText = phNeg;
      } else {
        const num = sel.id.match(/\d/)?.[0] || "";
        firstOpt.innerText = `${phStat} ${num}`.trim();
      }
    }
  });
}

function updateScannerAndCalib(t) {
  const sh = t.scannerHUD;
  if (sh) {
    setText("hud-title", sh.title);
    setText("hud-context-badge", sh.statusIdle);
    setText("btn-debug-toggle", sh.btnDebug);
    setText("btn-manual-scan", sh.btnScan);
    setText("btn-save-inv", sh.btnSave);
    setText("btn-recalibrate", sh.btnRecalibrate);
    setText("btn-open-grid-editor", sh.btnEditCells);
    setText("edit-mode-title", sh.editTitle);
    setText("edit-mode-guide", sh.editGuide);
    setText("btn-edit-done", sh.btnDone);
    setText("lbl-ocr-debug", sh.btnDebug + " Snapshot");
    setText("btn-copy-debug-log", sh.btnCopyLog);
    setText("lbl-detected-items", sh.lblDetected);
    setText("lbl-scan-empty-state", sh.lblEmpty);
  }

  const histLabel = document.querySelector("#btn-scan-history .history-btn-label");
  if (histLabel && t.history?.btnLabel) {
    histLabel.innerText = t.history.btnLabel;
  }

  const histTitle = document.querySelector("#scan-history-dropdown .scan-history-title");
  if (histTitle && t.history?.title) {
    histTitle.innerText = t.history.title;
  }

  const histClear = document.querySelector("#scan-history-dropdown .scan-history-clear-btn");
  if (histClear && t.history?.btnClearTooltip) {
    histClear.title = t.history.btnClearTooltip;
  }

  const ct = t.calib;
  if (ct) {
    setText("lbl-calib-title", ct.title);
    setText("btn-calib-skip", ct.btnSkip);
  }
}

function triggerSideEffects(t) {
  populateRivenSelects();

  const modeLfg = document.getElementById("mode-lfg");
  if (modeLfg && !modeLfg.classList.contains("hidden")) updateLFGUI();

  if (state.currentActiveSet) renderSetTracker();
  if (state.activeTab === "bounties") renderBountiesTab();

  const relicInput = document.getElementById("relicInput");
  const tier = relicInput ? relicInput.value.split(" ")[0] : "";
  if (tier && state.selectedRelic) updateRecommendedMissions(tier);
  if (state.selectedRelic) manualRelicUpdate();

  generateMessage();

  // Refresh major components
  if (typeof renderInventory === "function") renderInventory();
  if (typeof renderPrimeInventory === "function") renderPrimeInventory();

  // Scanner Context Update
  if (ScannerHUD !== undefined) {
    const badge = document.getElementById("hud-context-badge");
    if (badge && t.scannerHUD) {
      const context = badge.innerText;
      const sh = t.scannerHUD;
      let type = "IDLE";
      if (context === sh.statusInventory) type = "INVENTORY";
      else if (context === sh.statusRelics) type = "RELICS";
      else if (context === sh.statusReward) type = "REWARD";
      else if (context === "MODS") type = "INVENTORY_MODS";
      ScannerHUD.updateContext(type);
    }
  }

  const modal = document.getElementById("scan-success-modal");
  if (modal && !modal.classList.contains("hidden") && typeof ScannerModal !== "undefined") {
    ScannerModal.localizeLabels(modal);
  }

  if (typeof initSyncPanel === "function") initSyncPanel();
  if (typeof initFissurePanel === "function") initFissurePanel().catch(console.error);
}

export function updateUILabels() {
  saveAppState();
  updateLangButtonVisuals(state.currentLang);

  const t = TEXTS[state.currentLang];
  if (!t) return;

  updateNavTabs(t);
  updateStaticTexts(t);
  updateInputsAndContent(t);
  updateSelectDropdowns(t);
  updateRivenSelects(t);
  updateScannerAndCalib(t);
  if (typeof updateIndexTranslations === "function") {
    updateIndexTranslations();
    if (state.rivenIndexData) {
      filterRivenIndex();
    }
  }
  applyArbTexts();
  triggerSideEffects(t);
}

// Initial subscription & trigger first call
state.subscribe("currentLang", updateUILabels);
updateUILabels();

globalThis.selectRelicFromPreview = function (relicName) {
  switchTab("relic");

  const input = document.getElementById("relicInput");
  if (input) {
    input.value = relicName;
    state.selectedRelic = relicName;
    manualRelicUpdate();
  }

  const status = state.relicStatusDB ? state.relicStatusDB[relicName] : null;
  let msg = `Navigated to ${relicName}`;
  if (status) {
    if (status === "vaulted") msg += " (VAULTED)";
    else msg += " (ACTIVE)";
  }
  showToast(msg);
};
function resetLoadingStyle(element) {
  if (!element) return;
  element.style.opacity = "1";
  element.style.pointerEvents = "auto";
}

export function toggleLangDropdown() {
  const list = document.getElementById("langOptionsList");
  if (list) list.classList.toggle("hidden");
}

export function setLanguageManual(langCode) {
  changeLanguage(langCode);
  updateLangButtonVisuals(langCode);
  document.getElementById("langOptionsList").classList.add("hidden");
}

function updateLangButtonVisuals(lang) {
  const img = document.getElementById("currentFlag");
  const txt = document.getElementById("currentLangText");

  if (lang === "es") {
    img.src = "https://flagcdn.com/24x18/es.png";
    txt.innerText = "ES";
  } else {
    img.src = "https://flagcdn.com/24x18/gb.png";
    txt.innerText = "EN";
  }
}

export function bindInputsToState() {
  const listen = (id, prop) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      state[prop] = e.target.value;
      saveAppState();
    });
    // Also bind input for real-time tracking if needed
    el.addEventListener("input", (e) => {
      state[prop] = e.target.value;
    });
  };

  listen("relicInput", "selectedRelic");
  listen("refinement", "refinement");
  listen("usernameInput", "username");
  listen("mrInput", "mr");
  listen("lfgActivity", "lfgActivity");
}

export function setupGlobalClickListeners() {
  bindInputsToState();
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

    if (globalThis.innerWidth <= 768) {
      const closeSidePanel = (panelId, btnId) => {
        const panel = document.getElementById(panelId);
        const btn = document.getElementById(btnId);
        if (panel?.classList.contains("open")) {
          if (!panel.contains(target) && !btn?.contains(target)) {
            panel.classList.remove("open");
          }
        }
      };
      closeSidePanel("best-missions-container", "mission-toggle-btn");
      closeSidePanel("cloud-sync-container", "sync-toggle-btn");
      closeSidePanel("inventory-container", "inv-toggle-btn");
    }

    const actionTarget = target.closest("[data-action]");
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      const data = actionTarget.dataset;
      console.log(`[UI ACTION]: ${action}`, data);

      switch (action) {
        case "find-relics-for-item":
          if (typeof globalThis.findRelicsForItem === "function") {
            globalThis.findRelicsForItem(data.item);
          }
          break;
        case "load-lfg-preset":
          if (typeof globalThis.loadLFGPreset === "function") {
            globalThis.loadLFGPreset(parseInt(data.index));
          }
          break;
        case "delete-lfg-preset":
          if (typeof globalThis.deleteLFGPreset === "function") {
            globalThis.deleteLFGPreset(parseInt(data.index));
          }
          break;
        case "save-lfg-preset":
          if (typeof globalThis.saveLFGPreset === "function") {
            globalThis.saveLFGPreset();
          }
          break;
        case "load-trade-preset":
          if (typeof globalThis.loadTradePreset === "function") {
            globalThis.loadTradePreset(parseInt(data.index));
          }
          break;
        case "delete-trade-preset":
          if (typeof globalThis.deleteTradePreset === "function") {
            globalThis.deleteTradePreset(parseInt(data.index));
          }
          break;
        case "save-trade-preset":
          if (typeof globalThis.saveTradePreset === "function") {
            globalThis.saveTradePreset();
          }
          break;
      }
    }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  const contentArea = document.querySelector(".content-area");
  const footerRelic = document.getElementById("footer-relic");

  if (!contentArea || !footerRelic) return;

  function checkFooterVisibility() {
    if (contentArea.scrollHeight <= contentArea.clientHeight) {
      footerRelic.classList.add("footer-visible");
      return;
    }

    const scrollBottom = contentArea.scrollTop + contentArea.clientHeight;
    const distanceToBottom = contentArea.scrollHeight - scrollBottom;

    if (distanceToBottom < 80) {
      footerRelic.classList.add("footer-visible");
    } else {
      footerRelic.classList.remove("footer-visible");
    }
  }

  contentArea.addEventListener("scroll", checkFooterVisibility);

  checkFooterVisibility();
});





export function updatePriceUI(element, price) {
  if (!element) return;
  element.classList.remove("loading");
  element.innerHTML = `${price}<span class="plat-icon-inline"></span>`;
  if (document.getElementById("relic-profit-display")) updateRelicTotal();
}

globalThis.selectRelicFromPreview = function (relicName) {
  switchTab("relic");
  const input = document.getElementById("relicInput");
  if (input) {
    input.value = relicName;
    state.selectedRelic = relicName;
    manualRelicUpdate();
  }
  const status = state.relicStatusDB ? state.relicStatusDB[relicName] : null;
  let msg = `Navigated to ${relicName}`;
  if (status) {
    if (status === "vaulted") msg += " (VAULTED)";
    else msg += " (ACTIVE)";
  }
  showToast(msg);
};

globalThis.findRelicsForItem = function (itemName) {
  const setInput = document.getElementById("setItemInput");
  if (setInput) {
    let searchTerm = itemName;
    if (itemName.includes("Prime"))
      searchTerm = itemName.split("Prime")[0].trim() + " Prime";
    else if (itemName.includes("Vandal"))
      searchTerm = itemName.split("Vandal")[0].trim() + " Vandal";
    else if (itemName.includes("Wraith"))
      searchTerm = itemName.split("Wraith")[0].trim() + " Wraith";
    else searchTerm = itemName.replaceAll("Blueprint", "").trim();

    setInput.value = searchTerm;
    switchTab("set");
    setInput.focus();
    const event = new Event("keyup");
    setInput.dispatchEvent(event);
  }
};

Object.assign(globalThis, {
  showToast,
  finishLoading,
  closeUpdateModal,
  showCustomConfirm,
  updatePriceUI,
  manualRelicUpdate,
  saveAppState,
  openUpdateHistory,

  handleInvSearch: (val) => {
    state.invSearchVal = val.toLowerCase().trim();
    renderInventory();
  },
});

export { checkUpdates, initGlobalTooltipSystem, initDisclaimerSystem, closeUpdateModal } from "./ui.components/ui_components.js";