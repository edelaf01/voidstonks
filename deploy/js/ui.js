import { calculateRivenGrade } from "./utils/rivens/riven_logic.js";
import {
  TEXTS,
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
} from "./ui.components/inventory/ui_relics.js";
import { initSetSearchHelp } from "./ui.components/inventory/ui_sets.js?v=2.0";
import { renderSetTracker } from "./ui.components/inventory/ui_set_tracker.js";
import {
  updateLFGUI,
} from "./ui.components/ui_lfg.js";
import { populateRivenSelects, initRivenMarketIndex, updateIndexTranslations, filterRivenIndex, stopRivenShowcase } from "./ui.components/rivens/ui_rivens.js?v=1.11";
import { applyArbTexts } from "./ui.components/rivens/ui_arbitrage.js";
import { initVosforTab, renderVosforTab } from "./ui.components/ui_vosfor.js?v=2.9";
import { initSyncPanel } from "./ui.components/market/ui_sync.js";
import { initFissurePanel, updateRecommendedMissions } from "./ui.components/farms/ui_fissures.js?v=1.1";
import { exposeGlobals } from "./utils/global_registry.js";
import { state, saveAppState, updateInventoryCount } from "./state.js";
import { renderFarmsTab } from "./ui.components/farms/ui_farms.js";
import { renderFarmRoutes } from "./ui.components/farms/ui_farm_routes.js";
import { renderInventory, updateInventoryPanelLabels } from "./ui.components/inventory/ui_inventory.js";
import { renderPrimeInventory } from "./ui.components/inventory/ui_prime_inventory.js";
import { ScannerHUD } from "./ui.components/ui_scanner_hud.js";
import { ScannerModal } from "./ui.components/ui_scanner_modal.js";
// Traductor de Kubrows (EE.log) DESACTIVADO: su pestaña está oculta en index.html porque la
// lectura del log no da el resultado esperado. El import se deja comentado para que sus
// ~96 KB (parser + traducciones + paleta de colores) no viajen en cada visita; al
// reactivar el botón hay que descomentar también esta línea y su uso en switchTab.
// import { EELogParserUI } from "./ui.components/ui_ee_log_parser.js";
globalThis.TEXTS = TEXTS;

const iconPathCache = new Map();

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
  ["relic", "set", "riven", "lfg", "bounties", "vosfor", "ducat", "eelog", "orders"].forEach((m) => {
    document.getElementById("mode-" + m)?.classList.add("hidden");
  });
  document.getElementById("mode-" + mode)?.classList.remove("hidden");

  if (mode === "riven") {
    if (typeof initRivenMarketIndex === "function") {
      initRivenMarketIndex().catch(console.error);
    }
    applyArbTexts();
  } else if (mode === "relic") {
    // Las rutas son la pantalla de arranque de esta pestaña: #relic-contents está oculto
    // hasta que se elige una reliquia, así que sin esto se entra a un input vacío.
    renderFarmRoutes().catch((e) => console.warn("[rutas] al abrir Reliquia:", e));
  } else if (mode === "set") {
    if (typeof globalThis.searchSet === "function") {
      globalThis.searchSet();
    }
    // Tercera instancia de las rutas. renderFarmRoutes() pinta todas, así que basta con
    // llamarlo al entrar: la de esta pestaña se monta con las otras dos.
    renderFarmRoutes().catch((e) => console.warn("[rutas] al abrir Set:", e));
  } else if (mode === "vosfor") {
    initVosforTab().catch(console.error);
  } else if (mode === "ducat") {
    if (typeof globalThis.renderDucanatorTab === "function") globalThis.renderDucanatorTab();
  } else if (mode === "orders") {
    if (typeof globalThis.initOrdersTab === "function") globalThis.initOrdersTab();
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
    renderFarmsTab();
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
  setTab("btn-lfg", t.menuLfg || "LFG", t.tooltips.tabLfg);
  setTab("btn-bounties", t.menuBounties || "Farms", t.tooltips.tabBounties);
  setTab("btn-vosfor", t.vosfor?.tabName || "Vosfor", t.vosfor?.tabTip);
  // El tooltip llevaba tabTitle, o sea "Ducados" sobre un botón que ya dice "Ducados".
  // `desc` es la frase que explica para qué sirve la pestaña.
  setTab("btn-ducat", t.ducanator?.tabTitle || "Ducanator", t.ducanator?.desc);
  // Estos dos no pasan por setTab(): su icono es un <span> (emoji / chevron) y
  // setTab solo conserva el <img> al reescribir el innerHTML, asi que se lo comeria.
  setText("tab-orders-text", t.menuOrders || "Mis órdenes");
  setText("tab-more-text", t.menuMore || "Más");
  updateDucatFilterLabels(t);
}

function updateDucatFilterLabels(t) {
  const d = t.ducanator || {};
  setText("ducat-desc", d.desc);
  setPlaceholder("ducat-search", d.searchPlaceholder);
  setText("ducat-owned-label", d.ownedOnly);
  setText("ducat-threshold-label", d.threshold);
}

function updateStaticTexts(t) {
  // Toggle de idioma para la prosa editorial estática (.lang-es/.lang-en).
  // El CSS usa body[data-lang="en"] para mostrar/ocultar cada bloque.
  document.body.dataset.lang = state.currentLang;

  setText("txt-header-title", t.headerTitle);
  setText("txt-header-sub", t.headerSub);
  setText("txt-footer-data", t.footerData);
  setText("txt-contact-label", t.contactLabel);
  setText("txt-contact-link", t.contactLink);
  setText("btn-footer-updates", t.btnShowUpdates);
  setText("txt-privacy-link", t.privacyLink);
  setText("txt-guide-link", t.guideLink);
  setText("txt-about-link", t.aboutLink);
  setText("txt-contact-page-link", t.contactPageLink);
  setText("txt-terms-link", t.termsLink);
  setText("lbl-update-title", t.updateModalTitle);
  setText("btn-update-gotit", t.updateModalGotIt);
  setText("loadingText", t.loading);
  setText("loadingSub", t.loadingSub);

  setText("lbl-relic-name", t.lblRelic);
  setText("lbl-missing", t.lblMiss);
  setText("lbl-profit", t.lblProfit);
  setText("lbl-search-item", t.lblItem);
  // Se remonta con cada cambio de idioma: el texto de la ayuda vive dentro del botón.
  initSetSearchHelp();
  setText("lbl-riven-weapon", t.lblRivenW);
  setText("lbl-riven-stats", t.lblRivenS);
  // El botón de dirección del índice de rivens. Vive aquí y no en ui_rivens.js porque ese
  // fichero son 4.332 líneas congeladas como deuda (ARCHITECTURE.md §B: pueden encoger, no
  // crecer), y esto es una etiqueta, que es justo de lo que se ocupa este módulo.
  //
  // El título decía "Cambiar dirección" en español fijo: anuncia que hay un toggle pero no en
  // qué estado estás, y eso es lo único que no se deduce de una flecha girada 180°.
  const btnDir = document.getElementById("btn-index-sort-dir");
  if (btnDir) {
    const pintaDir = () => {
      const ri = TEXTS[state.currentLang]?.rivenIndex || {};
      const txt = btnDir.getAttribute("data-dir") === "asc" ? ri.sortAsc : ri.sortDesc;
      if (!txt) return;
      btnDir.title = txt;
      btnDir.setAttribute("aria-label", txt);
    };
    // El listener se engancha una vez: updateStaticTexts corre en cada cambio de idioma.
    if (!btnDir.dataset.dirLabelWired) {
      btnDir.dataset.dirLabelWired = "1";
      // Tras el handler de ui_rivens.js, que es quien reescribe data-dir.
      btnDir.addEventListener("click", () => setTimeout(pintaDir, 0));
    }
    pintaDir();
  }

  setText("btn-riven-search", t.rivenSearch);
  setText("btn-riven-grade", t.rivenGradeBtn);
  setText("grading-modal-title", t.rivenGradeTitle);
  setText("lbl-grading-variants", t.rivenGradeVariants);
  setText("riven-web-orders-label", t.rivenWebOrders);

  setText("txt-mod-preview", t.lblModPreview);
  setText("txt-weapon-guide", t.lblWeaponGuide);
  setText("txt-variants-header", t.rivenIndex?.variantsLabel || "VARIANTS");

  setText("lbl-riven-median-price", t.lblRivenMedian);
  setText("lbl-riven-low-price", t.lblRivenLow);
  setText("lbl-riven-high-price", t.lblRivenHigh);

  // lbl-username y txt-mr-label eran del perfil / calculadora de MR, que ya no tiene marcado
  // (ver la nota en main.js). setText solo hacía dos getElementById en balde en cada cambio
  // de idioma.
  setText("lbl-lfg-activity", t.lblLfgActivity);
  setText("lbl-lfg-players", t.lblLfgPlayers);
  setText("btn-copy", t.btnCopy);

  setText("txt-inv-title", t.inventory?.title);
  updateInventoryPanelLabels();
  setText("tracker-title", t.trackerTitle);
  setText("txt-fissure-title", t.lblFissures);
  setText("lbl-fast-farms-title", t.lblFastFarms || "Misiones Rápidas");

  const disclaimer = document.getElementById("txt-disclaimer");
  if (disclaimer) disclaimer.innerHTML = t.disclaimer;

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

  // Por data-lfg y no por posición: había una lista de 9 claves aquí que se aplicaba por
  // índice sobre las 17 opciones del HTML. La novena caía sobre "The Circuit", que se
  // repintaba como "Radshare" —se leía una actividad y se seleccionaba otra— y de la décima
  // en adelante (ESO, SO, bóvedas, Kuva, Sirius, Orion, Follie) no se traducía ninguna
  // aunque lfgOpts sí las tenga. Añadir una actividad al HTML ya no exige tocar esto.
  document.querySelectorAll("#lfgDropdown .dropdown-item[data-lfg]").forEach((item) => {
    const label = t.lfgOpts?.[item.dataset.lfg];
    if (label) item.innerText = label;
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
    setText("lbl-ocr-debug", sh.lblDebugSnapshot);
    setText("btn-copy-debug-log", sh.btnCopyLog);
    setText("lbl-detected-items", sh.lblDetected);
    setText("lbl-scan-empty-state", sh.lblEmpty);

    // Estos cuatro no pasaban por TEXTS: se quedaban en "⟳ AUTO", "↺ RESET GRID",
    // "SYSTEM DIAGNOSTICS" y "FRAMES: 0" en inglés fijo, con el título en inglés también.
    setText("btn-auto-scan", sh.btnAutoScan);
    setText("btn-reset-grid", sh.btnResetGrid);
    setText("lbl-rewards-diagnostics", sh.lblDiagnostics);
    setText("hud-scan-counter", "");

    const setTitle = (id, text) => {
      const el = document.getElementById(id);
      if (el && text) {
        el.title = text;
        el.setAttribute("aria-label", text);
      }
    };
    setTitle("btn-debug-toggle", sh.titleDebug);
    setTitle("btn-auto-scan", sh.titleAutoScan);
    setTitle("btn-clear-session", sh.titleClearSession);
    setTitle("btn-open-grid-editor", sh.titleEditCells);
    setTitle("btn-reset-grid", sh.titleResetGrid);
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
  if (state.activeTab === "bounties") renderFarmsTab();

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

  // if (typeof initSyncPanel === "function") initSyncPanel();  // Interfaz de nube (sync) desactivada de momento
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
  if (state.activeTab === "vosfor") renderVosforTab().catch(console.error);
  if (state.activeTab === "ducat" && typeof globalThis.renderDucanatorTab === "function") {
    globalThis.renderDucanatorTab();
  }
  triggerSideEffects(t);
}

// Initial subscription & trigger first call
state.subscribe("currentLang", updateUILabels);
updateUILabels();

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

function selectRelicFromPreview(relicName) {
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

function findRelicsForItem(itemName) {
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
    // "input", no "keyup": el campo escucha oninput y con keyup no se disparaba nada.
    setInput.dispatchEvent(new Event("input"));
  }
};

// showToast lo publica ui_components.js y saveAppState main.js: repetirlos aquí era un
// pisotón silencioso (ganaba el último módulo en evaluarse).
exposeGlobals({
  finishLoading,
  closeUpdateModal,
  showCustomConfirm,
  updatePriceUI,
  manualRelicUpdate,
  openUpdateHistory,

  handleInvSearch: (val) => {
    state.invSearchVal = val.toLowerCase().trim();
    renderInventory();
  },
  selectRelicFromPreview,
  findRelicsForItem,
}, "ui.js");

export { checkUpdates, initGlobalTooltipSystem, initDisclaimerSystem, closeUpdateModal } from "./ui.components/ui_components.js";