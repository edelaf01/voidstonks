import {
  TEXTS,
  TIER_URLS,
  RIVEN_STATS,
  DROP_CHANCES,
  WORKER_URL,
} from "./config.js";
import { state, saveAppState } from "./state.js";
import { addToQueue, fetchRivenAverage, fetchBestFissures } from "./api.js";

let debounceTimer;

const t = TEXTS[state.currentLang];

// --- UTILS ---
export function getSlug(itemName) {
  return itemName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

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

  ["relic", "set", "riven", "profile", "lfg"].forEach((m) => {
    const el = document.getElementById("mode-" + m);
    if (el) el.classList.add("hidden");
  });

  const activeEl = document.getElementById("mode-" + mode);
  if (activeEl) activeEl.classList.remove("hidden");

  // Gestión del Footer
  const footer = document.getElementById("footer-relic");
  const msgText = document.getElementById("finalMessage");

  if (footer) {
    if (mode === "relic" || mode === "lfg") {
      footer.style.display = "block";
      if (mode === "lfg") {
        const neonGreen = "#42f56c";
        footer.style.borderTopColor = neonGreen;
        footer.style.boxShadow = `0 -10px 30px rgba(66, 245, 108, 0.15)`;
        if (msgText) {
          msgText.style.color = neonGreen;
          msgText.style.textShadow = `0 0 10px rgba(66, 245, 108, 0.3)`;
        }
      } else {
        const cyanBlue = "#00e5ff";
        footer.style.borderTopColor = "#333";
        footer.style.boxShadow = "none";
        if (msgText) {
          msgText.style.color = cyanBlue;
          msgText.style.textShadow = `0 0 10px rgba(0, 229, 255, 0.2)`;
        }
      }
    } else {
      footer.style.display = "none";
    }
  }

  // Tema de la tarjeta
  const card = document.getElementById("main-card");
  if (card) {
    card.classList.remove(
      "theme-relic",
      "theme-set",
      "theme-riven",
      "theme-profile",
      "theme-lfg"
    );
    card.classList.add("theme-" + mode);
  }

  if (mode === "lfg") updateLFGUI();
  else generateMessage();
}

export function changeLanguage() {
  if (!state.currentLang) state.currentLang = "es";
  saveAppState();
  updateLangButtonVisuals(state.currentLang);
  const t = TEXTS[state.currentLang];

  // Helper para asignar texto de forma segura
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  // Helper para las pestañas
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

  setText("tab-relic-text", t.menuRelic || "Reliquia");
  setText("lbl-relic-name", t.lblRelic);

  const relicInput = document.getElementById("relicInput");
  if (relicInput) relicInput.placeholder = t.phRelic;

  setText("lbl-missing", t.lblMiss);
  setText("lbl-profit", t.lblProfit);
  setText("lbl-content", t.lblContent);

  setText("tab-set-text", t.menuSet || "Set");
  setText("lbl-search-item", t.lblItem);

  const setInput = document.getElementById("setItemInput");
  if (setInput) setInput.placeholder = t.phItem;

  setText("tab-riven-text", t.menuRiven || "Riven");
  setText("lbl-riven-weapon", t.lblRivenW);

  const rivenInput = document.getElementById("rivenWeaponInput");
  if (rivenInput) rivenInput.placeholder = t.phRivenW;

  setText("lbl-riven-stats", t.lblRivenS);
  setText("btn-riven-search", t.rivenSearch);

  const statNegOpt = document.querySelector('#rivenStatNeg option[value=""]');
  if (statNegOpt) statNegOpt.innerText = t.lblRivenNeg;

  setText("tab-profile-text", t.menuProfile || "Perfil");
  setText("lbl-username", t.lblUser);

  const btnCheck = document.querySelector("#mode-profile button");
  if (btnCheck) btnCheck.innerText = t.btnCheck;

  setText("txt-mr-label", t.lblMrCalc);

  setText("tab-lfg-text", t.menuLfg || "LFG");
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

  const panelHeader = document.querySelector(".panel-main-header");
  if (panelHeader) {
    const textSpan = panelHeader.querySelector("span");
    if (textSpan) {
      textSpan.innerText =
        t.panelFissures || t.lblRecommended || "Fisuras Activas";
    }
  }

  const lfgItems = document.querySelectorAll("#lfgDropdown .dropdown-item");
  const keys = [
    "eidolon",
    "profit",
    "eda",
    "netra",
    "temporal",
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

  const tier = document.getElementById("relicInput").value.split(" ")[0];
  if (tier && state.selectedRelic) {
    updateRecommendedMissions(tier);
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
  const t = TEXTS[state.currentLang];
  const defaultText = t.defaultRelic;
  let rName = state.selectedRelic || defaultText;
  rName = rName.trim();

  const refVal = document.getElementById("refinement").value;
  const refText =
    document.querySelector(`#refinement option[value="${refVal}"]`)
      ?.innerText || refVal;

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
    msgBox.innerText = fullMessage;
    msgBox.style.animation = "none";
    msgBox.offsetHeight; // trigger reflow
    msgBox.style.animation = "pulse 0.3s ease";
  }

  updateRelicTotal();
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

    // Actualizar misiones recomendadas si hay reliquia
    const tier = state.selectedRelic.split(" ")[0];
    updateRecommendedMissions(tier).catch((err) =>
      console.error("Error misiones:", err)
    );

    generateMessage();

    const listDiv = document.getElementById("relic-drops-list");
    const profitDisplay = document.getElementById("relic-profit-display");
    const container = document.getElementById("relic-contents");

    if (!listDiv || !profitDisplay || !container) return;

    listDiv.innerHTML = "";
    profitDisplay.innerText = "...";
    profitDisplay.classList.add("loading");

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");

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

        // Determinar rareza y colores de una sola vez
        let rarityLabel = abbr.common;
        let rarityColor = "var(--wf-common)";

        if (item.chance <= 5) {
          rarityLabel = abbr.rare;
          rarityColor = "var(--wf-rare)";
        } else if (item.chance <= 22) {
          rarityLabel = abbr.uncommon;
          rarityColor = "var(--wf-uncommon)";
        }

        if (isUntradable) rarityColor = "var(--wf-forma)";

        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        let nameDisplay;
        if (isUntradable) {
          nameDisplay = `<span style="font-weight:bold; color:var(--wf-forma);">${item.name.replace(
            "Blueprint",
            "BP"
          )}</span>`;
        } else {
          nameDisplay = `<span class="item-interactive" style="cursor:pointer; text-decoration:underline; margin-right:5px;" onclick="window.findRelicsForItem('${
            item.name
          }')">${item.name}</span> 
             <a href="https://warframe.market/items/${getSlug(
               item.name
             )}" target="_blank" class="market-link-icon" style="text-decoration:none">↗</a>`;
        }

        const badgeContent = isUntradable
          ? '0<span style="font-size:0.7em">pl</span>'
          : "...";
        const badgeClass = isUntradable
          ? "price-badge forma"
          : "price-badge loading";

        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="color:${rarityColor}; font-weight:bold; font-size:0.8em; width:25px;">${rarityLabel}</span>
                <span style="color:${
                  isUntradable ? "#aaa" : "#eee"
                }; font-size:0.9em;">${nameDisplay}</span>
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
          // addToQueue importado al inicio
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
  const rates = DROP_CHANCES[refinement] || DROP_CHANCES.Intact;

  const itemsWithProb = items.map((item) => {
    let prob = rates.common / 3;
    if (item.rarityType === "rare") prob = rates.rare / 1;
    else if (item.rarityType === "uncommon") prob = rates.uncommon / 2;
    return { price: item.price, prob: prob };
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

// --- SETS & TRACKER ---
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

        btn.className = `relic-chip ${rc}`;
        btn.innerHTML = `<div class="relic-chip-header"><span class="relic-name">${
          info.relic
        }</span><img src="${
          TIER_URLS[tier] || TIER_URLS.Lith
        }" class="relic-img"></div><div class="chip-footer"><span class="rarity-text ${rc}">${rl}</span><span class="status-badge ${stKey}">${stTxt}</span></div>`;

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
  const t = TEXTS[state.currentLang];

  if (!state.currentActiveSet) {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  document.getElementById(
    "tracker-title"
  ).innerText = `${t.trackerTitle}: ${state.currentActiveSet}`;
  list.innerHTML = "";

  state.activeSetParts.forEach((partName) => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "5px";

    const isDone = state.completedParts.has(partName);
    const row = document.createElement("div");
    row.className = `tracker-item ${isDone ? "done" : ""}`;
    row.style.marginBottom = "0";

    const nameText =
      partName === state.currentActiveSet
        ? "Blueprint"
        : partName.replace(state.currentActiveSet, "").trim();

    const nameSpan = document.createElement("span");
    nameSpan.className = "t-name item-interactive";
    nameSpan.innerText = nameText;
    nameSpan.style.cursor = "pointer";
    nameSpan.style.textDecoration = "underline dotted #666";

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
    drawer.style.background = "rgba(0, 0, 0, 0.3)";
    drawer.style.border = "1px solid #333";
    drawer.style.borderTop = "none";
    drawer.style.borderRadius = "0 0 4px 4px";
    drawer.style.overflow = "hidden";
    drawer.style.transition = "all 0.3s ease";

    nameSpan.onclick = (e) => {
      e.stopPropagation();
      const isCurrentlyClosed = drawer.classList.contains("hidden");
      document
        .querySelectorAll(".tracker-drawer")
        .forEach((d) => d.classList.add("hidden"));
      if (isCurrentlyClosed) {
        drawer.classList.remove("hidden");
        if (drawer.innerHTML === "") {
          renderRelicsForPartInline(partName, drawer);
        }
      }
    };

    wrapper.appendChild(row);
    wrapper.appendChild(drawer);
    list.appendChild(wrapper);
  });
}

// --- RIVEN UI ---
export function handleRivenInput() {
  const input = document.getElementById("rivenWeaponInput");
  const val = input.value.toUpperCase().trim();
  const dropdown = document.getElementById("rivenDropdown");
  const statsBox = document.getElementById("riven-avg-box");

  saveAppState();

  if (val.length < 1) {
    dropdown.classList.add("hidden");
    if (statsBox) statsBox.style.display = "none";
    return;
  }

  const matches = state.allRivenNames
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
        input.value = name;
        dropdown.classList.add("hidden");
        fetchRivenAverage(name);
      };
      dropdown.appendChild(item);
    });
  } else dropdown.classList.add("hidden");

  if (state.weaponMap[input.value]) {
    dropdown.classList.add("hidden");
    fetchRivenAverage(input.value);
  }
}

export function populateRivenSelects() {
  const selects = document.querySelectorAll(".riven-stat-select");
  const isSpan = state.currentLang === "es";
  selects.forEach((sel) => {
    while (sel.options.length > 1) sel.remove(1);
    RIVEN_STATS.forEach((stat) => {
      let opt = document.createElement("option");
      opt.value = stat.slug;
      opt.innerText = isSpan ? stat.name_es : stat.name_en;
      sel.appendChild(opt);
    });
  });
}

// --- LFG UI ---
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

export async function updateRecommendedMissions(tier) {
  const listArea = document.getElementById("fissures-list-area");
  if (!listArea || listArea.children.length === 0) {
    await initFissurePanel();
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
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "global-tooltip";
    tooltipEl.className = "global-tooltip hidden";
    document.body.appendChild(tooltipEl);
  }

  const showTooltip = (e, text) => {
    if (!text) return;

    tooltipEl.innerText = text;
    tooltipEl.classList.remove("hidden");

    const padding = 10;
    const tipWidth = tooltipEl.offsetWidth;
    const tipHeight = tooltipEl.offsetHeight;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let left = e.clientX + padding;
    let top = e.clientY + padding;

    if (left + tipWidth > screenWidth) {
      left = e.clientX - tipWidth - padding;
    }

    if (top + tipHeight > screenHeight) {
      top = e.clientY - tipHeight - padding;
    }

    if (left < 0) left = 10;

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  const hideTooltip = () => {
    tooltipEl.classList.add("hidden");
  };

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) {
      showTooltip(e, target.getAttribute("data-tooltip"));
    }
  });

  document.addEventListener("mousemove", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target && !tooltipEl.classList.contains("hidden")) {
      showTooltip(e, target.getAttribute("data-tooltip"));
    }
  });

  document.addEventListener("mouseout", (e) => {
    hideTooltip();
  });

  document.addEventListener("touchstart", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) {
      const touch = e.touches[0];
      showTooltip(
        { clientX: touch.clientX, clientY: touch.clientY },
        target.getAttribute("data-tooltip")
      );
    } else {
      hideTooltip();
    }
  });
}
export function openRivenMarket() {
  const inputVal = document.getElementById("rivenWeaponInput").value.trim();
  if (!inputVal) return alert("Por favor introduce un nombre de arma");

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

export function getRivenSlug(inputVal) {
  const validWeapons = state.allRivenNames || [];
  let fullSlug = inputVal.toLowerCase().trim().replace(/\s+/g, "_");
  let nakedSlug = getNakedName(fullSlug);

  if (nakedSlug === fullSlug) return fullSlug;

  const baseExists = validWeapons.some(
    (name) => name.toLowerCase().replace(/\s+/g, "_") === nakedSlug
  );

  return baseExists ? nakedSlug : fullSlug;
}

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

//--- LANGUAGE SELECTION UI ---
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

  // Agrupar misiones
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

  // Normalizar Vanguard a Axi para propósitos visuales
  const normalizedTier = tierKey === "vanguard" ? "axi" : tierKey;

  const panel = document.getElementById("best-missions-container");
  if (panel && !panel.classList.contains("open")) {
    panel.classList.add("open");
  }

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
  // Evitar duplicados
  if (document.getElementById("cloud-sync-container")) return;

  const t = TEXTS[state.currentLang];

  // Crear contenedor principal (Panel lateral)
  const syncDiv = document.createElement("div");
  syncDiv.id = "cloud-sync-container";
  syncDiv.className = "side-panel-container"; // Clase compartida o nueva

  // HTML Interno
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

  // Iniciar por defecto en recibir si es escritorio, enviar si es móvil (opcional)
  // Por ahora defecto: Recibir
  startReceiver();
}

// Abrir/Cerrar Panel
window.toggleSyncPanel = function () {
  const panel = document.getElementById("cloud-sync-container");
  panel.classList.toggle("open");

  // Si se cierra, paramos el polling para ahorrar recursos
  if (!panel.classList.contains("open")) {
    stopReceiver();
  } else {
    // Si se abre y estamos en pestaña recibir, reiniciamos
    if (
      document.getElementById("panel-receive").classList.contains("active") ||
      !document.getElementById("panel-send").classList.contains("active")
    ) {
      switchSyncTab("receive");
    }
  }
};

// Cambiar Pestañas
window.switchSyncTab = function (mode) {
  const t = TEXTS[state.currentLang];

  // UI Updates
  document
    .querySelectorAll(".sync-tab")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(`tab-sync-${mode}`).classList.add("active");

  document
    .querySelectorAll(".sync-pane")
    .forEach((p) => p.classList.add("hidden"));
  document.getElementById(`panel-${mode}`).classList.remove("hidden");

  // Logic Updates
  if (mode === "receive") {
    startReceiver();
  } else {
    stopReceiver();
  }
};

// --- LÓGICA INTERNA ---

function stopReceiver() {
  if (syncInterval) clearInterval(syncInterval);
  if (timeoutTimer) clearTimeout(timeoutTimer); // Limpiamos el timeout también
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
        stopReceiver(); // <--- CORTAMOS LAS LLAMADAS AL INSTANTE
        statusMsg.innerHTML = `<span style="color:#ff4444"> Demasiados intentos. Espera 1 min.</span>`;
        return;
      }
      if (!res.ok) {
        // Si falla por otra cosa (ej: Cuota KV llena - Error 500)
        stopReceiver();
        statusMsg.innerHTML = `<span style="color:#ff4444"> Error del servidor. Intenta más tarde.</span>`;
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
/* ui.js - Funcionalidad de Presets LFG */

// Inyectar el contenedor de presets en el HTML si no existe
export function initLFGPresets() {
  const lfgContainer = document.getElementById("mode-lfg");
  if (!lfgContainer || document.getElementById("lfg-presets-area")) return;

  // Creamos el área de presets justo después del selector de actividad
  const presetArea = document.createElement("div");
  presetArea.id = "lfg-presets-area";
  presetArea.className = "lfg-presets-container";

  // Insertar después del div .form-group del selector
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

  // Capturar estado actual
  const activity = document.getElementById("lfgActivity").value;
  const extra = document.getElementById("lfgExtra").value;
  const count = state.lfgCount;

  // Capturar roles (checkboxes)
  const roles = Array.from(document.querySelectorAll(".lfg-role:checked")).map(
    (c) => c.value
  );

  // Capturar selects específicos (Runs, Tipos, Elite checkbox)
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

  // 1. Setear actividad y regenerar UI base
  document.getElementById("lfgActivity").value = p.activity;

  // Actualizar texto del selector personalizado
  const t = TEXTS[state.currentLang];
  const actName = t.lfgOpts[p.activity] || p.activity;
  document.getElementById("lfgSelectedText").innerText = actName;

  // Importante: Llamar a updateLFGUI para que se creen los checkboxes
  updateLFGUI();

  // 2. Restaurar valores específicos
  document.getElementById("lfgExtra").value = p.extra || "";

  // Restaurar Count
  state.lfgCount = p.count || 1;
  document.getElementById("lfgCountDisplay").innerText = state.lfgCount;

  // Restaurar Checkboxes (Roles)
  if (p.roles && p.roles.length > 0) {
    p.roles.forEach((rVal) => {
      // Buscar input por valor
      const chk = document.querySelector(`.lfg-role[value="${rVal}"]`);
      if (chk) chk.checked = true;
    });
  }

  // Restaurar Selects específicos
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

  // 3. Generar mensaje final
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
