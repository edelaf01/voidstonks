import { TEXTS, TIER_URLS, RIVEN_STATS, DROP_CHANCES } from "./config.js";
import { state, saveAppState } from "./state.js";
import { addToQueue, fetchRivenAverage } from "./api.js";

let debounceTimer;

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
  toast.innerText = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 3000);
}
export function finishLoading() {
  document.getElementById("loading").style.display = "none";
  document.getElementById(
    "relicCount"
  ).innerText = `${state.allRelicNames.length} reliquias`;
  document.getElementById("mode-relic").classList.remove("hidden");
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
  const msgText = document.getElementById("finalMessage");
  const copyBtn = document.getElementById("btn-copy");
  const footer = document.getElementById("footer-relic");
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
        if (copyBtn) {
          copyBtn.style.borderColor = neonGreen;
          copyBtn.style.color = neonGreen;
        }
      } else {
        const cyanBlue = "#00e5ff";
        footer.style.borderTopColor = "#333";
        footer.style.boxShadow = "none";

        if (msgText) {
          msgText.style.color = cyanBlue;
          msgText.style.textShadow = `0 0 10px rgba(0, 229, 255, 0.2)`;
        }
        if (copyBtn) {
          copyBtn.style.borderColor = cyanBlue;
          copyBtn.style.color = cyanBlue;
        }
      }
    } else {
      footer.style.display = "none";
    }
  }
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

  document.getElementById("txt-header-title").innerText = t.headerTitle;
  document.getElementById("txt-header-sub").innerText = t.headerSub;
  document.getElementById("txt-footer-data").innerText = t.footerData;
  document.getElementById("txt-contact-label").innerText = t.contactLabel;
  document.getElementById("txt-contact-link").innerText = t.contactLink;
  document.getElementById("txt-disclaimer").innerHTML = t.disclaimer;

  if (document.getElementById("tab-relic-text"))
    document.getElementById("tab-relic-text").innerText =
      t.menuRelic || "Reliquia";

  document.getElementById("lbl-relic-name").innerText = t.lblRelic;
  document.getElementById("relicInput").placeholder = t.phRelic;
  document.getElementById("lbl-missing").innerText = t.lblMiss;
  document.getElementById("lbl-profit").innerText = t.lblProfit;
  document.getElementById("lbl-content").innerText = t.lblContent;

  if (document.getElementById("tab-set-text"))
    document.getElementById("tab-set-text").innerText = t.menuSet || "Set";
  document.getElementById("lbl-search-item").innerText = t.lblItem;
  document.getElementById("setItemInput").placeholder = t.phItem;

  if (document.getElementById("tab-riven-text"))
    document.getElementById("tab-riven-text").innerText =
      t.menuRiven || "Riven";
  document.getElementById("lbl-riven-weapon").innerText = t.lblRivenW;
  document.getElementById("rivenWeaponInput").placeholder = t.phRivenW;
  document.getElementById("lbl-riven-stats").innerText = t.lblRivenS;
  document.getElementById("btn-riven-search").innerText = t.rivenSearch;

  const statNegOpt = document.querySelector('#rivenStatNeg option[value=""]');
  if (statNegOpt) statNegOpt.innerText = t.lblRivenNeg;

  if (document.getElementById("tab-profile-text"))
    document.getElementById("tab-profile-text").innerText =
      t.menuProfile || "Perfil";
  document.getElementById("lbl-username").innerText = t.lblUser;
  document.querySelector("#mode-profile button").innerText = t.btnCheck;
  document.getElementById("txt-mr-label").innerText = t.lblMrCalc;

  if (document.getElementById("tab-lfg-text"))
    document.getElementById("tab-lfg-text").innerText = t.menuLfg || "LFG";
  document.getElementById("lbl-lfg-activity").innerText = t.lblLfgActivity;
  document.getElementById("lbl-lfg-players").innerText = t.lblLfgPlayers;
  document.getElementById("btn-copy").innerText = t.btnCopy;

  const refLabel = document.getElementById("lbl-refinement");
  if (refLabel) {
    refLabel.innerHTML = `${t.lblRef} <span data-tooltip="${t.tooltips.refinement}" style="cursor:help; opacity:0.7"> (?)</span>`;
  }
  const refSelect = document.getElementById("refinement");
  if (refSelect && t.refs) {
    Array.from(refSelect.options).forEach((opt) => {
      const key = opt.value.toLowerCase();
      if (t.refs[key]) {
        opt.innerText = t.refs[key];
      }
    });
  }

  const lfgItems = document.querySelectorAll("#lfgDropdown .dropdown-item");
  const keys = [
    "eidolon",
    "profit",
    "eda",
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
  if (t.lfgOpts[currentVal])
    document.getElementById("lfgSelectedText").innerText =
      t.lfgOpts[currentVal];

  populateRivenSelects();

  if (!document.getElementById("mode-lfg").classList.contains("hidden"))
    updateLFGUI();
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
    msgBox.offsetHeight;
    msgBox.style.animation = "pulse 0.3s ease";
  }

  updateRelicTotal();
}

export function copyText() {
  const textToCopy = document.getElementById("finalMessage").innerText;
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      showToast(TEXTS[state.currentLang].msgCopied);
    })
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
    const tier = state.selectedRelic.split(" ")[0];
    updateRecommendedMissions(tier).catch((err) =>
      console.error("Error misiones:", err)
    );

    state.selectedRelic = document.getElementById("relicInput").value;

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
        let rarityTypeCSS = "common";
        if (item.name === "Forma Blueprint") rarityTypeCSS = "forma";
        else if (item.chance <= 5) rarityTypeCSS = "rare";
        else if (item.chance <= 22) rarityTypeCSS = "uncommon";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const isUntradable =
          item.name.includes("Forma Blueprint") ||
          item.name.includes("Kuva") ||
          item.name === "Riven Sliver" ||
          item.name === "Exilus Weapon Adapter Blueprint";

        let rarityColor = "var(--wf-common)";
        let rarityLabel = abbr.common;

        if (item.chance <= 5) {
          rarityColor = "var(--wf-rare)";
          rarityLabel = abbr.rare;
        } else if (item.chance <= 22) {
          rarityColor = "var(--wf-uncommon)";
          rarityLabel = abbr.uncommon;
        }

        if (isUntradable) rarityColor = "var(--wf-forma)";

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
        )}">${badgeContent}</div>
              `;
        listDiv.appendChild(row);

        const badge = row.querySelector(".price-badge");
        if (!isUntradable) {
          import("./api.js").then((mod) => mod.addToQueue(item.name, badge));
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
    let prob = 0;
    if (item.rarityType === "rare") prob = rates.rare / 1;
    else if (item.rarityType === "uncommon") prob = rates.uncommon / 2;
    else prob = rates.common / 3;
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
  } else if (act === "eda") {
    container.innerHTML = `
            ${createInfo(tips.eda)}
            <label class="lfg-checkbox-wrapper" style="margin-bottom:10px;">
                <input type="checkbox" id="lfg-eda-elite" checked onchange="generateLFGMessage()"> 
                <span class="lfg-label">${roles.elite}</span>
            </label>`;
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

export function generateLFGMessage() {
  const act = document.getElementById("lfgActivity").value;
  const extra = document.getElementById("lfgExtra").value.trim();
  let msg = `H ${act.toUpperCase()}`;

  if (act === "eidolon") {
    const runs = document.getElementById("lfg-eidolon-runs").value;
    msg = `H Eidolon ${runs}`;
    const roles = Array.from(
      document.querySelectorAll(".lfg-role:checked")
    ).map((c) => c.value);
    if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
  } else if (act === "eda") {
    msg = `H ${
      document.getElementById("lfg-eda-elite").checked ? "Elite " : ""
    }Deep Archimedea`;
  } else if (act === "profit") {
    msg = `H Profit Taker`;
    const roles = Array.from(
      document.querySelectorAll(".lfg-role:checked")
    ).map((c) => c.value);
    if (roles.length > 0) msg += ` LF ${roles.join("/")}`;
  }

  if (extra) msg += ` ${extra}`;
  msg += ` ${state.lfgCount}/4`;
  const box = document.getElementById("finalMessage");
  if (box) box.innerText = msg;
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
  const container = document.getElementById("relic-contents");
  let missionDiv = document.getElementById("best-missions-container");

  if (!missionDiv) {
    missionDiv = document.createElement("div");
    missionDiv.id = "best-missions-container";
    missionDiv.className = "mission-recommendation-box";
    document.body.appendChild(missionDiv);
  }

  const t = TEXTS[state.currentLang];
  const { fetchBestFissures } = await import("./api.js");
  const allMissions = await fetchBestFissures();

  let searchTier = tier;
  if (searchTier.toLowerCase() === "vanguard") searchTier = "Axi";

  const matches = allMissions.filter((m) => {
    const isTargetTier = m.tier.toLowerCase() === searchTier.toLowerCase();
    const isOmniaCompatible =
      m.isOmnia && searchTier.toLowerCase() !== "requiem";
    return isTargetTier || isOmniaCompatible;
  });

  if (matches.length > 0) {
    const normal = matches.filter((m) => !m.isSP);
    const steelPath = matches.filter((m) => m.isSP);

    let html = `<div id="mission-toggle-btn" class="mission-toggle-btn">
                    <img src="assets/fissureicon.png" class="toggle-img" alt="Fisuras">
                  </div>`;

    html += `<div class="mission-header">${t.lblRecommended} ${searchTier}</div>`;

    if (normal.length > 0) {
      html += `<div class="mission-sub-tier">Normal</div>`;
      normal.forEach((m) => (html += renderMissionRow(m)));
    }

    if (steelPath.length > 0) {
      html += `<div class="mission-sub-tier sp" data-tooltip="${t.tooltips.steelPath}">Steel Path (?)</div>`;
      steelPath.forEach((m) => (html += renderMissionRow(m)));
    }

    missionDiv.innerHTML = html;

    missionDiv.style.display = "block";

    const btn = document.getElementById("mission-toggle-btn");
    if (btn) {
      btn.onclick = () => {
        missionDiv.classList.toggle("open");
      };
    }
  } else {
    missionDiv.style.display = "none";
  }
}
function renderMissionRow(m) {
  const t = TEXTS[state.currentLang];
  const rawType = m.type.toLowerCase();
  const translatedType = t.modes[rawType] || m.type;
  const omniaTag = m.isOmnia
    ? `<span class="omnia-tag big" data-tooltip="${t.tooltips.omnia}">OMNIA</span>`
    : "";

  return `
        <div class="mission-item ${m.isSP ? "sp-row" : ""}">
            <div class="m-info">
                <span class="m-type">${translatedType} ${omniaTag}</span>
                <span class="m-node">${m.node}</span>
            </div>
            <div class="m-timer-box">
                <span class="m-eta">${m.eta}</span>
            </div>
        </div>
    `;
}

/*export function fixTooltipClipping() {
  document.body.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    if (rect.bottom > viewportHeight * 0.6) {
      target.classList.add("tip-top");
    } else {
      target.classList.remove("tip-top");
    }
  });
}*/
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

  console.log("Abriendo URL generada:", url);
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

  if (baseExists) {
    return nakedSlug;
  }
  return fullSlug;
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

    if (itemName.includes("Prime")) {
      searchTerm = itemName.split("Prime")[0].trim() + " Prime";
    } else if (itemName.includes("Vandal")) {
      searchTerm = itemName.split("Vandal")[0].trim() + " Vandal";
    } else if (itemName.includes("Wraith")) {
      searchTerm = itemName.split("Wraith")[0].trim() + " Wraith";
    } else {
      searchTerm = itemName.replace("Blueprint", "").trim();
    }

    setInput.value = searchTerm;

    import("./ui.js").then((mod) => {
      mod.switchTab("set");

      setInput.focus();
      const event = new Event("keyup");
      setInput.dispatchEvent(event);
    });
  }
};
//--- LANGUAGE SELECTION UI ---
export function toggleLangDropdown() {
  const list = document.getElementById("langOptionsList");
  if (list) list.classList.toggle("hidden");
}

export function setLanguageManual(langCode) {
  const langSelect = document.getElementById("langSelect");
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
    img.src = "https://flagcdn.com/24x18/gb.png"; // GB para UK
    txt.innerText = "EN";
  }
}
