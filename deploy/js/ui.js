
import {
  TEXTS,
  TIER_URLS,

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

} from "./ui.components/ui_sets.js";
import {

  updateLFGUI,

} from "./ui.components/ui_lfg.js";
import { populateRivenSelects } from "./ui.components/ui_rivens.js";
import { state, saveAppState, updateInventoryCount } from "./state.js";
import { updateRecommendedMissions } from "./ui.components/ui_fissures.js";
import { renderBountiesTab } from "./ui.components/ui_bounties.js";
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
} const t = TEXTS[state.currentLang];

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
//TODO FIX THIS TOO COMPLEX se puede optimizar bastante pero hay que hacer cambios en la logica integral
export function changeLanguage() {
  const lang = localStorage.getItem("app_lang");
  if (lang) state.currentLang = lang;
  if (!state.currentLang) state.currentLang = "en";

  saveAppState();
  updateLangButtonVisuals(state.currentLang);

  const t = TEXTS[state.currentLang];

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

  setTab("btn-relic", t.menuRelic || "Reliquia", t.tooltips.tabRelic);
  setTab("btn-set", t.menuSet || "Set", t.tooltips.tabSet);
  setTab("btn-riven", t.menuRiven || "Riven", t.tooltips.tabRiven);
  setTab("btn-profile", t.menuProfile || "Perfil", t.tooltips.tabProfile);
  setTab("btn-lfg", t.menuLfg || "LFG", t.tooltips.tabLfg);
  setTab("btn-bounties", t.menuBounties || "Farms", t.tooltips.tabBounties);
  setText("txt-header-title", t.headerTitle);
  setText("txt-header-sub", t.headerSub);
  setText("txt-footer-data", t.footerData);
  setText("txt-contact-label", t.contactLabel);
  setText("txt-contact-link", t.contactLink);
  setText("btn-footer-updates", t.btnShowUpdates);
  setText("lbl-update-title", t.updateModalTitle);
  setText("btn-update-gotit", t.updateModalGotIt);
  const disclaimer = document.getElementById("txt-disclaimer");
  if (disclaimer) disclaimer.innerHTML = t.disclaimer;

  setText("loadingText", t.loading);
  setText("loadingSub", t.loadingSub);

  setText("lbl-relic-name", t.lblRelic);
  const relicInput = document.getElementById("relicInput");
  if (relicInput) relicInput.placeholder = t.phRelic;

  setText("lbl-missing", t.lblMiss);
  setText("lbl-profit", t.lblProfit);
  const elContents = document.getElementById("lbl-content");
  if (elContents) {
    elContents.innerText = t.lblContent;
    elContents.dataset.tooltip = t.tooltipContent;
    elContents.style.cursor = "help";
    elContents.style.color = "#888";
    elContents.style.textTransform = "uppercase";
    elContents.style.letterSpacing = "1px";
    elContents.style.fontWeight = "800";
    elContents.style.fontSize = "0.75em";
    elContents.style.display = "inline-block";
    elContents.style.width = "max-content";
    elContents.style.marginBottom = "8px";
    elContents.style.borderBottom = "none";
    elContents.style.filter = "none";
  }
  const refLabel = document.getElementById("lbl-refinement");
  if (refLabel) {
    refLabel.innerHTML = `${t.lblRef} <span data-tooltip="${t.tooltips.refinement}" style="cursor:help; opacity:0.7"> (?)</span>`;
  }
  const refSelect = document.getElementById("refinement");
  if (refSelect && t.refs) {
    Array.from(refSelect.options).forEach((opt) => {
      const key = opt.value.toLowerCase();
      if (t.refs[key]) opt.innerText = t.refs[key];
    });
  }

  const guideText = document.getElementById("relic-add-guide");
  if (guideText) guideText.innerText = t.addGuide;
  const guideIcon = document.getElementById("relic-guide-icon");
  if (guideIcon) guideIcon.dataset.tooltip = t.addGuide;

  setText("lbl-search-item", t.lblItem);
  const setInput = document.getElementById("setItemInput");
  if (setInput) setInput.placeholder = t.phItem;

  setText("lbl-riven-weapon", t.lblRivenW);
  const rivenInput = document.getElementById("rivenWeaponInput");
  if (rivenInput) rivenInput.placeholder = t.phRivenW;
  setText("lbl-riven-stats", t.lblRivenS);
  setText("btn-riven-search", t.rivenSearch);

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

  setText("lbl-username", t.lblUser);
  const btnCheck = document.querySelector("#mode-profile button");
  if (btnCheck) btnCheck.innerText = t.btnCheck;
  setText("txt-mr-label", t.lblMrCalc);

  setText("lbl-lfg-activity", t.lblLfgActivity);
  setText("lbl-lfg-players", t.lblLfgPlayers);
  setText("btn-copy", t.btnCopy);

  const lfgItems = document.querySelectorAll("#lfgDropdown .dropdown-item");
  const lfgKeys = [
    "eidolon",
    "profit",
    "eda",
    "temporal",
    "netra",
    "archon",
    "sortie",
    "arbi",
    "radshare",
  ];
  lfgKeys.forEach((key, idx) => {
    if (lfgItems[idx] && t.lfgOpts[key])
      lfgItems[idx].innerText = t.lfgOpts[key];
  });
  const currentLfgVal = document.getElementById("lfgActivity").value;
  if (t.lfgOpts[currentLfgVal])
    setText("lfgSelectedText", t.lfgOpts[currentLfgVal]);

  setText("txt-inv-title", t.inventory.title);
  setText("tracker-title", t.trackerTitle);
  if (state.currentActiveSet) renderSetTracker();
  const invInput = document.getElementById("inv-search-input");
  if (invInput) invInput.placeholder = t.inventory.searchPlaceholder;

  const primeInvInput = document.getElementById("prime-inv-search");
  if (primeInvInput && t.inventory.primeSearchPlaceholder) {
    primeInvInput.placeholder = t.inventory.primeSearchPlaceholder;
  }

  const primeSortSelect = document.getElementById("prime-inv-sort");
  if (primeSortSelect && t.inventory.primeSort) {
    Array.from(primeSortSelect.options).forEach((opt) => {
      const key = opt.value.toLowerCase();
      if (t.inventory.primeSort[key]) opt.innerText = t.inventory.primeSort[key];
    });
  }

  const relicSortSelect = document.getElementById("inv-sort");
  if (relicSortSelect && t.inventory.sort) {
    Array.from(relicSortSelect.options).forEach((opt) => {
      const key = opt.value;
      if (key === "plat_intact") opt.innerText = t.inventory.sort.valIntact;
      else if (key === "plat_rad") opt.innerText = t.inventory.sort.valRad;
      else if (t.inventory.sort[key]) opt.innerText = t.inventory.sort[key];
    });
  }

  setText("txt-fissure-title", t.lblFissures);
  setText("lbl-fast-farms-title", t.lblFastFarms || "Misiones Rápidas");

  const imgInv = document.getElementById("img-inv-toggle");
  if (imgInv) imgInv.alt = t.lblInventory;
  const imgFissure = document.getElementById("img-fissure-toggle");
  if (imgFissure) imgFissure.alt = t.lblFissures;

  populateRivenSelects();

  const modeLfg = document.getElementById("mode-lfg");
  if (modeLfg && !modeLfg.classList.contains("hidden")) updateLFGUI();

  if (state.currentActiveSet) renderSetTracker();
  if (state.activeTab === "bounties") {
    renderBountiesTab();
  }
  const tier = document.getElementById("relicInput").value.split(" ")[0];
  if (tier && state.selectedRelic) updateRecommendedMissions(tier);
  if (state.selectedRelic) manualRelicUpdate();

  // Scanner HUD translations
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

  const ct = t.calib;
  if (ct) {
    setText("lbl-calib-title", ct.title);
    setText("btn-calib-skip", ct.btnSkip);
  }

  generateMessage();
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
  state.currentLang = langCode;
  saveAppState();
  changeLanguage();
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

export function setupGlobalClickListeners() {
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