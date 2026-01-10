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
import { state, saveAppState, updateInventoryCount } from "./state.js";
import {
  addToQueue,
  fetchRivenAverage,
  fetchBestFissures,
  getPriceValue,
  getSlug,
  getRivenSlug,
} from "./api.js";

let debounceTimer;

const t = TEXTS[state.currentLang];

export function showToast(message) {
  const toast = document.getElementById("error-toast");
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 3000);
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

  ["relic", "set", "riven", "profile", "lfg"].forEach((m) => {
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
      else if (tabName === "live") {
        document.getElementById("mode-live").classList.remove("hidden");
      }
    } else {
      footer.style.display = "none";
    }
  }
  toggleInventoryPanel(false);
  const invBtn = document.getElementById("inventory-toggle-btn");
  if (invBtn) {
    if (tabId === "relic") {
      invBtn.classList.remove("hidden");
      invBtn.style.display = "flex";
    } else {
      invBtn.classList.add("hidden");
      invBtn.style.display = "none";
    }
  }
  const resultsPanel = document.getElementById("scanned-results-panel");
  if (resultsPanel) {
    resultsPanel.classList.add("hidden");
  }
  const overlay = document.getElementById("ocr-overlay");
  if (overlay && !overlay.classList.contains("hidden")) {
    overlay.classList.add("hidden");
    if (window.closeScanner) window.closeScanner();
  }
  if (mode === "lfg") updateLFGUI();
  else generateMessage();
}

export function changeLanguage() {
  if (!state.currentLang) state.currentLang = "es";
  saveAppState();
  updateLangButtonVisuals(state.currentLang);
  const t = TEXTS[state.currentLang];

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  const setTab = (id, text, tip) => {
    const el = document.getElementById(id);
    if (el) {
      const img = el.querySelector("img");
      el.innerHTML = "";
      if (img) el.appendChild(img);
      el.appendChild(document.createTextNode(" " + text));
      el.setAttribute("data-tooltip", tip);
    }
  };

  setTab("btn-relic", t.menuRelic || "Reliquia", t.tooltips.tabRelic);
  setTab("btn-set", t.menuSet || "Set", t.tooltips.tabSet);
  setTab("btn-riven", t.menuRiven || "Riven", t.tooltips.tabRiven);
  setTab("btn-profile", t.menuProfile || "Perfil", t.tooltips.tabProfile);
  setTab("btn-lfg", t.menuLfg || "LFG", t.tooltips.tabLfg);

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

  setText("lbl-search-item", t.lblItem);
  const setInput = document.getElementById("setItemInput");
  if (setInput) setInput.placeholder = t.phItem;

  setText("lbl-riven-weapon", t.lblRivenW);
  const rivenInput = document.getElementById("rivenWeaponInput");
  if (rivenInput) rivenInput.placeholder = t.phRivenW;
  setText("lbl-riven-stats", t.lblRivenS);
  setText("btn-riven-search", t.rivenSearch);
  const statNegOpt = document.querySelector('#rivenStatNeg option[value=""]');
  if (statNegOpt) statNegOpt.innerText = t.lblRivenNeg;

  setText("lbl-username", t.lblUser);
  const btnCheck = document.querySelector("#mode-profile button");
  if (btnCheck) btnCheck.innerText = t.btnCheck;
  setText("txt-mr-label", t.lblMrCalc);

  setText("lbl-lfg-activity", t.lblLfgActivity);
  setText("lbl-lfg-players", t.lblLfgPlayers);
  setText("btn-copy", t.btnCopy);

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

  setText("txt-inv-title", t.inventory.title);
  const invInput = document.getElementById("inv-search-input");
  if (invInput) invInput.placeholder = t.inventory.searchPlaceholder;

  setText("txt-fissure-title", t.lblFissures || "Fisuras Activas");

  setText("lbl-relic-name", t.lblRelic);
  if (relicInput) relicInput.placeholder = t.phRelic;

  const guideText = document.getElementById("relic-add-guide");
  if (guideText) guideText.innerText = t.addGuide;
  const lfgItems = document.querySelectorAll("#lfgDropdown .dropdown-item");
  const keys = [
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
  keys.forEach((key, index) => {
    if (lfgItems[index] && t.lfgOpts[key])
      lfgItems[index].innerText = t.lfgOpts[key];
  });

  const currentVal = document.getElementById("lfgActivity").value;
  if (t.lfgOpts[currentVal]) setText("lfgSelectedText", t.lfgOpts[currentVal]);

  populateRivenSelects();
  const modeLfg = document.getElementById("mode-lfg");
  if (modeLfg && !modeLfg.classList.contains("hidden")) updateLFGUI();
  if (state.currentActiveSet) renderSetTracker();
  if (state.selectedRelic) manualRelicUpdate();
  const guideIcon = document.getElementById("relic-guide-icon");
  if (guideIcon) {
    guideIcon.setAttribute("data-tooltip", t.addGuide);
  }
  const tier = document.getElementById("relicInput").value.split(" ")[0];
  if (tier && state.selectedRelic) {
    updateRecommendedMissions(tier);
  }
  if (state.selectedRelic) {
    manualRelicUpdate();
  }
  generateMessage();
}

// --- MESSAGE GEN ---
export function changeCount(n) {
  state.playerCount = Math.max(1, Math.min(4, state.playerCount + n));
  document.getElementById("countDisplay").innerText = state.playerCount;
  generateMessage();
}

export function generateMessage() {
  // Usamos requestAnimationFrame para no bloquear el hilo principal
  // mientras el menú desplegable se está cerrando.
  requestAnimationFrame(() => {
      const t = TEXTS[state.currentLang];
      const defaultText = t.defaultRelic;
      let rName = state.selectedRelic || defaultText;
      rName = rName.trim();
    
      // Obtenemos el texto del select visual (o del nativo si no hay visual)
      // Nota: Si usas el dropdown custom, el valor del select nativo ya está actualizado
      const refSelect = document.getElementById("refinement");
      const refVal = refSelect.value;
      const refText = refSelect.options[refSelect.selectedIndex]?.text || refVal;
    
      let linkChat = "";
      if (!state.selectedRelic) linkChat = `[${defaultText}]`;
      else {
        if (state.currentLang === "en") linkChat = `[${rName} Relic]`;
        else linkChat = `[Reliquia ${rName}]`;
      }
    
      let countText = `${state.playerCount}/4`;
      if (state.playerCount === 4) countText = "3/4";
    
      const fullMessage = `H ${linkChat} ${refText} ${countText}`;
      const msgBox = document.getElementById("finalMessage");
      
      if (msgBox) {
        // Solo actualizamos el DOM si el texto ha cambiado realmente
        if (msgBox.innerText !== fullMessage) {
            msgBox.innerText = fullMessage;
            
            // ELIMINADO EL HACK DE .offsetHeight QUE CONGELABA LA PANTALLA
            // En su lugar, simplemente quitamos y ponemos la clase para animar
            msgBox.classList.remove("pulse-anim");
            
            // Esperamos un micro-tick para re-aplicar la animación sin bloquear
            setTimeout(() => {
                msgBox.classList.add("pulse-anim");
            }, 10);
        }
      }
    
      // Recalcular precios (ya optimizado en el paso anterior)
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
    state.selectedRelic = relicInput.value;

    const tier = state.selectedRelic.split(" ")[0];
    if (typeof window.updateRecommendedMissions === "function") {
      window.updateRecommendedMissions(tier).catch((err) => console.error(err));
    }

    if (typeof window.generateMessage === "function") window.generateMessage();

    const listDiv = document.getElementById("relic-drops-list");
    const profitDisplay = document.getElementById("relic-profit-display");
    const container = document.getElementById("relic-contents");
    const statusBadge = document.getElementById("relic-status-badge");

    if (!listDiv || !profitDisplay || !container) return;

    listDiv.innerHTML = "";
    profitDisplay.innerText = "...";
    profitDisplay.classList.add("loading");

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");

      if (statusBadge) {
        const status = state.relicStatusDB[state.selectedRelic] || "vaulted";

        statusBadge.className = "badge";
        statusBadge.style.display = "inline-block";

        if (status === "active" || status === "aya") {
          statusBadge.classList.add(status === "aya" ? "aya" : "active");
          statusBadge.innerText =
            status === "aya" ? "AYA (RESURGENCE)" : "ACTIVE";

          const tooltipHTML = getRelicDropTooltip(state.selectedRelic);
          statusBadge.setAttribute("data-tooltip-html", tooltipHTML);
          statusBadge.removeAttribute("data-tooltip");
          statusBadge.classList.add("vaulted");
          statusBadge.innerText = "VAULTED";

          statusBadge.removeAttribute("data-tooltip-html");
          statusBadge.setAttribute(
            "data-tooltip",
            "Esta reliquia está en la Bóveda (No cae actualmente)."
          );
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
        <button class="riven-btn" style="padding: 8px 15px; background: var(--wf-blue); color: #000; font-weight:bold;" onclick="window.addCurrentToInv()">
            + ${t.manualAdd || "Add to Inventory"}
        </button>
      `;

      const items = state.relicsDatabase[state.selectedRelic];
      items.sort((a, b) => b.chance - a.chance);
      const abbr = TEXTS[state.currentLang].rarityAbbr;

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
          row.setAttribute("data-rarity", "rare");
        } else if (item.chance <= 11) {
          rarityLabel = abbr.uncommon;
          row.setAttribute("data-rarity", "uncommon");
        } else {
          row.setAttribute("data-rarity", "common");
        }

        if (isUntradable) {
          row.setAttribute("data-rarity", "forma");
        }

        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        let nameDisplay;
        if (isUntradable) {
          nameDisplay = `<span class="component-name forma">${item.name.replace(
            "Blueprint",
            "BP"
          )}</span>`;
        } else {
          nameDisplay = `
            <span class="component-name item-interactive" onclick="window.findRelicsForItem('${
              item.name
            }')">
                ${item.name}
            </span>
            <a href="https://warframe.market/items/${getSlug(
              item.name
            )}" target="_blank" class="market-link-icon">↗</a>
          `;
        }

        const badgeContent = isUntradable
          ? '0<span class="pl-unit">pl</span>'
          : "...";
        const badgeClass = isUntradable
          ? "price-badge forma"
          : "price-badge loading";

        row.innerHTML = `
            <div class="component-info">
                <span class="rarity-indicator">${rarityLabel}</span>
                <span class="name-wrapper">
                    ${nameDisplay}
                </span>
            </div>
            <div class="${badgeClass}" data-item="${item.name.replace(
          /"/g,
          "&quot;"
        )}">
                ${badgeContent}
            </div>
        `;

        listDiv.appendChild(row);

        const badge = row.querySelector(".price-badge");
        if (!isUntradable) {
          addToQueue(item.name, badge);
        }
      });
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
  element.innerHTML = `${price}<span style="font-size:0.7em">pl</span>`;
  if (document.getElementById("relic-profit-display")) updateRelicTotal();
}

function updateRelicTotal() {
  if (!state.selectedRelic || !state.relicsDatabase[state.selectedRelic])
    return;

  const items = state.relicsDatabase[state.selectedRelic];
  const badges = document.querySelectorAll(
    "#relic-drops-list .price-badge:not(.big)"
  );
  const refinementInput = document.getElementById("refinement").value;
  const squadSize = state.playerCount || 1;

  const itemDataWithPrice = items.map((item) => {
    let rarityType = "common";
    if (item.chance < 5) rarityType = "rare";
    else if (item.chance < 20) rarityType = "uncommon";

    let price = 0;
    const badge = Array.from(badges).find(
      (b) => b.getAttribute("data-item") === item.name.replace(/"/g, "&quot;")
    );
    if (badge) {
      price = parseInt(badge.innerText) || 0;
    }

    return { ...item, rarityType, price };
  });

  const totalEV = calculateSquadEV(
    itemDataWithPrice,
    refinementInput,
    squadSize
  );

  const disp = document.getElementById("relic-profit-display");
  const label = document.getElementById("lbl-profit");
  const t = TEXTS[state.currentLang];

  if (squadSize > 1) {
    label.innerText = t.lblProfitSquad.replace("{n}", squadSize);
    label.style.color = "var(--wf-blue)";
  } else {
    label.innerText = t.lblProfitSolo;
    label.style.color = "#bbb";
  }

  disp.innerHTML = `~${totalEV.toFixed(
    1
  )}<span style="font-size:0.7em">pl</span>`;

  const stillLoading = Array.from(badges).some((b) =>
    b.classList.contains("loading")
  );
  if (!stillLoading) disp.classList.remove("loading");
}



function calculateSquadEV(items, refinement, squadSize) {

  const keyMap = {
    "Rad": "Radiant",
    "Intact": "Intact",
    "Exceptional": "Exceptional",
    "Flawless": "Flawless"
  };

  const safeKey = keyMap[refinement] || refinement;

  const rates = (DROP_CHANCES && DROP_CHANCES[safeKey]) 
             || (DROP_CHANCES && DROP_CHANCES.Intact) 
             || { common: 0.76, uncommon: 0.22, rare: 0.02 };

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
      createSetCard(itemName, [itemName], container, true)
    );
}

function createSetCard(title, itemNames, parent, isSingle = false) {
  const setContainer = document.createElement("div");
  setContainer.className = "set-container";
  const header = document.createElement("div");
  header.className = "set-header";
  let titleHTML = isSingle
    ? `<span>${title}</span>`
    : `<a href="https://warframe.market/items/${getSlug(
        title + " Set"
      )}" target="_blank" class="market-link">${title} SET<span class="link-icon">↗</span></a>`;
  header.innerHTML = titleHTML;

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
        ? itemName.replace(title, "").trim()
        : itemName;

    const priceSpan = document.createElement("span");
    priceSpan.className = "price-badge loading";
    priceSpan.innerText = "...";
    addToQueue(itemName, priceSpan);

    row.innerHTML = `<div class="component-header"><a href="https://warframe.market/items/${getSlug(
      itemName
    )}" target="_blank" class="market-link"><span class="component-name">${dispName}</span><span class="link-icon">↗</span></a></div>`;
    row.appendChild(priceSpan);

    if (relicsInfo.length === 0)
      row.innerHTML += `<div style="color:#666;font-size:0.8em;font-style:italic;margin-left:10px;">Vaulted</div>`;
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
          const safeHtml = rawHtml.replace(/"/g, "&quot;");
          tooltipAttr = `data-tooltip-html="${safeHtml}"`;
        } else {
          tooltipAttr = `data-tooltip="Esta reliquia está Vaulted"`;
        }

        btn.className = `relic-chip ${rc}`;

        btn.innerHTML = `
            <div class="relic-chip-header">
                <span class="relic-name">${info.relic}</span>
                <img src="${
                  TIER_URLS[tier] || TIER_URLS.Lith
                }" class="relic-img">
            </div>
            <div class="chip-footer">
                <span class="rarity-text ${rc}">${rl}</span>
                <span class="status-badge ${stKey}" ${tooltipAttr}>${stTxt}</span>
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
        <img src="${
          TIER_URLS[tier] || TIER_URLS.Lith
        }" class="relic-img" style="width:20px;">
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

  state.activeSetParts.forEach((partName) => {
    const wrapper = document.createElement("div");
    const isDone = state.completedParts.has(partName);

    const row = document.createElement("div");
    row.className = `tracker-item ${isDone ? "done" : ""}`;

    const nameText =
      partName === state.currentActiveSet
        ? "Blueprint"
        : partName.replace(state.currentActiveSet, "").trim();

    const partSlug = getSlug(partName);

    const nameSpan = document.createElement("span");
    nameSpan.className = "t-name";
    nameSpan.innerHTML = `
      ${nameText}
      <a href="https://warframe.market/items/${partSlug}" target="_blank" class="market-link-icon" onclick="event.stopPropagation()">↗</a>
    `;

    const btnCheck = document.createElement("button");
    btnCheck.className = "t-check";
    btnCheck.innerText = isDone ? t.markUndo : t.markDone;

    btnCheck.onclick = (e) => {
      e.stopPropagation();
      if (isDone) state.completedParts.delete(partName);
      else state.completedParts.add(partName);
      renderSetTracker();
    };

    row.appendChild(nameSpan);
    row.appendChild(btnCheck);

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
          if (window.renderRelicsForPartInline) {
            window.renderRelicsForPartInline(partName, drawer);
          }
        }
      }
    };

    wrapper.appendChild(row);
    wrapper.appendChild(drawer);
    list.appendChild(wrapper);
  });
}

export function populateRivenSelects(weaponType = "Rifle") {
  const selects = document.querySelectorAll(".riven-stat-select");
  const isSpan = state.currentLang === "es";

  const typeIdx = WEAPON_TYPE_IDX[weaponType] ?? 0;

  selects.forEach((sel) => {
    const savedValue = sel.value;

    while (sel.options.length > 1) sel.remove(1);

    RIVEN_STATS.forEach((stat) => {
      const baseStatKey =
        stat.name_en === "Crit Chance"
          ? "Critical Chance"
          : stat.name_en === "Crit Damage"
          ? "Critical Damage"
          : stat.name_en === "Status Chance"
          ? "Status Chance"
          : stat.name_en === "Damage"
          ? "Damage"
          : stat.name_en === "Multishot"
          ? "Multishot"
          : stat.name_en.split(" / ")[0];

      const baseVal = RIVEN_BASE_STATS[baseStatKey]?.[typeIdx];

      if (baseVal !== 0 && baseVal !== undefined) {
        let opt = document.createElement("option");
        opt.value = baseStatKey;
        opt.innerText = isSpan ? stat.name_es : stat.name_en;
        sel.appendChild(opt);
      }
    });

    const exists = Array.from(sel.options).some((o) => o.value === savedValue);
    sel.value = exists ? savedValue : "";
  });

  updateSelectExclusions();
}

export function handleRivenInput() {
  const input = document.getElementById("rivenWeaponInput");
  const dropdown = document.getElementById("rivenDropdown");
  if (!input || !dropdown) return;

  const val = input.value.toUpperCase().trim();

  if (
    (!state.allRivenNames || state.allRivenNames.length === 0) &&
    state.weaponMap
  ) {
    state.allRivenNames = Object.keys(state.weaponMap).sort();
  }

  const source = state.allRivenNames || [];
  const matches = source
    .filter((n) => n.toUpperCase().includes(val))
    .slice(0, 10);

  if (matches.length > 0) {
    dropdown.innerHTML = "";
    dropdown.classList.remove("hidden");

    matches.forEach((name) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerText = name;

      item.onclick = () => {
        console.log(`🖱️ [LOG]: Click detectado en: "${name}"`);

        input.value = name;
        dropdown.classList.add("hidden");

        const weaponData = state.weaponMap[name];
        console.log(
          `📊 [LOG]: Datos en state.weaponMap["${name}"]:`,
          weaponData
        );

        if (weaponData) {
          const dispoDisplay = document.getElementById("riven-dispo-display");
          if (dispoDisplay) {
            const displayValue = parseFloat(weaponData.d).toFixed(2);
            dispoDisplay.innerHTML = `Riven disposition: <b style="color:var(--wf-gold-text)">${displayValue}</b>`;
          } else {
            /*
              " No se encontró el elemento 'riven-dispo-display' en el HTML."
            */
          }

          populateRivenSelects(weaponData.t);
        } else {
          /*Error  state.weaponMap no tiene datos para name
           */
        }

        fetchRivenAverage(name);
      };

      dropdown.appendChild(item);
    });
  } else {
    dropdown.classList.add("hidden");
  }
}

export function updateSelectExclusions() {
  const selects = Array.from(document.querySelectorAll(".riven-stat-select"));
  const selectedValues = selects.map((s) => s.value).filter((v) => v !== "");

  selects.forEach((currentSelect) => {
    const myValue = currentSelect.value;

    Array.from(currentSelect.options).forEach((option) => {
      if (option.value === "") return;

      if (selectedValues.includes(option.value) && option.value !== myValue) {
        option.hidden = true;
        option.style.display = "none";
      } else {
        option.hidden = false;
        option.style.display = "";
      }
    });
  });

  if (typeof updateGradingUI === "function") updateGradingUI();
}

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
        optionsContainer.querySelectorAll(".lfg-role:checked")
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
      const prefix =
        eliteEl && eliteEl.checked
          ? state.currentLang === "es"
            ? "Élite "
            : "Elite "
          : "";
      msg = `H ${prefix}${activityName}`;
    } else if (act === "eda") {
      const eliteEl = document.getElementById("lfg-eda-elite");
      const prefix =
        eliteEl && eliteEl.checked
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

    const count =
      typeof state !== "undefined" && state.lfgCount ? state.lfgCount : 1;
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
    
    if (!fissureLoadPromise) {
      fissureLoadPromise = initFissurePanel().then(() => {
          // fissureLoadPromise = null; 
      });
    } else {
      //en curso
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

    tooltipEl.addEventListener("mouseenter", () => {
      if (currentMode === "mega" && closeTimer) clearTimeout(closeTimer);
    });
    tooltipEl.addEventListener("mouseleave", () => {
      if (currentMode === "mega") hideTooltip();
    });

    document.body.appendChild(tooltipEl);
  }

  const moveSimpleTooltip = (e) => {
    const offset = 15;
    const tWidth = tooltipEl.offsetWidth;
    const tHeight = tooltipEl.offsetHeight;

    let left = e.clientX + offset;
    let top = e.clientY + offset;

    if (left + tWidth > window.innerWidth) left = e.clientX - tWidth - offset;
    if (top + tHeight > window.innerHeight) top = e.clientY - tHeight - offset;

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

    if (left + tWidth > window.innerWidth) left = rect.left - tWidth - gap;

    if (top + tHeight > window.innerHeight) top = rect.bottom - tHeight;

    if (top < 10) top = 10;
    if (left < 10) left = 10;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const showTooltip = (e, target) => {
    if (closeTimer) clearTimeout(closeTimer);

    const htmlContent = target.getAttribute("data-tooltip-html");
    const textContent = target.getAttribute("data-tooltip");

    if (htmlContent) {
      currentMode = "mega";
      tooltipEl.innerHTML = htmlContent;
      tooltipEl.classList.add("mega-mode");
    } else if (textContent) {
      currentMode = "simple";
      tooltipEl.innerText = textContent;
      tooltipEl.classList.remove("mega-mode");
    } else {
      //No content
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
      closeTimer = setTimeout(() => {
        tooltipEl.classList.add("hidden");
      }, 300);
    }
  };

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip], [data-tooltip-html]");
    if (target) showTooltip(e, target);
  });

  document.addEventListener("mousemove", (e) => {
    if (currentMode === "simple" && !tooltipEl.classList.contains("hidden")) {
      moveSimpleTooltip(e);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target.closest("[data-tooltip], [data-tooltip-html]");
    if (target) {
      if (
        currentMode === "mega" &&
        e.relatedTarget &&
        e.relatedTarget.closest("#global-tooltip")
      ) {
        return;
      }
      hideTooltip();
    }
  });
}
export function openRivenMarket() {
  const inputVal = document.getElementById("rivenWeaponInput").value.trim();
  //if (!inputVal) return alert("Por favor introduce un nombre de arma");

  let slug = getRivenSlug(inputVal);
  let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${slug}&polarity=any&sort_by=price_asc`;

  const stat1 = document.getElementById("rivenStat1").value;
  const stat2 = document.getElementById("rivenStat2").value;
  const stat3 = document.getElementById("rivenStat3").value;
  const statNeg = document.getElementById("rivenStatNeg").value;

  let positives = [];
  if (stat1) positives.push(stat1);
  if (stat2) positives.push(stat2);
  if (stat3) positives.push(stat3);

  if (positives.length > 0) url += `&positive_stats=${positives.join(",")}`;
  if (statNeg) url += `&negative_stats=${statNeg}`;

  window.open(url, "_blank");
}

/*export function getRivenSlug(inputVal) {
  const validWeapons = state.allRivenNames || [];
  let fullSlug = inputVal.toLowerCase().trim().replace(/\s+/g, "_");
  let nakedSlug = getNakedName(fullSlug);

  if (nakedSlug === fullSlug) return fullSlug;

  const baseExists = validWeapons.some(
    (name) => name.toLowerCase().replace(/\s+/g, "_") === nakedSlug
  );

  return baseExists ? nakedSlug : fullSlug;
}*/

export function getNakedName(slug) {
  let s = slug;
  const prefixes = [
    "coda_",
    "kuva_",
    "tenet_",
    "carmine_",
    "rakta_",
    "synoid_",
    "sancti_",
    "vaykor_",
    "telos_",
    "secura_",
    "mk1_",
    "prisma_",
    "mara_",
    "dex_",
  ];
  const suffixes = ["_prime", "_vandal", "_wraith", "_prisma"];

  for (let pre of prefixes) {
    if (s.startsWith(pre)) {
      s = s.replace(pre, "");
      break;
    }
  }
  for (let suf of suffixes) {
    if (s.endsWith(suf)) {
      s = s.replace(suf, "");
      break;
    }
  }
  return s;
}

window.findRelicsForItem = function (itemName) {
  const setInput = document.getElementById("setItemInput");
  if (setInput) {
    let searchTerm = itemName;

    if (itemName.includes("Prime"))
      searchTerm = itemName.split("Prime")[0].trim() + " Prime";
    else if (itemName.includes("Vandal"))
      searchTerm = itemName.split("Vandal")[0].trim() + " Vandal";
    else if (itemName.includes("Wraith"))
      searchTerm = itemName.split("Wraith")[0].trim() + " Wraith";
    else searchTerm = itemName.replace("Blueprint", "").trim();

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

    const header = document.getElementById("fissure-panel-header");
    const runner = document.getElementById("gauss-runner");
    let runTimeout;
    if (header && runner) {
      header.addEventListener("mouseenter", () => {
        runTimeout = setTimeout(() => {
          if (runner) {
            runner.classList.add("is-running");
            setTimeout(() => {
              if (runner) runner.classList.remove("is-running");
            }, 3000);
          }
        }, 2000);
      });
      header.addEventListener("mouseleave", () => clearTimeout(runTimeout));
    }
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
      (m) => efficientTypes.includes(m.type) || m.tier === "Omnia"
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

window.toggleSyncPanel = function () {
  const panel = document.getElementById("cloud-sync-container");
  panel.classList.toggle("open");

  if (!panel.classList.contains("open")) {
    stopReceiver();
  } else {
    if (
      document.getElementById("panel-receive").classList.contains("active") ||
      !document.getElementById("panel-send").classList.contains("active")
    ) {
      switchSyncTab("receive");
    }
  }
};

window.switchSyncTab = function (mode) {
  const t = TEXTS[state.currentLang];

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
window.executeSyncSend = async function () {
  const t = TEXTS[state.currentLang].sync;
  const code = document.getElementById("sync-input-code").value;
  const msg = document.getElementById("finalMessage")?.innerText;
  const btn = document.getElementById("btn-do-sync");

  if (!code || code.length !== 4)
    return showToast("Código inválido (4 dígitos)");
  if (!msg || msg === "...") return showToast("No hay mensaje para enviar");

  const originalText = btn.innerText;
  btn.innerText = t.sending;
  btn.disabled = true;

  try {
    const res = await fetch(
      `${WORKER_URL}?type=sync_set&id=${code}&val=${encodeURIComponent(msg)}`
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
                  <span style="font-size:0.85em; font-weight:bold; color:#888;">${t.title}</span>
                  <button class="mini-action-btn" onclick="window.saveLFGPreset()">+ ${t.btnSave}</button>
                </div>`;

  if (!state.lfgPresets || state.lfgPresets.length === 0) {
    html += `<div style="font-size:0.8em; color:#555; font-style:italic; padding:5px;">${t.empty}</div>`;
  } else {
    html += `<div class="presets-list">`;
    state.lfgPresets.forEach((p, index) => {
      html += `
                <div class="preset-chip" onclick="window.loadLFGPreset(${index})">
                    <span class="p-name">${p.name}</span>
                    <span class="p-act">${p.activity.toUpperCase()}</span>
                    <button class="p-del" onclick="event.stopPropagation(); window.deleteLFGPreset(${index})">×</button>
                </div>
            `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

window.saveLFGPreset = function () {
  const t = TEXTS[state.currentLang].lfgPresets;
  const name = prompt(t.placeholder);
  if (!name) return;

  const activity = document.getElementById("lfgActivity").value;
  const extra = document.getElementById("lfgExtra").value;
  const count = state.lfgCount;

  const roles = Array.from(document.querySelectorAll(".lfg-role:checked")).map(
    (c) => c.value
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

window.loadLFGPreset = function (index) {
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

window.deleteLFGPreset = function (index) {
  if (confirm(TEXTS[state.currentLang].lfgPresets.deleteConfirm)) {
    state.lfgPresets.splice(index, 1);
    saveAppState();
    renderLFGPresets();
  }
};
export function toggleInventoryPanel(forceOpen = false) {
  const panel = document.getElementById("inventory-container");
  if (forceOpen) panel.classList.add("open");
  else panel.classList.toggle("open");
  if (panel.classList.contains("open")) renderInventory();
}

export function clearInventory() {
  if (confirm("Delete all saved relics?")) {
    state.inventory = [];
    saveAppState();
    renderInventory();
  }
}

let inventoryPriceUpdateInterval = null;

export async function renderInventory() {
  const list = document.getElementById("inventory-list");
  if (!list) return;

  list.classList.remove("inventory-loading");

  if (!state.inventory || state.inventory.length === 0) {
    list.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">Inventory empty</div>`;
    return;
  }

  const sortMode = document.getElementById("inv-sort")?.value || "recent";

  const filtered = state.inventory.filter((item) => {
    const name = (typeof item === "string" ? item : item.name).toUpperCase();
    if (
      state.invSearchVal &&
      !name.toLowerCase().includes(state.invSearchVal.toLowerCase())
    )
      return false;
    if (state.invFilterTier !== "ALL") {
      let tier = name.split(" ")[0];
      if (tier === "VANGUARD") tier = "AXI";
      if (tier !== state.invFilterTier) return false;
    }
    return true;
  });

  const fragment = document.createDocumentFragment();

  filtered.forEach((item) => {
    const itemName = typeof item === "string" ? item : item.name;
    const count = item.count || 1;
    const isVaulted = state.relicStatusDB[itemName] === "vaulted";
    const safeId = itemName.replace(/[^a-zA-Z0-9]/g, "");

    const row = document.createElement("div");
    row.className = "inv-row";
    row.dataset.relic = itemName;

    row.innerHTML = `
          <div class="inv-name-group" onclick="selectRelicFromInv('${itemName.replace(
            /'/g,
            "\\'"
          )}')">
              <div class="inv-name">${itemName}</div>
              <div class="inv-meta">
                 <span style="color:${isVaulted ? "#e44" : "#aaa"}">${
      isVaulted ? "V" : "A"
    }</span>
                 <span id="duc-${safeId}" style="color:var(--wf-gold)">... duc</span>
              </div>
          </div>
          <div class="inv-price-tag">
              <div id="price-${safeId}" class="price-loading">...p</div>
              <div style="font-size:0.8em; opacity:0.6">x${count}</div>
          </div>
          <div class="inv-qty-controls">
              <button class="inv-btn minus" onclick="modifyInv('${itemName.replace(
                /'/g,
                "\\'"
              )}', -1)">−</button>
              <button class="inv-btn plus" onclick="modifyInv('${itemName.replace(
                /'/g,
                "\\'"
              )}', 1)">+</button>
          </div>
    `;
    fragment.appendChild(row);
  });

  list.innerHTML = "";
  list.appendChild(fragment);

  triggerPriceFetch(filtered);
}

async function triggerPriceFetch(relicList) {
  if (inventoryPriceUpdateInterval) clearInterval(inventoryPriceUpdateInterval);

  const { addToQueue } = await import("./api.js");

  relicList.forEach((item) => {
    const rName = typeof item === "string" ? item : item.name;
    const drops = state.relicsDatabase[rName];

    if (drops) {
      drops.forEach((drop) => {
        const dummyBadge = document.createElement("div");
        addToQueue(drop.name, dummyBadge);
      });
    }
  });

  let attempts = 0;
  inventoryPriceUpdateInterval = setInterval(async () => {
    attempts++;
    const rows = document.querySelectorAll(".inv-row");

    for (const row of rows) {
      const rName = row.dataset.relic;
      const safeId = rName.replace(/[^a-zA-Z0-9]/g, "");
      const priceEl = document.getElementById(`price-${safeId}`);
      const ducEl = document.getElementById(`duc-${safeId}`);

      if (!priceEl) continue;

      const stats = await calculateRelicValue(rName);

      if (stats.intact > 0 || attempts > 10) {
        if (priceEl.innerText !== `${stats.intact}p`) {
          priceEl.innerText = `${stats.intact}p`;
          priceEl.classList.remove("price-loading");
          priceEl.style.color = "#42f56c";
          setTimeout(() => (priceEl.style.color = ""), 1000);
        }
        if (ducEl) ducEl.innerText = `${stats.ducats} duc`;
      }
    }

    if (attempts > 15) {
      clearInterval(inventoryPriceUpdateInterval);
    }
  }, 1000);
}

function resetLoadingStyle(element) {
  if (!element) return;
  element.style.opacity = "1";
  element.style.pointerEvents = "auto";
}
window.modifyInv = (name, amount) => {
  updateInventoryCount(name, amount);
  saveAppState();
  renderInventory();
};

window.selectRelicFromInv = (name) => {
  const input = document.getElementById("relicInput");
  if (input) {
    input.value = name;
    state.selectedRelic = name;

    switchTab("relic");

    toggleInventoryPanel(false);

    manualRelicUpdate();
  }
};

async function calculateRelicValue(relicName) {
  const drops = state.relicsDatabase[relicName];

  if (!drops) return { intact: 0, rad: 0, ducats: 0 };

  let totalIntact = 0;
  let totalRad = 0;
  let avgDucats = 0;

  const promises = drops.map(async (d) => {
    const slug = getSlug(d.name);

    const price = await getPriceValue(d.name, slug);
    //TODO EXCEPTIONS TO BE IMPLEMENTED LATER
    let ducatValue = 15;
    if (d.chance < 20) ducatValue = 45;
    if (d.chance < 5) ducatValue = 100;

    let pIntact = 0.2533;
    let pRad = 0.1667;

    if (d.chance < 20) {
      pIntact = 0.11;
      pRad = 0.2;
    }
    if (d.chance < 5) {
      pIntact = 0.02;
      pRad = 0.1;
    }

    return {
      intactVal: price * pIntact,
      radVal: price * pRad,
      ducatVal: ducatValue * pIntact,
    };
  });

  const results = await Promise.all(promises);

  results.forEach((res) => {
    totalIntact += res.intactVal;
    totalRad += res.radVal;
    avgDucats += res.ducatVal;
  });

  return {
    intact: parseFloat(totalIntact.toFixed(1)),
    rad: parseFloat(totalRad.toFixed(1)),
    ducats: Math.round(avgDucats),
  };
}

window.filterInvTier = (tier) => {
  state.invFilterTier = tier;
  document.querySelectorAll(".inv-tier-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (
      btn.innerText === tier ||
      (tier === "REQUIEM" && btn.innerText === "REQ") ||
      (tier === "ALL" && btn.innerText === "ALL")
    ) {
      btn.classList.add("active");
    }
  });
  renderInventory();
};
window.selectRelicFromInv = (name) => {
  state.selectedRelic = name;
  const input = document.getElementById("relicInput");
  if (input) input.value = name;

  switchTab("relic");
  toggleInventoryPanel(false);
  manualRelicUpdate();
};
window.addCurrentToInv = function () {
  if (!state.selectedRelic) return;

  updateInventoryCount(state.selectedRelic, 1);
  saveAppState();

  const t = TEXTS[state.currentLang];
  const msg =
    state.currentLang === "es"
      ? ` ${state.selectedRelic} añadida al inventario.`
      : ` ${state.selectedRelic} added to inventory.`;

  showToast(msg);

  const btn = document.querySelector("#manual-add-container button");
  if (btn) {
    const originalText = btn.innerText;
    btn.innerText = "✔ OK";
    setTimeout(() => (btn.innerText = originalText), 1000);
  }

  renderInventory();
};

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
      closeSidePanel("inventory-container", "inv-toggle-btn");
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

  let html = `<div class='tooltip-header'>Drops for ${tierName} (${sources.length})</div>`;

  html += "<ul class='tooltip-list'>";

  sources.forEach((s, index) => {
    let locText = "";

    if (s.type === "mission") {
      locText = `<span class="t-loc">${s.location}</span> <span style="color:#888">-</span> ${s.mission} <span class='rot-badge'>${s.rotation}</span>`;
    } else {
      let stage = s.rotation.replace("Rotation ", "").replace("Stage ", "St.");
      locText = `<span class="t-loc">${s.location}</span> <span style="color:#888">-</span> ${s.mission} <span class='rot-badge'>${stage}</span>`;
    }

    const isTop = index < 5;
    const rowClass = isTop ? "top-drop" : "";

    let chanceColor = "#888";
    if (s.chance > 10) chanceColor = "var(--wf-gold-text)";
    else if (s.chance > 5) chanceColor = "var(--wf-blue)";

    html += `<li class="${rowClass}">
      <div class="t-row">${locText}</div>
      <span class='drop-chance' style="color:${chanceColor}">${s.chance.toFixed(
      2
    )}%</span>
    </li>`;
  });

  html += "</ul>";
  return html;
}

export function renderRivenGradingUI(weaponName, statsArray) {
  const weaponData = state.weaponMap[weaponName];
  const disposition = weaponData ? weaponData.disposition : 1.0;
  const weaponType = weaponData ? weaponData.type : "Rifle";

  const buffCount = statsArray.filter((s) => s.value > 0).length;
  const hasCurse = statsArray.some((s) => s.value < 0);

  let html = `<div class="riven-grading-box">`;
  html += `<h4>Grading: ${weaponName} (Disp: ${disposition})</h4>`;

  statsArray.forEach((stat) => {
    const isCurse = stat.value < 0;
    const result = calculateRivenGrade(
      weaponType,
      disposition,
      stat.name,
      stat.value,
      isCurse,
      buffCount,
      hasCurse
    );

    const colorClass =
      result.percentage > 90
        ? "grade-s"
        : result.percentage > 50
        ? "grade-b"
        : "grade-f";

    html += `
            <div class="grade-row">
                <span class="stat-name">${stat.name}</span>
                <span class="stat-val">${stat.value}%</span>
                <div class="grade-bar-container">
                    <div class="grade-bar ${colorClass}" style="width: ${result.percentage}%"></div>
                </div>
                <span class="grade-badge ${colorClass}">${result.grade}</span>
                <span class="grade-range">Range: ${result.min}% - ${result.max}%</span>
            </div>
        `;
  });
  html += `</div>`;

  return html;
}

export function openGradingModal() {
  const weaponInput = document.getElementById("rivenWeaponInput");
  const weaponName = weaponInput.value.trim();

  if (!weaponName || !state.weaponMap[weaponName]) {
    alert("Please select a valid weapon on the field above.");
    return;
  }

  const weaponData = state.weaponMap[weaponName];

  document.getElementById(
    "g-weapon-name"
  ).innerHTML = `${weaponName} <span style="color:#888; font-weight:normal; font-size:0.8em;">(Disp: ${weaponData.d})</span>`;
  document.getElementById("grading-modal").classList.remove("hidden");

  resetGradingInputs();

  populateRivenSelects(weaponData.t);

  document.getElementById("row-stat3").classList.add("hidden");
  document.getElementById("row-statNeg").classList.add("hidden");
  document.getElementById("btn-add-pos").style.display = "block";
  document.getElementById("btn-add-neg").style.display = "block";
  document.getElementById("grading-modal-results").classList.add("hidden");
}

export function closeGradingModal() {
  document.getElementById("grading-modal").classList.add("hidden");
}

export function showGradingRow(rowId) {
  document.getElementById(rowId).classList.remove("hidden");

  if (rowId === "row-stat3")
    document.getElementById("btn-add-pos").style.display = "none";
  if (rowId === "row-statNeg")
    document.getElementById("btn-add-neg").style.display = "none";
}

export function removeGradingRow(rowId) {
  const row = document.getElementById(rowId);
  row.classList.add("hidden");

  row.querySelector("select").value = "";
  row.querySelector("input").value = "";

  if (rowId === "row-stat3")
    document.getElementById("btn-add-pos").style.display = "block";
  if (rowId === "row-statNeg")
    document.getElementById("btn-add-neg").style.display = "block";

  calculateModalGrade();
}

function resetGradingInputs() {
  const inputs = document.querySelectorAll(
    "#grading-modal input, #grading-modal select"
  );
  inputs.forEach((i) => {
    if (i.id === "g-rank") i.value = "8";
    else i.value = "";
  });
}

export function calculateModalGrade() {
  const weaponName = document.getElementById("rivenWeaponInput").value.trim();
  if (!weaponName || !state.weaponMap[weaponName]) return;

  const weaponData = state.weaponMap[weaponName];
  const currentRank = parseInt(document.getElementById("g-rank").value || "8");
  const scaleFactor = 9 / (currentRank + 1);
  const resultsDiv = document.getElementById("grading-modal-results");

  const stats = [];

  const readModalRow = (selId, valId, isNeg) => {
    const sel = document.getElementById(selId);
    const valInput = document.getElementById(valId);

    if (sel.offsetParent !== null && sel.value && valInput.value) {
      let val = parseFloat(valInput.value);
      if (isNaN(val)) return;
      if (isNeg) val = -Math.abs(val);

      stats.push({
        name: sel.value,
        value: val,
        projected: val * scaleFactor,
        isPenaltySlot: isNeg,
      });
    }
  };

  readModalRow("g-stat1", "g-val1", false);
  readModalRow("g-stat2", "g-val2", false);
  readModalRow("g-stat3", "g-val3", false);
  readModalRow("g-statNeg", "g-valNeg", true);

  if (stats.length === 0) {
    resultsDiv.classList.add("hidden");
    return;
  }

  resultsDiv.classList.remove("hidden");
  let html = "";

  stats.forEach((stat) => {
    const result = calculateRivenGrade(
      weaponData,
      stat.name,
      stat.projected,
      stats
    );

    let colorClass = "grade-f";
    if (["SSS", "S+", "S"].includes(result.grade)) colorClass = "grade-s";
    else if (["A+", "A"].includes(result.grade)) colorClass = "grade-a";
    else if (["B+", "B"].includes(result.grade)) colorClass = "grade-b";

    html += `
        <div class="grade-card" style="background: rgba(0,0,0,0.3);">
            <div class="grade-badge-large ${colorClass}">${result.grade}</div>
            <div class="grade-info">
                <div class="grade-stat-name">${stat.name}</div>
                <div class="grade-values">
                    Valor: <span style="color:#fff">${Math.abs(
                      stat.value
                    )}%</span>
                    <span class="grade-range" style="font-size:0.8em"> / Ideal: ${
                      result.range
                    }</span>
                </div>
                <div class="grade-track">
                    <div class="grade-fill ${colorClass}" style="width: ${
      result.pct
    }%"></div>
                </div>
            </div>
        </div>
      `;
  });

  resultsDiv.innerHTML = html;
}

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
export function exportInventory() {
  if (!state.inventory || state.inventory.length === 0) {
    return showToast("Relic inventory is empty.");
  }

  try {
    const dataStr = JSON.stringify(state.inventory, null, 2);

    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `voidstonks_inv_${new Date().toISOString().slice(0, 10)}.json`;

    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Inventory downloaded");
  } catch (e) {
    console.error("Error exportando:", e);
    showToast("Error exporting file.");
  }
}

export function importInventory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        if (Array.isArray(data)) {
          if (
            confirm(
              `Archivo cargado con ${data.length} items.\n\nThis will overwrite your current relic inventory are you sure?`
            )
          ) {
            state.inventory = data;
            saveAppState();
            renderInventory();
            showToast("Sucessfuly updated relic inventory.");
          }
        } else {
          showToast("File has inccorrect format: ERROR");
        }
      } catch (err) {
        console.error(err);
        showToast("Error reading JSON file.");
      }
    };
    reader.readAsText(file);
  };

  input.click();
}
Object.assign(window, {
  openGradingModal,
  calculateModalGrade,
  closeGradingModal,
  showGradingRow,
  removeGradingRow,
  toggleInventoryPanel,
  renderInventory,
  clearInventory,
  showToast,
  finishLoading,
  closeUpdateModal,
  exportInventory,
  importInventory,
  updatePriceUI: (element, price) => {
    if (!element) return;
    element.classList.remove("loading");
    element.innerHTML = `${price}<span style="font-size:0.7em">pl</span>`;
    if (document.getElementById("relic-profit-display")) updateRelicTotal();
  },
});
window.handleInvSearch = (val) => {
  state.invSearchVal = val.toLowerCase().trim();
  renderInventory();
};
