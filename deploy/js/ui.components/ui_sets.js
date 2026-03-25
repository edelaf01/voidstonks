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
  calculateTotalFullSets
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

  header.innerHTML = `<div style="display:flex; align-items:center;">${setIconHtml} ${titleHTML}</div>`;
  const headerProgressHtml = !isSingle ? `<div class="macro-tracker" data-set="${escapeHTML(title)}" style="display:flex; align-items:center;"></div>` : "";

  const rightWrapper = document.createElement("div");
  rightWrapper.style.display = "flex";
  rightWrapper.style.alignItems = "center";
  rightWrapper.style.gap = "12px";

  if (headerProgressHtml) {
    const progressDiv = document.createElement("div");
    progressDiv.innerHTML = headerProgressHtml;
    // ensure the contents align properly
    progressDiv.style.display = "flex";
    progressDiv.style.alignItems = "center";
    rightWrapper.appendChild(progressDiv);
  }

  if (!isSingle) {
    const setPrice = document.createElement("span");
    setPrice.className = "price-badge loading";
    setPrice.innerText = "...";
    rightWrapper.appendChild(setPrice);
    addToQueue(title + " Set", setPrice);
  }

  header.appendChild(rightWrapper);
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
      ${partIcon ? `<img src="${partIcon}" class="item-icon-mini" loading="lazy" onerror="this.style.display='none'">` : ""}
      <div class="name-column">
        <span class="component-name">${escapeHTML(dispName)}${requiredCount > 1 ? ` <span class="required-count">x${requiredCount}</span>` : ""}</span>
        <div class="live-tracker" data-part="${escapeHTML(itemName)}" data-req="${requiredCount}">
           ${generateDotsHtml(state.primeInventory[itemName] || 0, requiredCount)}
        </div>
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
    <span class="ducat-val" style="color:var(--wf-gold-text); font-size:0.85em; font-weight:bold;">${ducatVal} <img src="assets/Ducats.webp" class="ducat-icon"></span>
    <div class="price-badge-wrapper" style="min-width:45px; display:flex; justify-content:flex-end;"></div>
  </div>`;

    row.querySelector(".price-badge-wrapper").appendChild(priceSpan);
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

        let tooltipAttr = `data-tooltip-relic="${info.relic}"`;


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
          if (refSelect) {
            if (rc === "rare" || rc === "uncommon") refSelect.value = "Rad";
            else refSelect.value = "Intact";
          }

          if (globalThis.switchTab) globalThis.switchTab("relic");
          if (globalThis.manualRelicUpdate) globalThis.manualRelicUpdate();
        };
        grid.appendChild(btn);
      });
      itemWrapper.appendChild(grid);
    }
    setContainer.appendChild(itemWrapper);
  });
  parent.appendChild(setContainer);

  if (!isSingle) {
    // Populate the newly injected macro-tracker
    requestAnimationFrame(() => updateMacroTracker(title));
  }
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
  const t = TEXTS[state.currentLang];

  if (!state.currentActiveSet) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  list.innerHTML = "";

  const setSlug = getSlug(state.currentActiveSet + " Set");
  const setUrl = `https://warframe.market/items/${setSlug}`;

  const setIcon = getItemIcon(state.currentActiveSet + " Set") || "";
  const setIconHtml = setIcon
    ? `<img src="${setIcon}" style="width:36px; height:36px; object-fit:contain; filter:drop-shadow(0 0 5px rgba(200,150,50,0.5));">`
    : "";

  const totalFullSets = calculateTotalFullSets(state.currentActiveSet);

  const badgeColor = totalFullSets > 0 ? "var(--wf-gold-text)" : "#666";
  const badgeBg = totalFullSets > 0 ? "rgba(221,169,56,0.15)" : "rgba(100,100,100,0.1)";
  const badgeBorder = totalFullSets > 0 ? "rgba(221,169,56,0.3)" : "rgba(100,100,100,0.2)";
  const setBadge = `<span style="color:${badgeColor}; margin-left:auto; font-weight:bold; font-size:0.85em; background:${badgeBg}; border:1px solid ${badgeBorder}; padding:2px 6px; border-radius:4px; text-transform:uppercase; white-space:nowrap; text-align:center;">(${totalFullSets} Sets)</span>`;

  title.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; line-height:1; width:100%;">
      <span data-tooltip="${t.tooltipTracker}" style="color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:800; font-size:0.75em; cursor:help;">${t.trackerTitle}:</span> 
      ${setIconHtml}
      <a href="${setUrl}" target="_blank" class="set-header-link" style="display:flex; align-items:center; gap:4px; text-decoration:none;">
        <span style="font-weight:bold; font-size:1.1em; color:var(--wf-gold-text); filter:drop-shadow(0 2px 4px rgba(221,169,56,0.3));">${state.currentActiveSet}</span>
        <span style="font-size:1.0em; opacity:0.8; color:var(--wf-gold-text);">↗</span>
      </a>
      ${setBadge}
    </div>
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

    const row = document.createElement("div");
    row.className = "tracker-item";

    const nameText =
      partName === state.currentActiveSet
        ? "Blueprint"
        : partName.replaceAll(state.currentActiveSet, "").trim();

    const partSlug = getSlug(partName);
    const partIcon = getItemIcon(partName) || "";
    const imgWrapper = document.createElement("div");
    imgWrapper.style.display = "flex";
    imgWrapper.style.alignItems = "center";
    imgWrapper.style.justifyContent = "center";
    imgWrapper.style.width = "28px";
    imgWrapper.style.height = "28px";
    
    if (partIcon) {
      const imgEl = document.createElement("img");
      imgEl.src = partIcon;
      imgEl.className = "item-icon-small";
      imgEl.style.width = "100%";
      imgEl.style.height = "100%";
      imgEl.style.objectFit = "contain";
      
      let hoverTimer;
      imgEl.onmouseenter = () => {
        row.style.zIndex = "10";
        hoverTimer = setTimeout(() => {
          const drawer = row.nextElementSibling;
          if (drawer && drawer.classList.contains("hidden")) {
            row.click();
          }
        }, 500);
      };
      imgEl.onmouseleave = () => {
        row.style.zIndex = "1";
        clearTimeout(hoverTimer);
      };
      imgWrapper.appendChild(imgEl);
    }

    row.style.display = "flex";
    row.style.position = "relative";
    row.style.zIndex = "1";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";
    row.style.width = "100%";

    const nameSpan = document.createElement("span");
    nameSpan.className = "t-name";
    nameSpan.style.flex = "1";
    nameSpan.style.whiteSpace = "nowrap";
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    nameSpan.style.minWidth = "0";
    nameSpan.title = nameText;
    nameSpan.innerText = nameText;

    const arrowLink = document.createElement("a");
    arrowLink.href = `https://warframe.market/items/${partSlug}`;
    arrowLink.target = "_blank";
    arrowLink.className = "market-link-icon";
    arrowLink.innerText = "↗";
    arrowLink.style.flexShrink = "0";
    arrowLink.onclick = (e) => e.stopPropagation();

    const dotsDiv = document.createElement("div");
    dotsDiv.style.display = "flex";
    dotsDiv.style.alignItems = "center";
    dotsDiv.style.flexShrink = "0";
    dotsDiv.style.width = "115px"; 
    dotsDiv.style.justifyContent = "flex-end";
    dotsDiv.innerHTML = generateDotsHtml(ownedCount, requiredCount);

    const ducatsSpan = document.createElement("span");
    ducatsSpan.style.color = "var(--wf-gold-text)";
    ducatsSpan.style.fontSize = "0.8em";
    ducatsSpan.style.fontWeight = "bold";
    ducatsSpan.style.display = "flex";
    ducatsSpan.style.alignItems = "center";
    ducatsSpan.style.justifyContent = "flex-end";
    ducatsSpan.style.flexShrink = "0";
    ducatsSpan.style.width = "45px";
    ducatsSpan.innerHTML = `${state.itemsDatabase[partName] ? state.itemsDatabase[partName][0].ducats : 0}&nbsp;<img src="assets/Ducats.webp" class="ducat-icon" style="width:14px; height:14px; object-fit:contain;">`;

    const controlsDiv = document.createElement("div");
    controlsDiv.style.display = "flex";
    controlsDiv.style.alignItems = "center";
    controlsDiv.style.justifyContent = "space-between";
    controlsDiv.style.flexShrink = "0";
    controlsDiv.style.width = "60px";
    controlsDiv.style.gap = "4px";

    const btnMinus = document.createElement("button");
    btnMinus.className = "t-check";
    btnMinus.style.padding = "2px 8px";
    btnMinus.innerText = "-";
    btnMinus.style.visibility = ownedCount > 0 ? "visible" : "hidden";
    btnMinus.onclick = (e) => {
      e.stopPropagation();
      globalThis.modifyPrimePart(partName, -1);
      if (state.primeInventory[partName] <= 0)
        state.completedParts.delete(partName);
      if (state.primeInventory[partName] < requiredCount)
        state.completedParts.delete(partName);
      renderSetTracker();
    };

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

    controlsDiv.appendChild(btnMinus);
    controlsDiv.appendChild(btnPlus);

    row.appendChild(imgWrapper);
    row.appendChild(nameSpan);
    row.appendChild(arrowLink);
    row.appendChild(dotsDiv);
    row.appendChild(ducatsSpan);
    row.appendChild(controlsDiv);

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

export function updateMacroTracker(setName) {
  const tracker = document.querySelector(`.macro-tracker[data-set="${escapeHTML(setName)}"]`);
  if (!tracker) return;

  const itemNames = Object.keys(state.itemsDatabase).filter((k) => k.toLowerCase().includes(setName.toLowerCase()));

  let totalPartsInSet = 0;
  let uniquePartsOwned = 0;
  let possibleSets = Infinity;
  let setItemOwned = 0;

  itemNames.forEach((itemName) => {
    if (!itemName.includes(setName)) return;
    if (itemName.endsWith(" Set")) {
      setItemOwned = state.primeInventory[itemName] || 0;
      return;
    }
    const requiredCount = getRequiredCount(setName, itemName);
    const owned = state.primeInventory[itemName] || 0;

    totalPartsInSet++;
    if (owned >= requiredCount) {
      uniquePartsOwned++;
      const setsFromThisPart = Math.floor(owned / requiredCount);
      if (setsFromThisPart < possibleSets) possibleSets = setsFromThisPart;
    } else {
      possibleSets = 0;
    }
  });

  if (possibleSets === Infinity) possibleSets = 0;
  const totalFullSets = possibleSets + setItemOwned;

  if (totalPartsInSet > 0) {
    const isSetComplete = uniquePartsOwned >= totalPartsInSet;
    let dotsHtml = `<div class="tracker-dots ${isSetComplete ? "complete" : ""}" style="display: flex; gap: 3px;">`;
    for (let i = 0; i < totalPartsInSet; i++) {
      dotsHtml += `<span class="tracker-dot ${i < uniquePartsOwned ? "filled" : ""}"></span>`;
    }
    dotsHtml += `</div>`;

    const badgeHtml = totalFullSets > 0
      ? `<span style="color:#aaa; font-weight:bold; font-size:0.85em; margin-left:8px;">(${totalFullSets} sets)</span>`
      : "";

    tracker.innerHTML = `${dotsHtml}${badgeHtml}`;
  }
}

// CRITICAL: Exponer funciones para el HTML
Object.assign(globalThis, {
  handleSetTyping,
  searchSet,
  updateMacroTracker,
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
      import("./ui_components.js").then(m => m.showToast(`Tracking ${setName} Set`));
    }
  },
});

setTimeout(() => {
  const trackerContainer = document.getElementById("set-tracker");
  if (trackerContainer && !trackerContainer.dataset.dndInit) {
    trackerContainer.dataset.dndInit = "true";
    trackerContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      trackerContainer.classList.add("drag-hover");
    });
    trackerContainer.addEventListener("dragleave", (e) => {
      trackerContainer.classList.remove("drag-hover");
    });
    trackerContainer.addEventListener("drop", (e) => {
      e.preventDefault();
      trackerContainer.classList.remove("drag-hover");
      const itemName = e.dataTransfer.getData("text/plain");
      if (itemName) {
        import("./ui_utils.js").then((m) => {
          const setName = m.getSetName(itemName);
          if (setName !== "Otros") {
            const allParts = Object.keys(state.itemsDatabase).filter(
              (n) => (n === setName || n.startsWith(setName + " ")) && !n.endsWith(" Set")
            );
            activateSetTracker(setName, allParts);
            import("./ui_components.js").then(c => c.showToast("Tracking: " + setName));
          }
        });
      }
    });
  }
}, 500);
