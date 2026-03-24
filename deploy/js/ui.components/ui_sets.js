import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { addToQueue, getSlug } from "../api.js";
import { escapeHTML, showToast } from "./ui_components.js";
import { manualRelicUpdate } from "./ui_relics.js";

import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
} from "./ui_utils.js";
let debounceTimer;

export function handleSetTyping() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(searchSet, 1200);
}

export function searchSet() {
  const query = document
    .getElementById("setItemInput")
    .value.toLowerCase()
    .trim();
  const container = document.getElementById("setResults");
  if (!container) return;
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
    container.innerHTML = `<div style="text-align:center;color:#666;margin-top:20px">${TEXTS[state.currentLang].notFound}</div>`;
    return;
  }

  Object.keys(groups)
    .sort()
    .forEach((setName) =>
      createSetCard(setName, groups[setName], container, false),
    );
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
    : `<a href="https://warframe.market/items/${getSlug(title + " Set")}" target="_blank" class="market-link">${escapeHTML(title)} SET<span class="link-icon">↗</span></a>`;

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

    const requiredCount = getRequiredCount(title, itemName);
    const partIcon = getItemIcon(itemName);
    const ducatVal = relicsInfo.length > 0 ? relicsInfo[0].ducats : 0;

    row.innerHTML = `
      <div class="component-header">
        <div class="name-row-content">
          ${partIcon ? `<img src="${partIcon}" class="item-icon-mini" loading="lazy">` : ""}
          <div class="name-column">
            <span class="component-name">${escapeHTML(dispName)}${requiredCount > 1 ? ` <span class="required-count">x${requiredCount}</span>` : ""}</span>
            ${generateDotsHtml(state.primeInventory[itemName] || 0, requiredCount)}
          </div>
          <div class="actions-col-wrapper">
            <a href="https://warframe.market/items/${getSlug(itemName)}" target="_blank" class="market-btn-mini">MARKET</a>
            <button class="mini-action-btn" data-action="modify-prime-part" data-part="${escapeHTML(itemName)}" data-amount="1">+1</button>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
        <span class="ducat-val">${ducatVal} <span>d</span></span>
        <div class="price-badge-wrapper" style="min-width:45px; display:flex; justify-content:flex-end;"></div>
      </div>`;

    row.querySelector(".price-badge-wrapper").appendChild(priceSpan);
    itemWrapper.appendChild(row);

    if (relicsInfo.length > 0) {
      const grid = document.createElement("div");
      grid.className = "relic-grid";
      relicsInfo
        .sort((a, b) => a.relic.localeCompare(b.relic))
        .forEach((info) => {
          const btn = document.createElement("div");
          let rc =
            info.chance <= 5
              ? "rare"
              : info.chance <= 22
                ? "uncommon"
                : "common";
          btn.className = `relic-chip ${rc}`;
          btn.innerHTML = `<span class="relic-name">${escapeHTML(info.relic)}</span>`;
          btn.onclick = (e) => {
            e.stopPropagation();
            activateSetTracker(title, itemNames);
            state.selectedRelic = info.relic;
            document.getElementById("relicInput").value = info.relic;
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

export function activateSetTracker(setName, itemsInSet) {
  state.currentActiveSet = setName;
  state.activeSetParts = itemsInSet;
  renderSetTracker();
}

export function renderSetTracker() {
  const container = document.getElementById("set-tracker");
  const list = document.getElementById("tracker-list");
  const title = document.getElementById("tracker-title");
  if (!container || !state.currentActiveSet) return;

  container.style.display = "block";
  list.innerHTML = "";
  title.innerHTML = `${TEXTS[state.currentLang].trackerTitle}: <a href="https://warframe.market/items/${getSlug(state.currentActiveSet + " Set")}" target="_blank" class="set-header-link">${state.currentActiveSet} ↗</a>`;

  state.activeSetParts.forEach((partName) => {
    const owned = state.primeInventory[partName] || 0;
    const req = getRequiredCount(state.currentActiveSet, partName);
    const row = document.createElement("div");
    row.className = `tracker-item ${owned >= req ? "done" : ""}`;
    row.innerHTML = `<span class="t-name">${escapeHTML(partName.replace(state.currentActiveSet, "").trim() || "Blueprint")}</span>
                     ${generateDotsHtml(owned, req)}`;
    list.appendChild(row);
  });
}

// CRITICAL: Exponer funciones para el HTML
Object.assign(globalThis, {
  handleSetTyping,
  renderSetTracker,
  activateSetTracker,
  openSetFromRelicReward: (partName) => {
    const setName = getSetName(partName);
    if (setName === "Otros") return;
    switchTab("set");
    const input = document.getElementById("setItemInput");
    if (input) {
      input.value = setName;
      searchSet();
    }
    const allParts = Object.keys(state.itemsDatabase).filter(
      (n) =>
        (n === setName || n.startsWith(setName + " ")) && !n.endsWith(" Set"),
    );
    if (allParts.length > 0) {
      activateSetTracker(setName, allParts);
      showToast(`Tracking ${setName} Set`);
    }
  },
});
