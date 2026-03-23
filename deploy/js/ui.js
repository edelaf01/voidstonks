import { calculateRivenGrade } from "./riven_logic.js";
import {
  TEXTS,
  TIER_URLS,
  RIVEN_STATS,
  DROP_CHANCES,
  WORKER_URL,
  RIVEN_BASE_STATS,
  WEAPON_TYPE_IDX,
  APP_VERSION,
  UPDATE_HISTORY_CONTENT,
} from "./config.js";
import {
  escapeHTML,
  showToast,
  showCustomConfirm,
} from "./ui.components/ui_components.js";
import { populateRivenSelects } from "./ui.components/ui_rivens.js";
import { state, saveAppState, updateInventoryCount } from "./state.js";

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

import {
  addToQueue,
  fetchRivenAverage,
  getSlug,
  getRivenSlug,
  fetchActiveBounties,
  getPriceValue,
} from "./api.js";

/**
 * Resolves an item name to its corresponding icon path.
 */
export function getItemIcon(itemName) {
  if (!itemName) return null;
  if (iconPathCache.has(itemName)) return iconPathCache.get(itemName);

  let originalName = itemName
    .toLowerCase()
    .trim()
    .replace(/^\d+x\s+/, "");

  const baseSlug = originalName
    .replace(" set", "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_");

  const pPrefix = originalName.includes("prime") ? "prime_" : "";
  const basePath = `assets/relic_contents/${pPrefix}`;

  // --- LÓGICA DE DETECCIÓN ---

  if (originalName.includes("systems")) {
    const archwings = ["amesha", "odonata", "elytron", "itzal"];
    const isArchwing = archwings.some((aw) => originalName.includes(aw));
    return `${basePath}systems${isArchwing ? "_archwing" : ""}.webp`;
  }

  if (
    originalName.includes("grip") ||
    /limb(?!o)/.test(originalName) ||
    originalName.includes("string")
  ) {
    return `${basePath}grip.webp`;
  }

  const partMappings = [
    ["neuroptics", ["neuroptics"]],
    ["cerebrum", ["cerebrum"]],
    ["carapace", ["carapace"]],
    ["harness", ["harness"]],
    ["wings", ["wings"]],
    ["barrel", ["barrel"]],
    ["receiver", ["receiver"]],
    ["stock", ["stock", "motor"]],
    ["link", ["link", "chain"]],
    ["hilt", ["hilt", "handle", "ornament", "blade", "tip"]],
    ["disc", ["disc"]],
    ["boot", ["boot"]],
    ["gauntlet", ["gauntlet"]],
    ["head", ["head"]],
    ["chassis", ["chassis"]],
  ];

  const match = partMappings.find(([_, keywords]) =>
    keywords.some((k) => originalName.includes(k)),
  );

  if (match) {
    return `${basePath}${match[0]}.webp`;
  }

  // --- FALLBACKS (Blueprints y Default) ---

  if (originalName.includes("blueprint") || originalName.endsWith(" bp")) {
    const setSlug = baseSlug.replace(/(_blueprint|_bp)$/, "");
    return `assets/relic_contents/${setSlug}.webp`;
  }

  const result = `assets/relic_contents/${baseSlug}.webp`;
  iconPathCache.set(itemName, result);
  return result;
}

export function getRequiredCount(setName, partName) {
  const manifest = state.primeManifest || [];
  const weapons = state.weaponDetailsDB || [];

  const item =
    manifest.find((i) => i.name === setName) ||
    weapons.find((i) => i.name === setName);
  if (!item || !item.components) return 1;

  let cleanPart =
    partName === setName ? "Blueprint" : partName.replace(setName, "").trim();
  if (cleanPart.endsWith(" Blueprint"))
    cleanPart = cleanPart.replace(" Blueprint", "").trim();

  const comp = item.components.find(
    (c) =>
      c.name === cleanPart ||
      c.name + " Blueprint" === cleanPart ||
      setName + " " + c.name === partName,
  );
  return comp ? comp.itemCount : 1;
}

export function generateDotsHtml(owned, required) {
  if (required <= 0) return "";
  // For required === 1, we usually don't show dots to avoid clutter,
  // but we want to know it's needed. However, the dots are best for multiple.
  if (required <= 1) return "";
  const isComplete = owned >= required;
  let html = `<div class="tracker-dots ${isComplete ? "complete" : ""}" style="display: flex; gap: 3px; margin-left: 8px;">`;
  for (let i = 0; i < required; i++) {
    const filled = i < owned ? "filled" : "";
    html += `<span class="tracker-dot ${filled}"></span>`;
  }
  html += `</div>`;
  return html;
}

let debounceTimer;

const t = TEXTS[state.currentLang];

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

export function changeLanguage(lang) {
  if (lang) state.currentLang = lang;
  if (!state.currentLang) state.currentLang = "es";

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

  const disclaimer = document.getElementById("txt-disclaimer");
  if (disclaimer) disclaimer.innerHTML = t.disclaimer;

  setText("lbl-relic-name", t.lblRelic);
  const relicInput = document.getElementById("relicInput");
  if (relicInput) relicInput.placeholder = t.phRelic;

  setText("lbl-missing", t.lblMiss);
  setText("lbl-profit", t.lblProfit);
  setText("lbl-content", t.lblContent);

  // Refinamiento (Selector)
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

  // Guía de añadir reliquia
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
  const invInput = document.getElementById("inv-search-input");
  if (invInput) invInput.placeholder = t.inventory.searchPlaceholder;

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
export function changeCount(n) {
  state.playerCount = Math.max(1, Math.min(4, state.playerCount + n));
  document.getElementById("countDisplay").innerText = state.playerCount;
  generateMessage();
}

export function generateMessage() {
  requestAnimationFrame(() => {
    const t = TEXTS[state.currentLang];
    const defaultText = t.defaultRelic;
    let rName = state.selectedRelic || defaultText;
    rName = rName.trim();

    const refSelect = document.getElementById("refinement");
    const refVal = refSelect.value;
    const refText = refSelect.options[refSelect.selectedIndex]?.text || refVal;

    let linkChat = "";
    if (state.selectedRelic) {
      if (state.currentLang === "en") linkChat = `[${rName} Relic]`;
      else linkChat = `[Reliquia ${rName}]`;
    } else {
      linkChat = `[${defaultText}]`;
    }

    let countText = `${state.playerCount}/4`;
    if (state.playerCount === 4) countText = "3/4";

    const fullMessage = `H ${linkChat} ${refText} ${countText}`;
    const msgBox = document.getElementById("finalMessage");

    if (msgBox) {
      if (msgBox.innerText !== fullMessage) {
        msgBox.innerText = fullMessage;

        msgBox.classList.remove("pulse-anim");

        setTimeout(() => {
          msgBox.classList.add("pulse-anim");
        }, 10);
      }
    }

    updateRelicTotal();
  });
}

export function copyText() {
  const textToCopy = document.getElementById("finalMessage").innerText;
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => showToast(TEXTS[state.currentLang].msgCopied))
    .catch((err) => console.error("Error al copiar: ", err));
}

// --- RELIC UI ---
export function handleRelicTyping() {
  const input = document.getElementById("relicInput");
  const val = input.value.toUpperCase().trim();
  const container = document.getElementById("relic-contents");

  saveAppState();

  const dropdown = document.getElementById("relicDropdown");

  if (val.length < 1) {
    dropdown.classList.add("hidden");
    if (container) container.classList.add("hidden");
    state.selectedRelic = "";
    return;
  }

  const matches = state.allRelicNames
    .filter((name) => name.toUpperCase().includes(val))
    .slice(0, 10);

  if (matches.length > 0) {
    dropdown.innerHTML = "";
    dropdown.classList.remove("hidden");
    matches.forEach((name) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerText = name;
      item.onclick = () => {
        input.value = name;
        dropdown.classList.add("hidden");
        // Asegurar que el contenedor sea visible inmediatamente
        const cont = document.getElementById("relic-contents");
        if (cont) cont.classList.remove("hidden");
        manualRelicUpdate();
      };
      dropdown.appendChild(item);
    });
  } else {
    dropdown.classList.add("hidden");
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(manualRelicUpdate, 600);
}

export function manualRelicUpdate() {
  try {
    const relicInput = document.getElementById("relicInput");
    if (!relicInput) return;

    let container = document.getElementById("relic-contents");
    let inputVal = relicInput.value.trim().toUpperCase();

    // Buscar la coincidencia real en la base de datos (insensible a mayúsculas)
    let realName =
      state.allRelicNames.find((n) => n.toUpperCase() === inputVal) ||
      relicInput.value;
    state.selectedRelic = realName;

    const tier = state.selectedRelic.split(" ")[0];
    if (typeof globalThis.updateRecommendedMissions === "function") {
      globalThis
        .updateRecommendedMissions(tier)
        .catch((err) => console.error(err));
    }

    if (typeof globalThis.generateMessage === "function")
      globalThis.generateMessage();

    const listDiv = document.getElementById("relic-drops-list");
    const profitDisplay = document.getElementById("relic-profit-display");
    const statusBadge = document.getElementById("relic-status-badge");

    if (!listDiv || !profitDisplay || !container) {
      console.warn("Faltan elementos UI para el update de reliquia");
      return;
    }

    // Use a Fragment to avoid multiple repaints
    const fragment = document.createDocumentFragment();
    profitDisplay.innerText = "...";
    profitDisplay.classList.add("loading");

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");
      // Aseguramos que el input tenga el nombre con el casing correcto
      if (
        relicInput.value.toUpperCase() === state.selectedRelic.toUpperCase()
      ) {
        relicInput.value = state.selectedRelic;
      }

      if (statusBadge) {
        const status = state.relicStatusDB[state.selectedRelic] || "vaulted";

        statusBadge.className = "badge";
        statusBadge.style.display = "inline-block";

        if (status === "active" || status === "aya") {
          statusBadge.classList.add(status === "aya" ? "aya" : "active");
          statusBadge.innerText =
            status === "aya" ? "AYA (RESURGENCE)" : "ACTIVE";

          const tooltipHTML = getRelicDropTooltip(state.selectedRelic);
          statusBadge.dataset.tooltipHtml = tooltipHTML;
          delete statusBadge.dataset.tooltip;
        } else {
          statusBadge.classList.add("vaulted");
          statusBadge.innerText = "VAULTED";

          delete statusBadge.dataset.tooltipHtml;
          statusBadge.dataset.tooltip =
            "Esta reliquia está en la Bóveda (No cae actualmente).";
        }
      }

      let addBtnContainer = document.getElementById("manual-add-container");
      if (!addBtnContainer) {
        addBtnContainer = document.createElement("div");
        addBtnContainer.id = "manual-add-container";
        addBtnContainer.style.marginBottom = "15px";
        addBtnContainer.style.textAlign = "right";
        listDiv.parentNode.insertBefore(addBtnContainer, listDiv);
      }

      const t = TEXTS[state.currentLang];
      addBtnContainer.innerHTML = `
        <button class="riven-btn" style="padding: 8px 15px; background: var(--wf-blue); color: #000; font-weight:bold;" data-action="add-current-to-inv">
            + ${escapeHTML(t.manualAdd || "Add to Inventory")}
        </button>
      `;

      const items = state.relicsDatabase[state.selectedRelic];
      items.sort((a, b) => b.chance - a.chance);

      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "component-row";

        const isUntradable =
          item.name.includes("Forma Blueprint") ||
          item.name.includes("Kuva") ||
          item.name === "Riven Sliver" ||
          item.name === "Exilus Weapon Adapter Blueprint";

        const abbr = TEXTS[state.currentLang].rarityAbbr;
        let rarityLabel = abbr.common;

        if (item.chance <= 5) {
          rarityLabel = abbr.rare;
          row.dataset.rarity = "rare";
        } else if (item.chance <= 11) {
          rarityLabel = abbr.uncommon;
          row.dataset.rarity = "uncommon";
        } else {
          row.dataset.rarity = "common";
        }

        if (isUntradable) {
          row.dataset.rarity = "forma";
        }

        const iconPath = getItemIcon(item.name);
        const iconHtml = iconPath
          ? `<img src="${iconPath}" class="item-icon-mini" loading="lazy" onerror="this.style.display='none'">`
          : "";

        let nameDisplay;
        if (isUntradable) {
          nameDisplay = `<span class="component-name forma">${escapeHTML(
            item.name.replaceAll("Blueprint", "BP"),
          )}</span>`;
        } else {
          nameDisplay = `
            <div class="name-row-content">
              <span class="component-name item-interactive" data-action="find-relics-for-item" data-item="${escapeHTML(
                item.name,
              )}" onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapeHTML(
                item.name,
              )}')">
                  ${escapeHTML(item.name)}
              </span>
              ${(() => {
                const setName = getSetName(item.name);
                if (setName && setName !== "Otros") {
                  const req = getRequiredCount(setName, item.name);
                  const owned = state.primeInventory[item.name] || 0;
                  return generateDotsHtml(owned, req);
                }
                return "";
              })()}
              <div class="actions-col-wrapper">
                <a href="https://warframe.market/items/${getSlug(
                  item.name,
                )}" target="_blank" class="market-btn-mini" title="Warframe Market">
                  MARKET
                </a>
                <button class="mini-action-btn" style="border-color:var(--wf-blue)" 
                        data-action="modify-prime-part" data-part="${escapeHTML(
                          item.name,
                        )}" data-amount="1">
                  +1
                </button>
              </div>
            </div>
          `;
        }

        const finalIconHtml = iconPath
          ? `<img src="${iconPath}" class="item-icon-mini item-interactive" loading="lazy" onerror="this.style.display='none'" onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapeHTML(
              item.name,
            )}')">`
          : "";

        const badgeContent = isUntradable
          ? '0<span class="plat-icon"></span>'
          : "...";
        const badgeClass = isUntradable
          ? "price-badge forma"
          : "price-badge loading";
        const ducatVal = item.ducats || 0;
        row.innerHTML = `
            <div class="component-info">
                <span class="rarity-indicator">${rarityLabel}</span>
                <div class="name-wrapper">
                    ${finalIconHtml}
                    <div class="name-column" style="display:flex; align-items:center;">
                       ${nameDisplay}
                    </div>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="ducat-val" style="color:var(--wf-gold-text); font-size:0.85em; font-weight:bold;">${ducatVal} <span style="font-size:0.8em; opacity:0.8">d</span></span>
              <div class="${badgeClass}" data-item="${item.name.replaceAll(
                /"/g,
                "&quot;",
              )}">
                  ${badgeContent}
              </div>
            </div>
        `;

        fragment.appendChild(row);

        const badge = row.querySelector(".price-badge");
        if (!isUntradable) {
          addToQueue(item.name, badge);
        }
      });
      listDiv.replaceChildren(fragment);
    } else {
      container.classList.add("hidden");
    }
  } catch (e) {
    console.error("Error en manualRelicUpdate:", e);
  }
}

export function updatePriceUI(element, price) {
  if (!element) return;
  element.classList.remove("loading");
  element.innerHTML = `${price}<img src="assets/relic_contents/platinum.webp" class="plat-icon">`;
  if (document.getElementById("relic-profit-display")) updateRelicTotal();
}

function updateRelicTotal() {
  if (!state.selectedRelic || !state.relicsDatabase[state.selectedRelic])
    return;

  const items = state.relicsDatabase[state.selectedRelic];
  const badges = document.querySelectorAll(
    "#relic-drops-list .price-badge:not(.big)",
  );
  const refinementInput = document.getElementById("refinement").value;
  const squadSize = state.playerCount || 1;

  const itemDataWithPrice = items.map((item) => {
    let rarityType = "common";
    if (item.chance < 5) rarityType = "rare";
    else if (item.chance < 20) rarityType = "uncommon";

    let price = 0;
    const badge = Array.from(badges).find(
      (b) => b.dataset.item === item.name.replaceAll('"', "&quot;"),
    );
    if (badge) {
      price = Number.parseInt(badge.innerText) || 0;
    }

    return { ...item, rarityType, price };
  });

  const totalEV = calculateSquadEV(
    itemDataWithPrice,
    refinementInput,
    squadSize,
  );

  const disp = document.getElementById("relic-profit-display");
  const label = document.getElementById("lbl-profit");
  const t = TEXTS[state.currentLang];

  if (squadSize > 1) {
    label.innerText = t.lblProfitSquad.replaceAll("{n}", squadSize);
    label.style.color = "var(--wf-blue)";
  } else {
    label.innerText = t.lblProfitSolo;
    label.style.color = "#bbb";
  }

  const ducatEV = calculateSquadEV(
    itemDataWithPrice.map((i) => ({ ...i, price: i.ducats })),
    refinementInput,
    squadSize,
  );

  disp.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:flex-end;">
      <span>~${totalEV.toFixed(1)}<img src="assets/relic_contents/platinum.webp" class="plat-icon"></span>
      <span style="font-size:0.7em; color:var(--wf-gold-text)">~${ducatEV.toFixed(1)} ducats</span>
    </div>
  `;

  const stillLoading = Array.from(badges).some((b) =>
    b.classList.contains("loading"),
  );
  if (!stillLoading) disp.classList.remove("loading");
}

function calculateSquadEV(items, refinement, squadSize) {
  const keyMap = {
    Rad: "Rad",
    rad: "Rad",
    Intact: "Intact",
    Exceptional: "Exceptional",
    Flawless: "Flawless",
  };

  const safeKey = keyMap[refinement] || refinement;

  const rates = DROP_CHANCES?.[safeKey] ||
    DROP_CHANCES?.Intact || {
      common: 0.76,
      uncommon: 0.22,
      rare: 0.02,
    };

  if (!items) return 0;

  const itemsWithProb = items.map((item) => {
    let prob = rates.common / 3;

    if (item.rarityType === "rare") prob = rates.rare / 1;
    else if (item.rarityType === "uncommon") prob = rates.uncommon / 2;

    return { price: item.price || 0, prob: prob };
  });

  itemsWithProb.sort((a, b) => a.price - b.price);

  let expectedValue = 0;
  let accumulatedProb = 0;

  for (let item of itemsWithProb) {
    const nextAccumulatedProb = accumulatedProb + item.prob;

    const chanceThisIsBest =
      Math.pow(nextAccumulatedProb, squadSize) -
      Math.pow(accumulatedProb, squadSize);

    expectedValue += item.price * chanceThisIsBest;
    accumulatedProb = nextAccumulatedProb;
  }

  return expectedValue;
}
export function handleSetTyping() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(searchSet, 1200);
}

function searchSet() {
  const query = document
    .getElementById("setItemInput")
    .value.toLowerCase()
    .trim();
  const container = document.getElementById("setResults");
  container.innerHTML = "";
  if (query.length < 2) return;

  const dbKeys = Object.keys(state.itemsDatabase);
  const matches = dbKeys.filter((k) => k.toLowerCase().includes(query)).sort();
  const groups = {};
  const singles = [];

  matches.forEach((key) => {
    let baseName = null;
    if (key.includes("Prime"))
      baseName = key.split("Prime")[0].trim() + " Prime";
    else if (key.includes("Vandal"))
      baseName = key.split("Vandal")[0].trim() + " Vandal";
    else if (key.includes("Wraith"))
      baseName = key.split("Wraith")[0].trim() + " Wraith";

    if (baseName) {
      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(key);
    } else singles.push(key);
  });

  if (Object.keys(groups).length === 0 && singles.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#666;margin-top:20px">${
      TEXTS[state.currentLang].notFound
    }</div>`;
    return;
  }

  Object.keys(groups)
    .sort()
    .forEach((setName) => {
      createSetCard(setName, groups[setName], container, false);
    });
  singles
    .slice(0, 10)
    .forEach((itemName) =>
      createSetCard(itemName, [itemName], container, true),
    );
}

function createSetCard(title, itemNames, parent, isSingle = false) {
  const setContainer = document.createElement("div");
  setContainer.className = "set-container";
  const header = document.createElement("div");
  header.className = "set-header";
  let titleHTML = isSingle
    ? `<span>${escapeHTML(title)}</span>`
    : `<a href="https://warframe.market/items/${getSlug(
        title + " Set",
      )}" target="_blank" class="market-link">${escapeHTML(title)} SET<span class="link-icon">↗</span></a>`;

  const setIcon = getItemIcon(title);
  const setIconHtml = setIcon
    ? `<img src="${setIcon}" class="item-icon-set-header" loading="lazy" onerror="this.style.display='none'">`
    : "";
  header.innerHTML = `${setIconHtml} ${titleHTML}`;

  if (!isSingle) {
    const setPrice = document.createElement("span");
    setPrice.className = "price-badge loading";
    setPrice.innerText = "...";
    header.appendChild(setPrice);
    addToQueue(title + " Set", setPrice);
  }
  setContainer.appendChild(header);

  itemNames.forEach((itemName) => {
    if (!isSingle && !itemName.includes(title)) return;
    const relicsInfo = state.itemsDatabase[itemName] || [];
    const itemWrapper = document.createElement("div");
    if (relicsInfo.length > 0) itemWrapper.style.paddingBottom = "10px";

    const row = document.createElement("div");
    row.className = "component-row";
    let dispName =
      !isSingle && itemName.startsWith(title)
        ? itemName.replaceAll(title, "").trim()
        : itemName;

    const priceSpan = document.createElement("span");
    priceSpan.className = "price-badge loading";
    priceSpan.innerText = "...";
    addToQueue(itemName, priceSpan);

    const partIcon = getItemIcon(itemName);
    const partIconHtml = partIcon
      ? `<img src="${partIcon}" class="item-icon-mini" loading="lazy" onerror="this.style.display='none'">`
      : "";

    const itemData = state.itemsDatabase[itemName];
    const ducatVal = itemData && itemData.length > 0 ? itemData[0].ducats : 0;

    const requiredCount = getRequiredCount(title, itemName);
    const countLabel =
      requiredCount > 1
        ? ` <span class="required-count">x${requiredCount}</span>`
        : "";

    row.innerHTML = `
  <div class="component-header">
    <div class="name-row-content">
      ${partIconHtml}
      <div class="name-column">
        <span class="component-name">${escapeHTML(dispName)}${countLabel}</span>
        ${(() => {
          const owned = state.primeInventory[itemName] || 0;
          return generateDotsHtml(owned, requiredCount);
        })()}
      </div>
      <div class="actions-col-wrapper">
        <a href="https://warframe.market/items/${getSlug(itemName)}" target="_blank" class="market-btn-mini" title="Warframe Market">
          MARKET
        </a>
        <button class="mini-action-btn" data-action="modify-prime-part" data-part="${escapeHTML(itemName)}" data-amount="1">
          +1
        </button>
      </div>
    </div>
  </div>
  <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
    <span class="ducat-val" style="color:var(--wf-gold-text); font-size:0.85em; font-weight:bold;">${ducatVal} <span style="font-size:0.8em; opacity:0.8">d</span></span>
    <div class="price-badge-wrapper" style="min-width:45px; display:flex; justify-content:flex-end;"></div>
  </div>`;
    const badgeWrapper = row.querySelector(".price-badge-wrapper");
    badgeWrapper.appendChild(priceSpan);

    if (relicsInfo.length === 0)
      row.insertAdjacentHTML(
        "beforeend",
        `<div style="color:#666;font-size:0.8em;font-style:italic;margin-left:10px;">Vaulted</div>`,
      );
    itemWrapper.appendChild(row);

    if (relicsInfo.length > 0) {
      const grid = document.createElement("div");
      grid.className = "relic-grid";
      grid.style.padding = "0 10px";

      relicsInfo.sort((a, b) => a.relic.localeCompare(b.relic));
      const abbr = TEXTS[state.currentLang].rarityAbbr;

      relicsInfo.forEach((info) => {
        const btn = document.createElement("div");
        let rc = "common",
          rl = abbr.common;

        if (info.chance <= 5) {
          rc = "rare";
          rl = abbr.rare;
        } else if (info.chance <= 22) {
          rc = "uncommon";
          rl = abbr.uncommon;
        }

        const tier = info.tier || info.relic.split(" ")[0];
        const stKey = state.relicStatusDB[info.relic] || "vaulted";
        const stTxt = TEXTS[state.currentLang][stKey];

        let tooltipAttr = "";
        if (stKey === "active" || stKey === "aya") {
          const rawHtml = getRelicDropTooltip(info.relic);
          const safeHtml = rawHtml.replaceAll(/"/g, "&quot;");
          tooltipAttr = `data-tooltip-html="${safeHtml}"`;
        } else {
          tooltipAttr = `data-tooltip="This relic is vaulted"`;
        }

        btn.className = `relic-chip ${rc}`;

        btn.innerHTML = `
            <div class="relic-chip-header">
                <span class="relic-name">${escapeHTML(info.relic)}</span>
                <span class="relic-era-icon ${tier.toLowerCase()}"></span>
            </div>
            <div class="chip-footer">
                <span class="rarity-text ${rc}">${escapeHTML(rl)}</span>
                <span class="status-badge ${stKey}" ${tooltipAttr}>${escapeHTML(
                  stTxt,
                )}</span>
            </div>`;

        btn.onclick = (e) => {
          e.stopPropagation();
          if (!isSingle) activateSetTracker(title, itemNames);
          state.selectedRelic = info.relic;
          document.getElementById("relicInput").value = info.relic;

          const refSelect = document.getElementById("refinement");
          if (rc === "rare" || rc === "uncommon") refSelect.value = "Rad";
          else refSelect.value = "Intact";

          switchTab("relic");
          manualRelicUpdate();
        };
        grid.appendChild(btn);
      });
      itemWrapper.appendChild(grid);
    }
    setContainer.appendChild(itemWrapper);
  });
  parent.appendChild(setContainer);
}

function activateSetTracker(setName, itemsInSet) {
  state.currentActiveSet = setName;
  state.activeSetParts = itemsInSet;
  state.completedParts = new Set();
  renderSetTracker();
}

function renderRelicsForPartInline(partName, container) {
  const relics = state.itemsDatabase[partName] || [];
  container.innerHTML = "";

  if (relics.length === 0) {
    container.innerHTML = `<div style="padding:10px; color:#666; font-style:italic; font-size:0.9em;">Vaulted / No disponible en reliquias</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "relic-grid";
  grid.style.padding = "10px";
  grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(100px, 1fr))";

  relics.sort((a, b) => a.relic.localeCompare(b.relic));
  const abbr = TEXTS[state.currentLang].rarityAbbr;

  relics.forEach((info) => {
    let rc = "common",
      rl = abbr.common;
    if (info.chance <= 5) {
      rc = "rare";
      rl = abbr.rare;
    } else if (info.chance <= 22) {
      rc = "uncommon";
      rl = abbr.uncommon;
    }

    const tier = info.tier || info.relic.split(" ")[0];
    const stKey = state.relicStatusDB[info.relic] || "vaulted";

    const btn = document.createElement("div");
    btn.className = `relic-chip ${rc}`;
    btn.style.fontSize = "0.85em";

    btn.innerHTML = `
      <div class="relic-chip-header">
        <span class="relic-name">${info.relic}</span>
        <span class="relic-era-icon ${tier.toLowerCase()}"></span>
      </div>
      <div class="chip-footer">
        <span class="rarity-text ${rc}">${rl}</span>
        <span class="status-badge ${stKey}" style="font-size:0.7em">${
          stKey === "active" ? "ACT" : "VLT"
        }</span>
      </div>
    `;

    btn.onclick = (e) => {
      e.stopPropagation();
      state.selectedRelic = info.relic;
      document.getElementById("relicInput").value = info.relic;

      const refSelect = document.getElementById("refinement");
      if (rc === "rare" || rc === "uncommon") refSelect.value = "Rad";
      else refSelect.value = "Intact";

      manualRelicUpdate();
      document
        .getElementById("mode-relic")
        .scrollIntoView({ behavior: "smooth" });
    };

    grid.appendChild(btn);
  });

  container.appendChild(grid);
}

export function renderSetTracker() {
  const container = document.getElementById("set-tracker");
  const list = document.getElementById("tracker-list");
  const title = document.getElementById("tracker-title");
  const t = TEXTS[state.currentLang];

  if (!state.currentActiveSet) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  list.innerHTML = "";

  const setSlug = getSlug(state.currentActiveSet + " Set");
  const setUrl = `https://warframe.market/items/${setSlug}`;

  title.innerHTML = `
    ${t.trackerTitle}: 
    <a href="${setUrl}" target="_blank" class="set-header-link">
      ${state.currentActiveSet} ↗
    </a>
  `;

  // Create a map from manifest for quick lookup if available
  const manifestItem =
    state.primeManifest && Array.isArray(state.primeManifest)
      ? state.primeManifest.find((i) => i.name === state.currentActiveSet)
      : null;

  state.activeSetParts.forEach((partName) => {
    const wrapper = document.createElement("div");
    // Determine quantity owned and required
    const ownedCount = state.primeInventory[partName] || 0;

    const requiredCount = getRequiredCount(state.currentActiveSet, partName);

    const isDone = ownedCount >= requiredCount;

    const row = document.createElement("div");
    row.className = `tracker-item ${isDone ? "done" : ""}`;

    const nameText =
      partName === state.currentActiveSet
        ? "Blueprint"
        : partName.replaceAll(state.currentActiveSet, "").trim();

    const partSlug = getSlug(partName);

    // Layout: Left (Name + Arrow + Dots) ------- Right (Controls)
    const leftDiv = document.createElement("div");
    leftDiv.style.flex = "1";
    leftDiv.style.display = "flex";
    leftDiv.style.alignItems = "center";
    leftDiv.innerHTML = `
      <span class="t-name">${escapeHTML(nameText)}</span>
      <a href="https://warframe.market/items/${partSlug}" target="_blank" class="market-link-icon" onclick="event.stopPropagation()">↗</a>
      ${generateDotsHtml(ownedCount, requiredCount)}
      <span style="color:var(--wf-gold-text); font-size:0.8em; margin-left:10px; font-weight:bold;">
        ${state.itemsDatabase[partName] ? state.itemsDatabase[partName][0].ducats : 0}d
      </span>
    `;

    const rightDiv = document.createElement("div");
    rightDiv.style.display = "flex";
    rightDiv.style.alignItems = "center";
    rightDiv.style.gap = "15px";

    const controlsDiv = document.createElement("div");
    controlsDiv.style.display = "flex";
    controlsDiv.style.gap = "4px";

    if (ownedCount > 0) {
      const btnMinus = document.createElement("button");
      btnMinus.className = "t-check";
      btnMinus.style.padding = "2px 8px";
      btnMinus.innerText = "-";
      btnMinus.onclick = (e) => {
        e.stopPropagation();
        globalThis.modifyPrimePart(partName, -1);
        if (state.primeInventory[partName] <= 0)
          state.completedParts.delete(partName);
        if (state.primeInventory[partName] < requiredCount)
          state.completedParts.delete(partName);
        renderSetTracker();
      };
      controlsDiv.appendChild(btnMinus);
    }

    const btnPlus = document.createElement("button");
    btnPlus.className = "t-check";
    btnPlus.innerText = "+";
    btnPlus.onclick = (e) => {
      e.stopPropagation();
      globalThis.modifyPrimePart(partName, 1);
      state.completedParts.add(partName);
      renderSetTracker();
      showToast(`${partName} +1`);
    };
    controlsDiv.appendChild(btnPlus);

    rightDiv.appendChild(controlsDiv);

    row.appendChild(leftDiv);
    row.appendChild(rightDiv);

    const drawer = document.createElement("div");
    drawer.className = "tracker-drawer hidden";

    row.onclick = () => {
      const isCurrentlyClosed = drawer.classList.contains("hidden");
      document
        .querySelectorAll(".tracker-drawer")
        .forEach((d) => d.classList.add("hidden"));

      if (isCurrentlyClosed) {
        drawer.classList.remove("hidden");
        if (drawer.innerHTML === "") {
          if (globalThis.renderRelicsForPartInline) {
            globalThis.renderRelicsForPartInline(partName, drawer);
          }
        }
      }
    };

    wrapper.appendChild(row);
    wrapper.appendChild(drawer);
    list.appendChild(wrapper);
  });
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

let rivenDebounceTimer;

export function changeLFGCount(n) {
  state.lfgCount = Math.max(1, Math.min(3, state.lfgCount + n));
  const display = document.getElementById("lfgCountDisplay");
  if (display) display.innerText = state.lfgCount;
  generateLFGMessage();
}

export function updateLFGUI() {
  initLFGPresets();
  const act = document.getElementById("lfgActivity").value;
  const container = document.getElementById("lfg-dynamic-options");
  const t = TEXTS[state.currentLang];
  const roles = t.lfgRoles || {};
  const tips = t.tooltips || {};

  container.innerHTML = "";

  const createInfo = (text) => {
    if (!text) return "";
    return `<div style="margin-bottom:10px; font-size:0.85em; color:#888; border-left:2px solid var(--active-theme-color, var(--wf-blue)); padding-left:8px;">${text}</div>`;
  };

  if (act === "eda") {
    container.innerHTML = `
            ${createInfo(tips.eda)}
            <label class="lfg-checkbox-wrapper" style="margin-bottom:10px;">
                <input type="checkbox" id="lfg-eda-elite" checked onchange="generateLFGMessage()"> 
                <span class="lfg-label">${roles.elite}</span>
            </label>`;
  } else if (act === "temporal") {
    container.innerHTML = `
            ${createInfo(tips.temporal)}
            <label class="lfg-checkbox-wrapper" style="margin-bottom:10px;">
                <input type="checkbox" id="lfg-temp-elite" onchange="generateLFGMessage()"> 
                <span class="lfg-label">${roles.elite}</span>
            </label>`;
  } else if (act === "netra") {
    container.innerHTML = createInfo(tips.netra);
  } else if (act === "eidolon") {
    container.innerHTML = `
            <div style="margin-bottom:10px;">
                <label style="font-size:0.8em; color:#888; margin-bottom:5px; display:block;">Pace / Ritmo <span data-tooltip="${
                  tips.rotation || "Rotation info"
                }">(?)</span></label>
                <select id="lfg-eidolon-runs" class="wf-input" onchange="generateLFGMessage()">
                    <option value="3x3">${roles.run3x3}</option>
                    <option value="5x3">${roles.run5x3}</option>
                    <option value="6x3">${roles.run6x3}</option>
                    <option value="casual">${roles.casual}</option>
                </select>
            </div>
            <div class="lfg-grid">
                ${createCheckbox("DPS", roles.dps, tips.dps)}
                ${createCheckbox("VS", "VS", tips.vs)}
                ${createCheckbox("Lures", roles.lure, tips.lure)}
                ${createCheckbox("Volt", roles.volt, tips.volt)}
                ${createCheckbox("Harrow", roles.harrow, tips.harrow)}
                ${createCheckbox("Wisp", roles.wisp, tips.wisp)}
            </div>`;
  } else if (act === "profit") {
    container.innerHTML = `
            ${createInfo(tips.profit)} 
            <div class="lfg-grid">
                ${createCheckbox("Chroma", "Chroma")}
                ${createCheckbox("Volt", "Volt")}
                ${createCheckbox("Saryn", "Saryn")}
                ${createCheckbox("Zenith", "Zenith")}
            </div>`;
  } else if (act === "arbi") {
    container.innerHTML = `
            ${createInfo(tips.arbi)}
            <select id="lfg-arbi-type" class="wf-input" onchange="generateLFGMessage()">
                <option value="Meta">${roles.meta}</option>
                <option value="Normal">${roles.casual}</option>
            </select>`;
  } else if (act === "archon") {
    container.innerHTML = createInfo(tips.archon);
  } else if (act === "sortie") {
    container.innerHTML = createInfo(tips.sortie);
  } else if (act === "radshare") {
    container.innerHTML = `
            <div style="padding:10px; background:#1a1c20; border:1px dashed #444; color:#aaa; font-size:0.9em;">
                <span data-tooltip="${tips.radshare || ""}">${
                  t.lfgOpts.radshareInfo
                }</span>
            </div>`;
  }
  generateLFGMessage();
}

function createCheckbox(val, label, tip = "") {
  const tooltip = tip ? `data-tooltip="${tip}"` : "";
  return `<label class="lfg-checkbox-wrapper"><input type="checkbox" class="lfg-role" value="${val}" onchange="generateLFGMessage()"> <span class="lfg-label" ${tooltip}>${label}</span></label>`;
}

let lfgRafId = null;

export function generateLFGMessage() {
  if (lfgRafId) cancelAnimationFrame(lfgRafId);

  lfgRafId = requestAnimationFrame(() => {
    lfgRafId = null;

    const actEl = document.getElementById("lfgActivity");
    const extraEl = document.getElementById("lfgExtra");

    if (!actEl) return;

    const act = actEl.value;
    const extra = extraEl ? extraEl.value.trim() : "";

    const t = TEXTS[state.currentLang];
    const opts = t.lfgOpts || {};

    let activityName = opts[act] || act.toUpperCase();
    let msg = `H ${activityName}`;

    const optionsContainer = document.getElementById("lfg-dynamic-options");
    const getRoles = () => {
      if (!optionsContainer) return [];
      return Array.from(
        optionsContainer.querySelectorAll(".lfg-role:checked"),
      ).map((c) => c.value);
    };

    if (act === "eidolon") {
      const runsEl = document.getElementById("lfg-eidolon-runs");
      const runs = runsEl ? runsEl.value : "3x3";

      msg = `H ${activityName} ${runs}`;
      const roles = getRoles();
      if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
    } else if (act === "netra") {
      msg = `H ${activityName}`;
    } else if (act === "temporal") {
      const eliteEl = document.getElementById("lfg-temp-elite");
      const prefix = eliteEl?.checked
        ? state.currentLang === "es"
          ? "Élite "
          : "Elite "
        : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "eda") {
      const eliteEl = document.getElementById("lfg-eda-elite");
      const prefix = eliteEl?.checked
        ? state.currentLang === "es"
          ? "Élite "
          : "Elite "
        : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "profit") {
      msg = `H ${activityName}`;
      const roles = getRoles();
      if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
    } else if (act === "arbi") {
      const arbiTypeEl = document.getElementById("lfg-arbi-type");
      if (arbiTypeEl) {
        msg = `H ${arbiTypeEl.value} ${activityName}`;
      }
    }

    if (extra) msg += ` ${extra}`;

    const count = state?.lfgCount ? state.lfgCount : 1;
    msg += ` ${count}/4`;

    const box = document.getElementById("finalMessage");
    if (box && box.innerText !== msg) {
      box.innerText = msg;
    }
  });
}
export function toggleLfgDropdown() {
  document.getElementById("lfgDropdown").classList.toggle("hidden");
}

export function selectLfgOption(value, text) {
  document.getElementById("lfgActivity").value = value;
  document.getElementById("lfgSelectedText").innerText = text;
  document.getElementById("lfgDropdown").classList.add("hidden");
  updateLFGUI();
  saveAppState();
}

export function renderProfileStats(mr, focus, standingObj, isCalc = false) {
  const container = document.getElementById("profile-data");
  const t = TEXTS[state.currentLang];
  const tracesCap = 100 + 50 * mr;
  let standingHtml = "";
  if (standingObj) {
    for (const [faction, amount] of Object.entries(standingObj)) {
      if (typeof amount === "number" && amount >= 0) {
        standingHtml += `<div class="standing-item"><div style="font-size:0.8em;color:#aaa">${faction}</div><div class="standing-val">${amount.toLocaleString()}</div></div>`;
      }
    }
  }
  container.innerHTML = `
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div class="profile-stat-box" style="flex:1"><div class="profile-stat-title">Mastery Rank</div><div class="profile-stat-val" style="color:#gold">${mr}</div></div>
            <div class="profile-stat-box" style="flex:1"><div class="profile-stat-title">${
              t.lblTraces
            }</div><div class="profile-stat-val">${tracesCap}</div></div>
        </div>
        <div class="profile-stat-box"><div class="profile-stat-title">${
          t.lblDailyFocus
        } ${
          isCalc ? "(Max)" : "(Remaining)"
        }</div><div class="profile-stat-val" style="color:var(--wf-riven)">${focus.toLocaleString()}</div></div>
        <div style="margin-top:15px; font-weight:bold; color:var(--wf-blue); text-align:center;">${
          t.lblStanding
        }</div>
        <div class="standing-grid">${standingHtml}</div>
    `;
}

export function calculateCaps() {
  const mr = parseInt(document.getElementById("mrInput").value) || 0;
  const focusCap = 250000 + 5000 * mr;
  const standingCap = 16000 + 500 * mr;
  const mockStanding = {
    Ostron: standingCap,
    Solaris: standingCap,
    Entrati: standingCap,
    Cavia: standingCap,
  };
  renderProfileStats(mr, focusCap, mockStanding, true);
  saveAppState();
}
let fissureLoadPromise = null;
export async function updateRecommendedMissions(tier) {
  const listArea = document.getElementById("fissures-list-area");

  if (!listArea || listArea.children.length === 0) {
    if (fissureLoadPromise) {
      //en curso
    } else {
      //fissureLoadPromise = initFissurePanel().then(() => {
      // fissureLoadPromise = null;
      //});
    }

    await fissureLoadPromise;
  }

  highlightFissureTier(tier);
}
function renderMissionRow(m) {
  const t = TEXTS[state.currentLang];

  const rawType = m.type.toLowerCase();

  const translatedType =
    t.modes[rawType] || m.type.charAt(0).toUpperCase() + m.type.slice(1);

  const omniaTag = m.isOmnia
    ? `<span class="omnia-tag big" data-tooltip="${t.tooltips.omnia}">OMNIA</span>`
    : "";

  const spTag = m.isSP
    ? `<span class="sp-icon" data-tooltip="${t.tooltips.steelPath}">SP</span>`
    : "";

  return `
        <div class="mission-item ${m.isSP ? "sp-row" : ""}">
            <div class="m-info">
                <span class="m-type">
                    ${translatedType} 
                    ${omniaTag}
                    ${spTag}
                </span>
                <span class="m-node">${m.node}</span>
            </div>
            <div class="m-timer-box">
                <span class="m-eta">${m.eta}</span>
            </div>
        </div>
    `;
}

export function initGlobalTooltipSystem() {
  let tooltipEl = document.getElementById("global-tooltip");
  let closeTimer = null;
  let currentMode = "simple";

  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "global-tooltip";
    tooltipEl.className = "global-tooltip hidden";
    document.body.appendChild(tooltipEl);
  }

  const moveSimpleTooltip = (e) => {
    const offset = 15;
    const tWidth = tooltipEl.offsetWidth;
    const tHeight = tooltipEl.offsetHeight;

    let left = e.clientX + offset;
    let top = e.clientY + offset;

    if (left + tWidth > globalThis.innerWidth)
      left = e.clientX - tWidth - offset;
    if (top + tHeight > globalThis.innerHeight)
      top = e.clientY - tHeight - offset;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const positionMegaTooltip = (target) => {
    const rect = target.getBoundingClientRect();
    const tWidth = tooltipEl.offsetWidth;
    const tHeight = tooltipEl.offsetHeight;
    const gap = 5;

    let left = rect.right + gap;
    let top = rect.top;

    if (left + tWidth > globalThis.innerWidth) left = rect.left - tWidth - gap;

    if (top + tHeight > globalThis.innerHeight) top = rect.bottom - tHeight;

    if (top < 10) top = 10;
    if (left < 10) left = 10;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const showTooltip = (e, target) => {
    if (closeTimer) clearTimeout(closeTimer);

    const htmlContent = target.dataset.tooltipHtml;
    const textContent = target.dataset.tooltip;

    if (htmlContent) {
      currentMode = "mega";
      tooltipEl.innerHTML = htmlContent;
      tooltipEl.classList.add("mega-mode");
    } else if (textContent) {
      currentMode = "simple";
      tooltipEl.innerText = textContent;
      tooltipEl.classList.remove("mega-mode");
    } else {
      return;
    }

    tooltipEl.classList.remove("hidden");

    if (currentMode === "mega") {
      positionMegaTooltip(target);
    } else {
      moveSimpleTooltip(e);
    }
  };

  const hideTooltip = () => {
    if (currentMode === "simple") {
      tooltipEl.classList.add("hidden");
    } else {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        tooltipEl.classList.add("hidden");
        tooltipEl.classList.remove("mega-mode");
      }, 300);
    }
  };

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip], [data-tooltip-html]");
    const isOverTooltip = e.target.closest("#global-tooltip");

    if (target || isOverTooltip) {
      if (closeTimer) clearTimeout(closeTimer);
      if (target) showTooltip(e, target);
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (currentMode === "simple" && !tooltipEl.classList.contains("hidden")) {
      moveSimpleTooltip(e);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const isTrigger = e.target.closest("[data-tooltip], [data-tooltip-html]");
    const isTooltip = e.target.closest("#global-tooltip");

    if (isTrigger || isTooltip) {
      const related = e.relatedTarget;
      if (
        related &&
        (related.closest("[data-tooltip], [data-tooltip-html]") ||
          related.closest("#global-tooltip"))
      ) {
        return;
      }
      hideTooltip();
    }
  });
}

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

export async function initFissurePanel() {
  const container = document.getElementById("relic-contents");
  let missionDiv = document.getElementById("best-missions-container");
  const t = TEXTS[state.currentLang];

  if (!missionDiv) {
    missionDiv = document.createElement("div");
    missionDiv.id = "best-missions-container";
    missionDiv.innerHTML = `
      <div id="mission-toggle-btn" class="mission-toggle-btn" onclick="document.getElementById('best-missions-container').classList.toggle('open')">
         <img src="assets/fissureicon.png" class="toggle-img" alt="Fisuras">
      </div>
      
      <div class="panel-main-header" id="fissure-panel-header">
          <svg class="gauss-icon" id="gauss-runner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5,5.5 C18.5,5.5 14,8 12,10 C10,12 5,11 2,12 C5,13 9,14 11,16 C13,18 16,19 18.5,19 C16,17 14,14 14,12 C14,10 16,7 18.5,5.5 Z M22,2 L20,4 C20,4 17,7 17,12 C17,17 20,20 20,20 L22,22" fill="currentColor"/>
         </svg>
         <span>${t.lblRecommended || "Fisuras Activas"}</span>
      </div>
      
      <div class="fissures-scroll-area" id="fissures-list-area">
         <div style="padding:10px; text-align:center; color:#666;">Cargando...</div>
      </div>
    `;
    document.body.appendChild(missionDiv);
  }

  const header = document.getElementById("fissure-panel-header");
  const runner = document.getElementById("gauss-runner");
  let runTimeout;
  if (header && runner) {
    header.onmouseenter = () => {
      runTimeout = setTimeout(() => {
        if (runner) {
          runner.classList.add("is-running");
          setTimeout(() => {
            if (runner) runner.classList.remove("is-running");
          }, 3000);
        }
      }, 2000);
    };
    header.onmouseleave = () => clearTimeout(runTimeout);
  }

  const { fetchBestFissures } = await import("./api.js");
  const allMissions = await fetchBestFissures();

  const tiersOrder = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
  const tiersData = {
    Lith: [],
    Meso: [],
    Neo: [],
    Axi: [],
    Requiem: [],
    Omnia: [],
  };

  allMissions.forEach((m) => {
    let tName = m.tier;
    if (tName === "Vanguard") tName = "Axi";
    if (tiersData[tName]) tiersData[tName].push(m);
  });

  const listArea = document.getElementById("fissures-list-area");
  listArea.innerHTML = "";

  const efficientTypes = [
    "Capture",
    "Extermination",
    "Rescue",
    "Sabotage",
    "Void Cascade",
  ];

  tiersOrder.forEach((tierName) => {
    const allTierMissions = tiersData[tierName];

    const efficientMissions = allTierMissions.filter(
      (m) => efficientTypes.includes(m.type) || m.tier === "Omnia",
    );

    const groupDiv = document.createElement("div");
    groupDiv.className = "fissure-group collapsed";
    groupDiv.id = `group-${tierName.toLowerCase()}`;
    groupDiv.dataset.tier = tierName.toLowerCase();

    const headerBtn = document.createElement("button");
    headerBtn.className = "tier-header-btn";
    headerBtn.innerHTML = `<span>${tierName} (${efficientMissions.length})</span> <span class="arrow-icon">▼</span>`;
    headerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTierGroup(groupDiv);
    });

    const contentDiv = document.createElement("div");
    contentDiv.className = "tier-content";

    if (efficientMissions.length === 0) {
      const noDataMsg =
        state.currentLang === "es"
          ? "No se han detectado fisuras eficientes"
          : "No efficient fissures detected";

      contentDiv.innerHTML = `
            <div class="no-fissures-msg">
                <span class="warning-icon">⚠</span> ${noDataMsg}
            </div>
        `;
    } else {
      let html = "";
      const normal = efficientMissions.filter((m) => !m.isSP);
      const sp = efficientMissions.filter((m) => m.isSP);

      if (normal.length > 0) {
        html += `<div style="padding:4px 8px; font-size:0.75em; color:#666; font-weight:bold;">NORMAL</div>`;
        normal.forEach((m) => (html += renderMissionRow(m)));
      }
      if (sp.length > 0) {
        html += `<div style="padding:4px 8px; font-size:0.75em; color:#a55; font-weight:bold; margin-top:5px;">STEEL PATH</div>`;
        sp.forEach((m) => (html += renderMissionRow(m)));
      }
      contentDiv.innerHTML = html;
    }

    groupDiv.appendChild(headerBtn);
    groupDiv.appendChild(contentDiv);
    listArea.appendChild(groupDiv);
  });

  if (state.selectedRelic) {
    const tier = state.selectedRelic.split(" ")[0];
    highlightFissureTier(tier);
  }
}
export function toggleTierGroup(element) {
  if (element) {
    element.classList.toggle("collapsed");
    if (element.classList.contains("collapsed")) {
      element.classList.remove("active");
    }
  }
}

export function highlightFissureTier(tier) {
  if (!tier) return;
  const tierKey = tier.toLowerCase();

  const normalizedTier = tierKey === "vanguard" ? "axi" : tierKey;

  const panel = document.getElementById("best-missions-container");
  /*if (panel && !panel.classList.contains("open")) {
    panel.classList.add("open");
  }*/ //TODO

  document.querySelectorAll(".fissure-group").forEach((group) => {
    const groupTier = group.dataset.tier;

    if (groupTier === normalizedTier || groupTier === "omnia") {
      group.classList.remove("collapsed");
      group.classList.add("active");

      if (groupTier === normalizedTier) {
        setTimeout(() => {
          group.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    } else {
      group.classList.remove("active");
      group.classList.add("collapsed");
    }
  });
}
let syncInterval = null;
let timeoutTimer = null;
export function initSyncPanel() {
  if (document.getElementById("cloud-sync-container")) return;

  const t = TEXTS[state.currentLang];

  const syncDiv = document.createElement("div");
  syncDiv.id = "cloud-sync-container";
  syncDiv.className = "side-panel-container";

  syncDiv.innerHTML = `
    <div id="sync-toggle-btn" class="side-toggle-btn" onclick="toggleSyncPanel()">
       <span style="font-size:1.5em;">☁️</span>
    </div>
    
    <div class="panel-main-header">
       <span>${t.sync.title}</span>
       <span class="info-icon" data-tooltip="${t.sync.helpTooltip}">ℹ️</span>
    </div>
    
    <div class="sync-content-area">
       
       <div class="sync-tabs">
          <button id="tab-sync-receive" class="sync-tab active" onclick="switchSyncTab('receive')">${t.sync.btnReceive}</button>
          <button id="tab-sync-send" class="sync-tab" onclick="switchSyncTab('send')">${t.sync.btnSend}</button>
       </div>

       <div id="panel-receive" class="sync-pane">
          <p class="sync-instruction">${t.sync.lblCode}</p>
          <div id="sync-code-display" class="big-code">----</div>
          <div id="sync-status-msg" class="sync-status">${t.sync.waiting}</div>
          <div class="loader-bar hidden" id="receive-loader"></div>
       </div>

       <div id="panel-send" class="sync-pane hidden">
          <p class="sync-instruction">${t.sync.lblInput}</p>
          <input type="number" id="sync-input-code" class="wf-input big-input" placeholder="${t.sync.placeholder}">
          <button id="btn-do-sync" class="riven-btn" onclick="executeSyncSend()">${t.sync.btnActionSend}</button>
       </div>

       <div class="sync-limits-footer">
          ${t.sync.limits}
       </div>
    </div>
  `;

  document.body.appendChild(syncDiv);
}

globalThis.toggleSyncPanel = function () {
  const panel = document.getElementById("cloud-sync-container");
  panel.classList.toggle("open");

  if (panel.classList.contains("open")) {
    if (
      document.getElementById("panel-receive").classList.contains("active") ||
      !document.getElementById("panel-send").classList.contains("active")
    ) {
      switchSyncTab("receive");
    }
  } else {
    stopReceiver();
  }
};

globalThis.switchSyncTab = function (mode) {
  document
    .querySelectorAll(".sync-tab")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(`tab-sync-${mode}`).classList.add("active");

  document
    .querySelectorAll(".sync-pane")
    .forEach((p) => p.classList.add("hidden"));
  document.getElementById(`panel-${mode}`).classList.remove("hidden");

  if (mode === "receive") {
    startReceiver();
  } else {
    stopReceiver();
  }
};

function stopReceiver() {
  if (syncInterval) clearInterval(syncInterval);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  syncInterval = null;
  timeoutTimer = null;

  const loader = document.getElementById("receive-loader");
  if (loader) loader.classList.add("hidden");
}

function startReceiver() {
  stopReceiver();

  const codeDisplay = document.getElementById("sync-code-display");
  const statusMsg = document.getElementById("sync-status-msg");
  const loader = document.getElementById("receive-loader");
  const container = document.getElementById("panel-receive");

  if (!codeDisplay) return;

  if (document.getElementById("btn-retry-sync")) {
    document.getElementById("btn-retry-sync").remove();
  }
  statusMsg.classList.remove("hidden");

  const code = Math.floor(1000 + Math.random() * 9000);
  codeDisplay.innerText = code;
  statusMsg.innerText = TEXTS[state.currentLang].sync.waiting;
  statusMsg.style.color = "#888";
  loader.classList.remove("hidden");

  syncInterval = setInterval(async () => {
    try {
      const res = await fetch(`${WORKER_URL}?type=sync_get&id=${code}`);
      const data = await res.json();
      if (res.status === 429) {
        stopReceiver();
        statusMsg.innerHTML = `<span style="color:#ff4444"> Too many tries , wait for a minute..</span>`;
        return;
      }
      if (!res.ok) {
        stopReceiver();
        statusMsg.innerHTML = `<span style="color:#ff4444"> Server error. Try again later.</span>`;
        return;
      }
      if (data && data.val) {
        stopReceiver();
        const box = document.getElementById("finalMessage");
        if (box) {
          box.innerText = data.val;
          box.style.animation = "none";
          box.offsetHeight;
          box.style.animation = "pulse 0.5s ease";
        }
        statusMsg.innerText = TEXTS[state.currentLang].sync.success;
        statusMsg.style.color = "var(--wf-lfg)";

        setTimeout(() => {
          const panel = document.getElementById("cloud-sync-container");
          if (panel) panel.classList.remove("open");
        }, 2000);
      }
    } catch (e) {
      console.error("Sync Poll Error", e);
    }
  }, 3000);

  timeoutTimer = setTimeout(() => {
    stopReceiver();

    statusMsg.innerText = "Tiempo de espera agotado (Ahorro de energía)";
    statusMsg.style.color = "#e6c200";
    loader.classList.add("hidden");

    const btnRetry = document.createElement("button");
    btnRetry.id = "btn-retry-sync";
    btnRetry.className = "tier-header-btn";
    btnRetry.style.marginTop = "10px";
    btnRetry.style.justifyContent = "center";
    btnRetry.innerText = "↻ Reactivar Conexión";
    btnRetry.onclick = () => startReceiver();

    if (!document.getElementById("btn-retry-sync")) {
      container.appendChild(btnRetry);
    }
  }, 120000);
}
globalThis.executeSyncSend = async function () {
  const t = TEXTS[state.currentLang].sync;
  const code = document.getElementById("sync-input-code").value;
  const msg = document.getElementById("finalMessage")?.innerText;
  const btn = document.getElementById("btn-do-sync");

  if (code?.length !== 4) return showToast("Código inválido (4 dígitos)");
  if (!msg || msg === "...") return showToast("No hay mensaje para enviar");

  const originalText = btn.innerText;
  btn.innerText = t.sending;
  btn.disabled = true;

  try {
    const res = await fetch(
      `${WORKER_URL}?type=sync_set&id=${code}&val=${encodeURIComponent(msg)}`,
    );
    if (res.status === 429) {
      throw new Error("Límite alcanzado. Espera 1 minuto.");
    }
    if (!res.ok) throw new Error("Server Error");

    btn.innerText = t.sent;
    btn.style.background = "var(--wf-lfg)";
    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.background = "";
      btn.disabled = false;
      document.getElementById("cloud-sync-container").classList.remove("open");
    }, 1500);
  } catch (e) {
    btn.innerText = e.message.includes("Límite") ? "Límite (1min)" : t.error;
    btn.style.background = "#331111";
    btn.style.color = "#ff5555";

    setTimeout(() => {
      btn.innerText = originalText;
      btn.style.background = "";
      btn.style.color = "";
      btn.disabled = false;
    }, 3000);
  }
};

export function initLFGPresets() {
  const lfgContainer = document.getElementById("mode-lfg");
  if (!lfgContainer || document.getElementById("lfg-presets-area")) return;

  const presetArea = document.createElement("div");
  presetArea.id = "lfg-presets-area";
  presetArea.className = "lfg-presets-container";

  const activityGroup = lfgContainer.querySelector(".form-group");
  activityGroup.after(presetArea);

  renderLFGPresets();
}

export function renderLFGPresets() {
  const container = document.getElementById("lfg-presets-area");
  if (!container) return;

  const t = TEXTS[state.currentLang].lfgPresets;

  let html = `<div class="presets-header">
                  <span style="font-size:0.85em; font-weight:bold; color:#888;">${escapeHTML(
                    t.title,
                  )}</span>
                  <button class="mini-action-btn" data-action="save-lfg-preset">+ ${escapeHTML(
                    t.btnSave,
                  )}</button>
                </div>`;

  if (!state.lfgPresets || state.lfgPresets.length === 0) {
    html += `<div style="font-size:0.8em; color:#555; font-style:italic; padding:5px;">${escapeHTML(
      t.empty,
    )}</div>`;
  } else {
    html += `<div class="presets-list">`;
    state.lfgPresets.forEach((p, index) => {
      html += `
                <div class="preset-chip" data-action="load-lfg-preset" data-index="${index}">
                    <span class="p-name">${escapeHTML(p.name)}</span>
                    <span class="p-act">${escapeHTML(
                      p.activity.toUpperCase(),
                    )}</span>
                    <button class="p-del" data-action="delete-lfg-preset" data-index="${index}">×</button>
                </div>
            `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

globalThis.saveLFGPreset = function () {
  const t = TEXTS[state.currentLang].lfgPresets;
  const name = prompt(t.placeholder);
  if (!name) return;

  const activity = document.getElementById("lfgActivity").value;
  const extra = document.getElementById("lfgExtra").value;
  const count = state.lfgCount;

  const roles = Array.from(document.querySelectorAll(".lfg-role:checked")).map(
    (c) => c.value,
  );

  const specificData = {};
  const runsEl = document.getElementById("lfg-eidolon-runs");
  if (runsEl) specificData.runs = runsEl.value;

  const arbiEl = document.getElementById("lfg-arbi-type");
  if (arbiEl) specificData.arbiType = arbiEl.value;

  const eliteEda = document.getElementById("lfg-eda-elite");
  if (eliteEda) specificData.elite = eliteEda.checked;

  const eliteTemp = document.getElementById("lfg-temp-elite");
  if (eliteTemp) specificData.eliteTemp = eliteTemp.checked;

  const newPreset = { name, activity, extra, count, roles, specificData };

  state.lfgPresets.push(newPreset);
  saveAppState();
  renderLFGPresets();
};

globalThis.loadLFGPreset = function (index) {
  const p = state.lfgPresets[index];
  if (!p) return;

  document.getElementById("lfgActivity").value = p.activity;

  const t = TEXTS[state.currentLang];
  const actName = t.lfgOpts[p.activity] || p.activity;
  document.getElementById("lfgSelectedText").innerText = actName;

  updateLFGUI();

  document.getElementById("lfgExtra").value = p.extra || "";

  state.lfgCount = p.count || 1;
  document.getElementById("lfgCountDisplay").innerText = state.lfgCount;

  if (p.roles && p.roles.length > 0) {
    p.roles.forEach((rVal) => {
      const chk = document.querySelector(`.lfg-role[value="${rVal}"]`);
      if (chk) chk.checked = true;
    });
  }

  if (p.specificData) {
    if (p.specificData.runs) {
      const el = document.getElementById("lfg-eidolon-runs");
      if (el) el.value = p.specificData.runs;
    }
    if (p.specificData.arbiType) {
      const el = document.getElementById("lfg-arbi-type");
      if (el) el.value = p.specificData.arbiType;
    }
    if (p.specificData.elite !== undefined) {
      const el = document.getElementById("lfg-eda-elite");
      if (el) el.checked = p.specificData.elite;
    }
    if (p.specificData.eliteTemp !== undefined) {
      const el = document.getElementById("lfg-temp-elite");
      if (el) el.checked = p.specificData.eliteTemp;
    }
  }

  generateLFGMessage();
  showToast(`Preset "${p.name}" cargado`);
};

globalThis.deleteLFGPreset = function (index) {
  if (confirm(TEXTS[state.currentLang].lfgPresets.deleteConfirm)) {
    state.lfgPresets.splice(index, 1);
    saveAppState();
    renderLFGPresets();
  }
};

let inventoryPriceUpdateInterval = null;

function resetLoadingStyle(element) {
  if (!element) return;
  element.style.opacity = "1";
  element.style.pointerEvents = "auto";
}

export function initDisclaimerSystem() {
  setTimeout(() => {
    const disclaimer = document.getElementById("txt-disclaimer");
    if (disclaimer) {
      disclaimer.classList.add("fade-out");
      setTimeout(() => {
        disclaimer.style.display = "none";
      }, 2000);
    }
  }, 8000);
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

export function getRelicDropTooltip(tierName) {
  const sources = state.relicSourcesDatabase[tierName];

  if (!sources || sources.length === 0) {
    return "No hay datos de drop confirmados.";
  }

  sources.sort((a, b) => b.chance - a.chance);

  let html = `<div class='tooltip-header'>Drops for ${escapeHTML(
    tierName,
  )} (${sources.length})</div>`;

  html += "<ul class='tooltip-list'>";

  sources.forEach((s, index) => {
    let locText = "";

    if (s.type === "mission") {
      locText = `<span class="t-loc">${escapeHTML(
        s.location,
      )}</span> <span style="color:#888">-</span> ${escapeHTML(
        s.mission,
      )} <span class='rot-badge'>${escapeHTML(s.rotation)}</span>`;
    } else {
      let stage = s.rotation
        .replaceAll("Rotation ", "")
        .replaceAll("Stage ", "St.");
      locText = `<span class="t-loc">${escapeHTML(
        s.location,
      )}</span> <span style="color:#888">-</span> ${escapeHTML(
        s.mission,
      )} <span class='rot-badge'>${escapeHTML(stage)}</span>`;
    }

    const isTop = index < 5;
    const rowClass = isTop ? "top-drop" : "";

    let chanceColor = "#888";
    if (s.chance > 10) chanceColor = "var(--wf-gold-text)";
    else if (s.chance > 5) chanceColor = "var(--wf-blue)";

    const sanitizedLocText = locText; // locText already sanitized above in previous partial replace

    html += `<li class="${rowClass}">
      <div class="t-row">${sanitizedLocText}</div>
      <span class='drop-chance' style="color:${chanceColor}">${s.chance.toFixed(
        2,
      )}%</span>
    </li>`;
  });

  html += "</ul>";
  return html;
}

let gradeDebounceTimer;

export async function checkUpdates() {
  const lastSeenVersion = localStorage.getItem("last_seen_version");
  const currentVersionStr = String(APP_VERSION);

  if (lastSeenVersion !== currentVersionStr) {
    const container = document.getElementById("update-history-content");
    if (container) {
      container.innerHTML = UPDATE_HISTORY_CONTENT;
      document.getElementById("update-modal").classList.remove("hidden");
    }
  }
}
export function closeUpdateModal() {
  document.getElementById("update-modal").classList.add("hidden");
  localStorage.setItem("last_seen_version", String(APP_VERSION));
  console.log("Versión guardada con éxito:", APP_VERSION);
}

let bountyInterval = null;
export async function renderBountiesTab() {
  const container = document.getElementById("bounties-list-container");
  if (!container) return;

  if (bountyInterval) clearInterval(bountyInterval);

  const t = TEXTS[state.currentLang];

  const toggleText = state.showAllFarms
    ? state.currentLang === "es"
      ? "MOSTRANDO TODO"
      : "SHOWING ALL"
    : state.currentLang === "es"
      ? "SOLO ÓPTIMAS"
      : "OPTIMAL ONLY";

  const headerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding:0 5px;">
          <div class="panel-main-header" style="margin:0; border-radius:4px; flex-grow:1; margin-right:10px;">
            <span id="lbl-fast-farms-title">${t.lblFastFarms || "Active Farms"}</span>
            <span class="info-icon" id="bounties-guide-icon" data-tooltip="${t.fastFarmGuide}">ℹ️</span>
          </div>
          
          <button 
            class="dashed-btn ${state.showAllFarms ? "active-filter" : ""}" 
            style="
              font-weight:800; 
              font-size:0.75em; 
              height:46px; 
              border:1px solid #444; 
              color:${state.showAllFarms ? "#fff" : "#888"}; 
              background:${state.showAllFarms ? "var(--wf-blue)" : "transparent"};
              cursor: pointer;
            "
            onclick="globalThis.toggleFarmsFilter()"
          >
            ${toggleText}
          </button>
      </div>
  `;

  container.innerHTML = `
      ${headerHTML}
      <div style="display:flex; flex-direction:column; align-items:center; padding:40px; color:#888;">
         <div class="spinner"></div>
         <div style="margin-top:10px">...</div>
      </div>`;

  const allBounties = await fetchActiveBounties();

  let visibleBounties = state.showAllFarms
    ? allBounties
    : allBounties.filter((b) => b.isOptimal);

  if (!visibleBounties || visibleBounties.length === 0) {
    container.innerHTML = `
          ${headerHTML}
          <div class="no-fissures-msg">
            <span class="warning-icon">⚠</span> 
            <div>
              <strong>${t.msgNoBountiesTitle || "No optimal missions active."}</strong><br>
              <small>${state.showAllFarms ? "No data found." : t.msgNoBountiesDesc || "Try switching to 'SHOW ALL'."}</small>
            </div>
          </div>`;
    return;
  }

  const factionConfig = {
    "The Holdfasts": { name: "Zariman (Ten Zero)", color: "#d4af37" },
    Cavia: { name: "Sanctum Anatomica (Cavia)", color: "#a545e0" },
    "The Hex": { name: "Höllvania (1999)", color: "#42f56c" },
    Ostrons: { name: "Cetus (Aya Farm)", color: "#d6b07c" },
    "Solaris United": { name: "Fortuna (Solaris)", color: "#00e5ff" },
    Entrati: { name: "Necralisk (Entrati)", color: "#ffaa00" },
  };

  const groups = {};
  visibleBounties.forEach((b) => {
    if (!groups[b.factionKey]) groups[b.factionKey] = [];
    groups[b.factionKey].push(b);
  });

  const expiryTimes = [];
  let html = headerHTML;

  for (const [key, missions] of Object.entries(groups)) {
    const config = factionConfig[key] || { name: key, color: "#fff" };
    missions.sort((a, b) => {
      if (b.standing !== a.standing) return b.standing - a.standing;
      if (typeof b.tier === "number" && typeof a.tier === "number")
        return b.tier - a.tier;
      return 0;
    });

    const expiryId = `timer-${key.replaceAll(/\s+/g, "")}`;
    if (missions[0]?.expiry) {
      expiryTimes.push({ id: expiryId, date: new Date(missions[0].expiry) });
    }

    html += `
        <div style="margin-bottom: 20px;">
            <div class="faction-header" style="border-left-color: ${config.color};">
                <span class="faction-name" style="color: ${config.color};">${config.name}</span>
                <span id="${expiryId}" style="font-size:0.9em; color:#fff; font-family:monospace; background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px;">
                    --:--:--
                </span>
            </div>`;

    if (key === "Ostrons") {
      html += `
        <div style="border: 1px solid var(--wf-gold-text); background: rgba(197, 168, 86, 0.1); padding: 12px; margin-bottom: 15px; border-radius: 6px; color: #ddd; font-size: 0.85rem; line-height: 1.4;">
          <strong style="color: var(--wf-gold-text);">ℹ AYA STRATEGY (TEAM):</strong> 
          Start T5 Bounty (Lvl 40-60, NON-SP). Enter Plains, FAIL mission immediately. 
          Check Tent console for Capture/Rescue. Accept there.
        </div>
      `;
    }

    missions.forEach((m, index) => {
      const uniqueId = `drops-${key}-${index}`.replaceAll(/\s+/g, "");
      const opacity = m.isOptimal ? "1" : "0.7";
      let tierColor = "#888";
      let tierLabel = m.tier;

      if (m.tier === "NARMER") {
        tierColor = "#ffaa00";
      } else if (m.tier === 6) {
        tierColor = "#ff4d4d";
      } else if (m.tier === 5) {
        tierColor = "#ffcc00";
      } else if (m.tier >= 3) {
        tierColor = "#00ccff";
      }

      let levelDisplay = "";
      if (m.isDual) {
        levelDisplay = `
          <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82em; margin-top: 4px; flex-wrap: wrap;">
            <span style="color: #aaa;">Lvl ${m.level} <b style="color:#888">(+${m.standing})</b></span>
            <span style="color: #444;">|</span>
            <span style="color: #ff4d4d;">SP ${m.levelSP} <b style="color:#ff4d4d99">(+${m.standingSP})</b></span>
          </div>`;
      } else {
        const tag = m.isSP ? "STEEL PATH" : "NORMAL PATH";
        const color = m.isSP ? "#ff4d4d" : "#aaa";
        levelDisplay = `
          <div style="color: ${color}; font-weight: bold; font-size: 0.85em; margin-top: 4px;">
            ${tag} (Lvl ${m.level}) <span style="color: #888; font-weight: normal;">(+${m.standing})</span>
          </div>`;
      }

      let rewardsContent = m.detailedRewards
        ? m.detailedRewards
            .map((stage) => {
              const rows = stage.drops
                .map(
                  (d) =>
                    `<div class="drop-row"><span class="drop-name ${d.name.includes("Aya") ? "aya" : ""}">${d.name}</span><span class="drop-chance">${d.chance.toFixed(2)}%</span></div>`,
                )
                .join("");
              return `<div class="stage-container"><div class="stage-header">STAGE ${stage.stage}</div><div class="stage-content">${rows}</div></div>`;
            })
            .join("")
        : `<ul class="drop-list">${m.rewards.map((r) => `<li class="drop-item">${r}</li>`).join("")}</ul>`;

      html += `
        <div class="bounty-wrapper ${m.isSP || m.isDual ? "is-sp" : ""} ${m.isOptimal ? "optimal-farm" : ""}" style="opacity:${opacity};">
            <div class="bounty-header-row">
                <div class="bounty-info">
                   <div class="bounty-type" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <span style="color:var(--wf-blue); font-weight:900; font-size:0.75em; text-transform:uppercase; border-right:1px solid #444; padding-right:8px;">
                        ${m.technicalType}
                      </span>
                      ${
                        !m.hideTier
                          ? `
                      <span style="color: ${tierColor}; border: 1px solid ${tierColor}44; padding: 1px 6px; font-size: 0.7em; border-radius: 3px; font-weight: 900; background: ${m.tier === 6 || m.tier === "NARMER" ? "rgba(255,170,0,0.1)" : "transparent"}">
                        ${tierLabel === "NARMER" ? "" : "TIER "}${tierLabel}
                      </span>`
                          : ""
                      }
                      <span style="color: #fff; font-weight: 600; flex: 1;">${m.type}</span>
                    </div>
                    ${levelDisplay}
                    ${m.condition ? `<div style="background: rgba(255,255,255,0.05); border-left: 3px solid #666; padding: 6px 12px; margin-top: 10px; font-size: 0.85em; color: #ccc; white-space: normal;">CHALLENGE: ${m.condition}</div>` : ""}
                </div>
                <button class="bounty-rewards-btn" style="color: ${config.color};" onclick="document.getElementById('${uniqueId}').classList.toggle('open')">
                    VIEW REWARDS
                </button>
            </div>
            <div id="${uniqueId}" class="bounty-drops-drawer">${rewardsContent}</div>
        </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;

  const updateTimers = () => {
    const now = new Date();
    expiryTimes.forEach((item) => {
      const el = document.getElementById(item.id);
      if (!el) return;
      const diff = item.date - now;
      if (diff <= 0) {
        el.innerText = "ROTATING...";
        el.style.color = "#f44";
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      el.innerText = `${t.lblEndsIn || "Ends:"} ${h}h ${m}m ${s}s`;
    });
  };

  updateTimers();
  bountyInterval = setInterval(updateTimers, 1000);
}

export function getSetName(fullName) {
  if (!fullName) return "Otros";
  const match = fullName.match(/(.*?) (Prime|Vandal|Wraith)/);
  return match ? match[0].trim() : "Otros";
}

globalThis.openSetFromRelicReward = (partName) => {
  const setName = getSetName(partName);
  if (setName === "Otros") return;

  // Switch to Set tab and search
  switchTab("set");
  const input = document.getElementById("setItemInput");
  if (input) {
    input.value = setName;
    searchSet();
  }

  const allParts = Object.keys(state.itemsDatabase).filter(
    (name) =>
      (name === setName || name.startsWith(setName + " ")) &&
      !name.endsWith(" Set"),
  );

  if (allParts.length > 0) {
    activateSetTracker(setName, allParts);
    showToast(`Tracking ${setName} Set`);
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
  toggleFarmsFilter: () => {
    state.showAllFarms = !state.showAllFarms;
    saveAppState();
    renderBountiesTab();
  },
  handleInvSearch: (val) => {
    state.invSearchVal = val.toLowerCase().trim();
    renderInventory();
  },
});
