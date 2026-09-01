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
  updateProfitLabel,
} from "./ui.components/inventory/ui_relics.js";
import { initSetSearchHelp } from "./ui.components/inventory/ui_sets.js?v=2.0";
import { renderSetTracker } from "./ui.components/inventory/ui_set_tracker.js";
import {
  updateLFGUI,
  renderLFGPresets,
  renderTradePresets,
} from "./ui.components/ui_lfg.js";
import { populateRivenSelects, initRivenMarketIndex, updateIndexTranslations, filterRivenIndex, stopRivenShowcase } from "./ui.components/rivens/ui_rivens.js?v=1.11";
import { applyArbTexts } from "./ui.components/rivens/ui_arbitrage.js";
import { initVosforTab, renderVosforTab } from "./ui.components/ui_vosfor.js?v=2.9";
import { initSyncPanel } from "./ui.components/market/ui_sync.js";
import { initFissurePanel, updateRecommendedMissions } from "./ui.components/farms/ui_fissures.js?v=1.1";
import { exposeGlobals } from "./utils/global_registry.js";
import { readTabHash, writeTabHash, onTabHashChange } from "./utils/tab_hash.js";
import { updateGuideLink } from "./ui.components/ui_hints.js";
import { state, saveAppState, updateInventoryCount, TABS } from "./state.js";
import { renderFarmsTab } from "./ui.components/farms/ui_farms.js";
import { renderFarmRoutes } from "./ui.components/farms/ui_farm_routes.js";
import { renderInventory, updateInventoryPanelLabels } from "./ui.components/inventory/ui_inventory.js";
import { renderPrimeInventory } from "./ui.components/inventory/ui_prime_inventory.js";
import { ScannerHUD, renderOcrEngine } from "./ui.components/ui_scanner_hud.js";
import { updateScannerLabels } from "./ui.components/ui_scanner_labels.js";
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

  // Solo si es la pestaña abierta. Esto corre cuando terminan de bajar las bases de reliquias
  // (relics.service.js), que en una conexión normal tarda segundos: si mientras tanto te has
  // ido a Set —o has recargado dentro de Set—, des-ocultarla a secas colaba la pestaña
  // Reliquia entera encima de la que estabas mirando, con su buscador, su lista y su
  // seguidor de sets.
  const modeRelic = document.getElementById("mode-relic");
  if (modeRelic && state.activeTab === "relic") modeRelic.classList.remove("hidden");

  if (state.selectedRelic) manualRelicUpdate();
}

/**
 * Lo que cada pestaña tiene que montar al entrar en ella.
 *
 * Aparte de switchTab() porque hay un segundo momento en el que hace falta: al arrancar,
 * switchTab() corre ANTES de que lleguen las bases de datos, así que cada pestaña se monta
 * con `setsDatabase`/`itemsDatabase`/manifiesto vacíos y se queda a medias. Antes solo el
 * panel de rutas se volvía a pintar al terminar la descarga; las demás no, y por eso al
 * recargar dentro de Set, Ducados o Riven aparecía media pestaña hasta que cambiabas a otra
 * y volvías —que es exactamente cuando esto se ejecutaba otra vez—.
 */
function initTabContent(mode) {
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
  } else if (mode === "bounties") {
    renderFarmsTab();
  }
}

/** Vuelve a montar la pestaña en la que está el usuario. La llama main.js cuando terminan de
 *  bajar los datos, que es lo que le faltaba a la pasada del arranque. */
export function refreshActiveTab() {
  initTabContent(state.activeTab);
}

// Cerrojo del enrutado: onTabHashChange llama a switchTab, y switchTab escribe el hash. Sin
// esto, volver atrás empujaba una entrada nueva y el historial no avanzaba nunca hacia atrás.
let navegandoPorHistorial = false;

/** La pestaña que pide la URL, si es una de las que existen. La usa main.js al arrancar. */
export function tabFromUrl() {
  return readTabHash(TABS);
}

export function initTabRouting() {
  onTabHashChange(TABS, (mode) => {
    if (mode === state.activeTab) return;
    navegandoPorHistorial = true;
    try {
      switchTab(mode);
    } finally {
      navegandoPorHistorial = false;
    }
  });
}

export function switchTab(mode) {
  state.activeTab = mode;
  saveAppState();
  if (!navegandoPorHistorial) writeTabHash(mode);
  updateGuideLink(mode, state.currentLang);
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
  TABS.forEach((m) => {
    document.getElementById("mode-" + m)?.classList.add("hidden");
  });
  document.getElementById("mode-" + mode)?.classList.remove("hidden");

  initTabContent(mode);

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
    // El renderFarmsTab() de esta rama se fue a initTabContent(), que es lo que se vuelve a
    // llamar cuando terminan de bajar los datos; aquí solo queda el tema de la card.
    document.querySelector(".card")?.classList.add("theme-bounties");
  } else {
    const card = document.querySelector(".card");
    if (card) card.classList.remove("theme-bounties");
  }
  const resultsPanel = document.getElementById("scanned-results-panel");
  if (resultsPanel) {
    resultsPanel.classList.add("hidden");
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

const setTooltip = (id, text) => {
  const el = document.getElementById(id);
  if (el && text) el.dataset.tooltip = text;
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
  // Corto a propósito: la pestaña mide 120 px y, entre el icono y el distintivo WIP, al
  // rótulo le quedan ~40 — "Mis órdenes" se veía como "Mis …" al abrirla.
  setText("tab-orders-text", t.menuOrders || "Órdenes");
  setText("tab-more-text", t.menuMore || "Más");
  updateDucatFilterLabels(t);
}

function updateDucatFilterLabels(t) {
  const d = t.ducanator || {};
  setText("ducat-desc", d.desc);
  setPlaceholder("ducat-search", d.searchPlaceholder);
  setText("ducat-owned-label", d.ownedOnly);
  // El chip solo mira TU inventario: apagarlo añade las piezas a 0, nunca el catálogo. Sin
  // decirlo, el rótulo prometía un complemento que la vista no puede dar.
  const ownedChip = document.getElementById("ducat-owned-chip");
  if (ownedChip && d.ownedOnlyTitle) ownedChip.dataset.tooltip = d.ownedOnlyTitle;
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
  setText("lbl-squad", t.lblSquad);
  // El rótulo depende de state.squadSize, no solo del idioma: lo monta ui_relics.js.
  updateProfitLabel();
  setTooltip("lbl-squad", t.lblSquadHelp);
  setTooltip("lbl-missing", t.lblMissHelp);
  setText("lbl-search-item", t.lblItem);
  // Se remonta con cada cambio de idioma: el texto de la ayuda vive dentro del botón.
  initSetSearchHelp();
  setText("lbl-riven-weapon", t.lblRivenW);
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
  setText("riven-disclaimer", t.rivenDisclaimer);
  setText("btn-add-pos", t.rivenAddPos);
  setText("btn-add-neg", t.rivenAddNeg);
  setText("lbl-grading-variants", t.rivenGradeVariants);
  setText("riven-web-orders-label", t.rivenWebOrders);

  setText("txt-mod-preview", t.lblModPreview);
  setText("txt-weapon-guide", t.lblWeaponGuide);
  setText("txt-variants-header", t.rivenIndex?.variantsLabel || "VARIANTS");


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
  updateOptions("squadSize", t.squads);
  updateOptions("prime-inv-sort", t.inventory?.primeSort);


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


function triggerSideEffects(t) {
  populateRivenSelects();

  const modeLfg = document.getElementById("mode-lfg");
  if (modeLfg && !modeLfg.classList.contains("hidden")) updateLFGUI();

  // Sin guarda: sin set activo el panel pinta la zona de soltar, y su texto también
  // tiene que seguir al idioma.
  renderSetTracker();
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
  // El ancla de la guía cambia con el idioma: guide.html lleva las dos versiones en la misma
  // página y esconde la que no toca.
  updateGuideLink(state.activeTab, state.currentLang);
  updateStaticTexts(t);
  updateInputsAndContent(t);
  updateSelectDropdowns(t);
  updateRivenSelects(t);
  updateScannerLabels(t);
  // El selector de motor: rótulos y cuál está activo. Va aquí y no en updateScannerLabels
  // porque ese módulo solo escribe texto y esto además lee la preferencia guardada.
  renderOcrEngine();
  if (typeof updateIndexTranslations === "function") {
    updateIndexTranslations();
    if (state.rivenIndexData) {
      filterRivenIndex();
    }
  }
  applyArbTexts();
  // initLFGPresets() solo construye el panel la primera vez, así que sin esto los presets se
  // quedan en el idioma de arranque.
  renderLFGPresets();
  renderTradePresets();
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
  if (!list) return;
  const abierto = !list.classList.toggle("hidden");
  // El disparador es un <button aria-expanded>: si no se actualiza, promete un estado falso.
  document.getElementById("langTrigger")?.setAttribute("aria-expanded", String(abierto));
}

export function setLanguageManual(langCode) {
  changeLanguage(langCode);
  updateLangButtonVisuals(langCode);
  document.getElementById("langOptionsList").classList.add("hidden");
  document.getElementById("langTrigger")?.setAttribute("aria-expanded", "false");
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
    // Sincronización inicial: hydrateDOM() ya ha puesto en el DOM lo que había guardado, pero
    // nada lo devolvía a `state`, y saveAppState() guarda desde `state`. Así, el primer
    // guardado tras recargar (cambiar de pestaña vale) reescribía el valor por defecto, y a la
    // SEGUNDA recarga el refinamiento volvía a "Radiante" y el nombre y el MR salían vacíos.
    // Va después de hydrateDOM(): ver el orden en main.js.
    if (el.value !== "") state[prop] = el.value;
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

  // Escape cierra el modal de encima. Pulsa su fondo en vez de llamar a cada close*(), así
  // cada modal conserva su propia lógica de cierre. Los del escáner dejan el fondo sin
  // handler a propósito (piden una decisión explícita), y por eso quedan fuera.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const fondos = [...document.querySelectorAll(".modal-backdrop[onclick]")]
      .filter((f) => f.getClientRects().length > 0);
    fondos.at(-1)?.click();
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