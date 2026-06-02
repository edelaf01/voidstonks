import { state, saveAppState, updateInventoryCount } from "../state.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
import { addToQueue, getSlug, getPriceValue, warmupPrices } from "../api.js";
import { escapeHTML, showToast, showCustomConfirm } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
  calculateTotalFullSets,
} from "../utils/ui_utils.js";

import { manualRelicUpdate } from "./ui_relics.js";

const TARGET_SVG_INLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="22" height="22" style="filter:drop-shadow(0 0 2px rgba(0,204,204,0.5));">
  <defs>
    <linearGradient id="miniGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fdf4df"/> <stop offset="100%" stop-color="#c09131"/> </linearGradient>
    <radialGradient id="miniVoid" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#66ffff"/> <stop offset="100%" stop-color="#00cccc"/> </radialGradient>
  </defs>
  <circle cx="18" cy="18" r="17" fill="#010410" stroke="#c09131" stroke-width="0.5"/>
  <circle cx="18" cy="18" r="14" fill="none" stroke="url(#miniGold)" stroke-width="1.5" opacity="0.7"/>
  <circle cx="18" cy="18" r="8" fill="none" stroke="#00cccc" stroke-width="1" opacity="0.8"/>
  <circle cx="18" cy="18" r="2.5" fill="url(#miniVoid)" stroke="#fdf4df" stroke-width="0.5"/>
  <g stroke="#c09131" stroke-width="0.25" opacity="0.5">
    <line x1="18" y1="4" x2="18" y2="32"/>
    <line x1="4" y1="18" x2="32" y2="18"/>
  </g>
  <g transform="translate(19,17) rotate(-45)">
    <path d="M0,2 L-1.5,-2 L0,-1 L1.5,-2 Z" fill="#000" opacity="0.5" transform="translate(1,1)"/>
    <path d="M0,1 L-1,-2 L1,-2 Z" fill="#999"/>
    <rect x="-0.75" y="-7" width="1.5" height="6" rx="0.3" fill="url(#miniGold)"/>
    <path d="M0,-7 L-3,-11 L0,-10 L3,-11 Z" fill="#66ffff" stroke="#fdf4df" stroke-width="0.2"/>
  </g>
</svg>`;


export function toggleInventoryPanel(forceOpen = false) {
  const panel = document.getElementById("inventory-container");
  if (forceOpen) panel.classList.add("open");
  else panel.classList.toggle("open");
  if (panel.classList.contains("open")) {
    if (state.currentInvView === "parts") renderPrimeInventory();
    else renderInventory();
  }
}

export function clearInventory() {
  const isParts = state.currentInvView === "parts";
  const t = TEXTS[state.currentLang];
  const confirmMsg = isParts
    ? t.purgeConfirmParts || "OROKIN PURGE: Delete ALL Prime Inventory?"
    : t.purgeConfirmRelics || "OROKIN PURGE: Delete ALL saved Relics?";

  showCustomConfirm(confirmMsg, () => {
    if (isParts) {
      state.primeInventory = {};
      renderPrimeInventory();
    } else {
      state.inventory = [];
      renderInventory();
    }
    saveAppState();
    showToast("Inventory cleared");
  });
}

let lastInventoryHash = "";
let inventoryPriceUpdateInterval = null;

export async function renderInventory() {
  const list = document.getElementById("inventory-list");
  if (!list) return;

  list.classList.remove("inventory-loading");

  const sortMode = document.getElementById("inv-sort")?.value || "recent";
  const newHash = JSON.stringify(state.inventory) + state.invSearchVal + state.invFilterTier + sortMode + state.currentLang;
  if (newHash === lastInventoryHash && list.children.length > 0) {
    return;
  }
  lastInventoryHash = newHash;

  if (!state.inventory || state.inventory.length === 0) {
    const emptyMsg = TEXTS[state.currentLang]?.inventory?.empty || "Inventory empty";
    list.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = `<div style="padding:40px; text-align:center; color:#00E5FF; font-weight:bold; letter-spacing:1px; animation: pulse 1s infinite alternate;">LOADING INVENTORY...</div>`;

  globalThis.relicRenderId = (globalThis.relicRenderId || 0) + 1;
  const currentRenderId = globalThis.relicRenderId;

  setTimeout(async () => {
    if (globalThis.relicRenderId !== currentRenderId) return;

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

    if (sortMode === "recent") {
      filtered.reverse();
    } else {
      const valueMap = new Map();

      await Promise.all(
        filtered.map(async (item) => {
          const name = typeof item === "string" ? item : item.name;
          const val = await calculateRelicValue(name);
          valueMap.set(name, val);
        }),
      );

      if (globalThis.relicRenderId !== currentRenderId) return;

      filtered.sort((a, b) => {
        const nameA = typeof a === "string" ? a : a.name;
        const nameB = typeof b === "string" ? b : b.name;
        const valA = valueMap.get(nameA);
        const valB = valueMap.get(nameB);

        if (!valA) return 1;
        if (!valB) return -1;

        if (sortMode === "plat_intact") return valB.intact - valA.intact;
        if (sortMode === "plat_rad") return valB.rad - valA.rad;
        if (sortMode === "ducats") return valB.ducats - valA.ducats;
        return 0;
      });
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach((item) => {
      const itemName = typeof item === "string" ? item : item.name;
      const count = item.count || 1;
      const isVaulted = state.relicStatusDB[itemName] === "vaulted";
      const safeId = itemName.replaceAll(/[^a-zA-Z0-9]/g, "");

      const row = document.createElement("div");
      row.className = "inv-row";
      row.dataset.relic = itemName;

      row.innerHTML = `
            <div class="inv-name-group" data-action="select-relic-from-inv" data-relic="${escapeHTML(itemName)}">
                <div class="inv-name">${escapeHTML(itemName)}</div>
                <div class="inv-meta">
                   <span class="relic-status-tag ${isVaulted ? "vaulted" : "active"}">${isVaulted ? (TEXTS[state.currentLang].vaulted || "VAULTED") : (TEXTS[state.currentLang].active || "ACTIVE")}</span>
                   <span id="duc-${safeId}" class="ducat-tag">... <span class="ducat-icon-inline"></span></span>
                </div>
            </div>
            <div class="inv-price-tag">
                <span id="price-${safeId}" class="price-val">...<span class="plat-icon"></span></span>
                <span class="qty-label">x${count}</span>
            </div>
            <div class="inv-qty-controls">
                <button class="inv-btn minus" data-action="modify-inv" data-relic="${escapeHTML(itemName)}" data-amount="-1">−</button>
                <button class="inv-btn plus" data-action="modify-inv" data-relic="${escapeHTML(itemName)}" data-amount="1">+</button>
            </div>
      `;
      fragment.appendChild(row);
    });

    if (globalThis.relicRenderId !== currentRenderId) return;

    list.innerHTML = "";
    list.appendChild(fragment);

    triggerPriceFetch(filtered);
  }, 10);
}

async function triggerPriceFetch(relicList) {
  if (inventoryPriceUpdateInterval) clearInterval(inventoryPriceUpdateInterval);

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
      const safeId = rName.replaceAll(/[^a-zA-Z0-9]/g, "");
      const priceEl = document.getElementById(`price-${safeId}`);
      const ducEl = document.getElementById(`duc-${safeId}`);

      if (!priceEl) continue;

      const stats = await calculateRelicValue(rName);

      if (stats.intact > 0 || attempts > 10) {
        if (priceEl.innerText !== `${stats.intact}p`) {
          priceEl.innerHTML = `${stats.intact}<span class="plat-icon-inline"></span>`;
          priceEl.classList.remove("price-loading");
          priceEl.style.color = "#42f56c";
          setTimeout(() => (priceEl.style.color = ""), 1000);
        }
        if (ducEl) ducEl.innerHTML = `${stats.ducats} <span class="ducat-icon-inline"></span>`;
      }
    }

    if (attempts > 15) {
      clearInterval(inventoryPriceUpdateInterval);
    }
  }, 1000);
}

export function modifyInv(name, amount) {
  const oldLength = state.inventory ? state.inventory.length : 0;
  updateInventoryCount(name, amount);
  saveAppState();

  const safeNameHtml = escapeHTML(name);
  const row = document.querySelector(`.inv-row[data-relic="${safeNameHtml}"]`);

  if (state.inventory.length < oldLength) {
    if (row) row.remove();
    return;
  }

  const itemMatch = state.inventory.find(
    (i) => (typeof i === "string" ? i : i.name) === name
  );

  if (!itemMatch) {
    renderInventory();
    return;
  }

  const newQty = typeof itemMatch === "string" ? 1 : itemMatch.count || itemMatch.qty || 1;

  if (row) {
    const qtySpan = row.querySelector(".qty-label");
    if (qtySpan) qtySpan.textContent = `x${newQty}`;
  } else {
    renderInventory();
  }
}

export function selectRelicFromInv(name) {
  state.selectedRelic = name;
  const input = document.getElementById("relicInput");
  if (input) input.value = name;

  switchTab("relic");
  toggleInventoryPanel(false);
  manualRelicUpdate();
}

async function calculateRelicValue(relicName) {
  const drops = state.relicsDatabase[relicName];
  if (!drops) return { intact: 0, rad: 0, ducats: 0 };

  let totalIntact = 0;
  let totalRad = 0;
  let avgDucats = 0;

  const promises = drops.map(async (d) => {
    const slug = getSlug(d.name);
    const price = await getPriceValue(d.name, slug);

    let fallbackDucats = 15;
    if (d.chance < 5) {
      fallbackDucats = 100;
    } else if (d.chance < 20) {
      fallbackDucats = 45;
    }
    const ducatValue = d.ducats || fallbackDucats;

    let pIntact;
    let pRad;

    if (d.chance < 5) {
      pIntact = DROP_CHANCES.Intact.rare;
      pRad = DROP_CHANCES.Rad.rare;
    } else if (d.chance < 20) {
      pIntact = DROP_CHANCES.Intact.uncommon / 2;
      pRad = DROP_CHANCES.Rad.uncommon / 2;
    } else {
      pIntact = DROP_CHANCES.Intact.common / 3;
      pRad = DROP_CHANCES.Rad.common / 3;
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
    intact: Number.parseFloat(totalIntact.toFixed(1)),
    rad: Number.parseFloat(totalRad.toFixed(1)),
    ducats: Math.round(avgDucats),
  };
}
export function filterInvTier(tier) {
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
}

export function addCurrentToInv() {
  if (!state.selectedRelic) return;

  updateInventoryCount(state.selectedRelic, 1);
  saveAppState();

  const msg =
    state.currentLang === "es"
      ? `${state.selectedRelic} añadida al inventario.`
      : `${state.selectedRelic} added to inventory.`;

  showToast(msg);

  const btn = document.querySelector("#manual-add-container button");
  if (btn) {
    const originalText = btn.innerText;
    btn.innerText = "✔ OK";
    setTimeout(() => {
      btn.innerText = originalText;
    }, 1000);
  }

  renderInventory();
}
export function switchInvView(view) {
  if (state.currentInvView === view && document.getElementById("inventory-list")?.innerHTML.length > 50) return;
  state.currentInvView = view;
  const relicControls = document.getElementById("relic-inv-controls");
  const primeControls = document.getElementById("prime-inv-controls");
  const tabRelics = document.getElementById("inv-tab-relics");
  const tabParts = document.getElementById("inv-tab-parts");

  const listRelics = document.getElementById("inventory-list");
  const listParts = document.getElementById("inventory-list-parts");

  if (view === "relics") {
    if (relicControls) relicControls.style.display = "flex";
    if (primeControls) primeControls.style.display = "none";
    tabRelics.classList.add("active");
    tabParts.classList.remove("active");
    if (listRelics) listRelics.style.display = "";
    if (listParts) listParts.style.display = "none";
    renderInventory();
  } else {
    if (relicControls) relicControls.style.display = "none";
    if (primeControls) primeControls.style.display = "flex";
    tabParts.classList.add("active");
    tabRelics.classList.remove("active");
    if (listRelics) listRelics.style.display = "none";
    if (listParts) listParts.style.display = "";
    renderPrimeInventory();
  }
}

export function modifyPrimePart(name, amount) {
  const current = state.primeInventory[name] || 0;
  const newQty = Math.max(0, current + amount);

  state.primeInventory[name] = newQty;

  if (amount > 0 && current === 0) {
    const setName = getSetName(name);
    const sourceList =
      state.ocrReferenceList || Object.keys(state.itemsDatabase);

    if (setName && sourceList.length > 0) {
      sourceList.forEach((itemName) => {
        if (itemName.startsWith(setName) && !itemName.endsWith(" Set")) {
          if (state.primeInventory[itemName] === undefined) {
            state.primeInventory[itemName] = 0;
          }
        }
      });
    }
  }

  saveAppState();

  const safePartHtml = escapeHTML(name);
  const qtySpans = document.querySelectorAll(
    `.inv-btn-small[data-part="${safePartHtml}"] ~ .qty-num, .qty-num[data-part="${safePartHtml}"]`
  );
  qtySpans.forEach(span => {
    span.textContent = newQty;
    span.classList.remove("pulse-anim");
    // span.offsetWidth; // trigger reflow
    span.classList.add("pulse-anim");
  });

  const safeId = name.replaceAll(/[^a-zA-Z0-9]/g, "");
  const badge = document.getElementById(`price-p-${safeId}`);
  if (badge) badge.dataset.qty = newQty;

  setTimeout(updatePrimeTotalValue, 10);
  requestAnimationFrame(() => {
    const trackers = document.querySelectorAll(`.live-tracker[data-part="${safePartHtml}"]`);
    trackers.forEach(t => {
      const required = Number.parseInt(t.dataset.req) || 1;
      t.innerHTML = generateDotsHtml(newQty, required);
    });
    const setName = getSetName(name);
    if (setName && setName !== "Otros") {
      const safeSetNameId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

      if (typeof calculateTotalFullSets === "function") {
        const fullSets = calculateTotalFullSets(setName);
        const setBadge = document.querySelector(`#set-group-${safeSetNameId} .set-count-badge`);
        if (setBadge) {
          setBadge.innerHTML = `${fullSets} ${fullSets === 1 ? 'SET' : 'SETS'}`;
          setBadge.style.display = fullSets > 0 ? "inline-block" : "none";
        }
      }

      if (state.activeTab === "set" && typeof globalThis.updateMacroTracker === "function") {
        globalThis.updateMacroTracker(setName);
      }

      if (state.currentActiveSet === setName && typeof globalThis.renderSetTracker === "function") {
        globalThis.renderSetTracker();
      }
    }

    const rewardCounts = document.querySelectorAll(`.app-owned-val[data-part="${safePartHtml}"]`);
    rewardCounts.forEach(span => {
      const lbl = state.currentLang === "es" ? "TENÍAS" : "OWNED";
      span.textContent = `${lbl}: ${newQty}`;
    });
  });
}

export function deletePrimeSet(setName) {
  const t = TEXTS[state.currentLang].inventory;
  if (!confirm(`${t.confirmDeleteSet || "Delete entire set?"} (${setName})`))
    return;

  Object.keys(state.primeInventory).forEach((name) => {
    if (getSetName(name) === setName) {
      delete state.primeInventory[name];
    }
  });

  saveAppState();
  renderPrimeInventory();
}

export function decrementPrimeSet(setName) {
  let allPossibleParts = [];
  if (state.setsDatabase?.[setName]) {
    allPossibleParts = state.setsDatabase[setName];
  } else {
    allPossibleParts = globalThis.setPartsCache?.get(setName) || [];
  }

  if (allPossibleParts.length === 0) return;

  let anyRemoved = false;
  allPossibleParts.forEach(p => {
    const reqMatch = p.match(/(\d+)x$/);
    let requiredCount = 1;
    let partName = p;
    if (reqMatch) {
      requiredCount = Number.parseInt(reqMatch[1], 10);
      partName = p.replace(/\s*\d+x$/, "").trim();
    }

    if (state.primeInventory[partName]) {
      state.primeInventory[partName] = Math.max(0, state.primeInventory[partName] - requiredCount);
      anyRemoved = true;
      if (state.primeInventory[partName] === 0) {
        delete state.primeInventory[partName];
      }
    }
  });

  if (anyRemoved) {
    saveAppState();
    renderPrimeInventory();
  }
}

export function toggleInvSet(safeSetId) {
  const el = document.getElementById(`set-group-${safeSetId}`);
  if (el) el.classList.toggle("collapsed");
}

export function openSetDetail(setName) {
  switchTab("set");
  const input = document.getElementById("setItemInput");
  if (input) {
    input.value = setName;
    handleSetTyping();
  }
}

let lastRenderedHash = "";
export function renderPrimeInventory() {
  const list = document.getElementById("inventory-list-parts");
  if (!list) return;

  const panel = document.getElementById("inventory-sidebar");
  if (panel && !panel.classList.contains("open")) return;

  const searchInput = (document.getElementById("prime-inv-search")?.value || "").toLowerCase();
  const sortMode = document.getElementById("prime-inv-sort")?.value || "alpha";

  const newHash = JSON.stringify(state.primeInventory) + state.currentLang + searchInput + sortMode;
  if (newHash === lastRenderedHash && list.children.length > 0) {
    setTimeout(updatePrimeTotalValue, 10);
    return;
  }
  lastRenderedHash = newHash;

  const entries = Object.entries(state.primeInventory);
  const groups = {};
  entries.forEach(([name, qty]) => {
    const setName = getSetName(name);
    if (!groups[setName]) groups[setName] = [];
    if (qty > 0 || state.settings?.showEmptyPrime) {
      groups[setName].push({ name, qty });
    }
  });

  let setNames = Object.keys(groups);

  if (searchInput) {
    setNames = setNames.filter(n => {
      if (n.toLowerCase().includes(searchInput)) return true;
      const parts = groups[n] || [];
      return parts.some(p => p.name.toLowerCase().includes(searchInput));
    });
  }

  const setMetrics = new Map();
  setNames.forEach(setName => {
    if (setName === "Otros") {
      setMetrics.set(setName, { numSets: 0, setTotalPlat: 0 });
      return;
    }

    let allPossibleParts = [];
    if (state.setsDatabase?.[setName]) {
      allPossibleParts = state.setsDatabase[setName];
    } else {
      if (!globalThis.setPartsCache) globalThis.setPartsCache = new Map();
      if (!globalThis.setPartsCache.has(setName) || globalThis.setPartsCache.get(setName).length === 0) {
        const parts = Object.keys(state.itemsDatabase || {}).filter(
          (name) => (name === setName || name.startsWith(setName + " ")) && !name.endsWith(" Set")
        );
        globalThis.setPartsCache.set(setName, parts);
      }
      allPossibleParts = globalThis.setPartsCache.get(setName);
    }

    let numSets = 999;
    let setTotalPlat = 0;
    let piecesOwned = 0;

    allPossibleParts.forEach(p => {
      const owned = state.primeInventory[p] || 0;
      const required = getRequiredCount(setName, p);
      if (owned >= required) piecesOwned++;

      const possible = Math.floor(owned / required);
      if (possible < numSets) numSets = possible;

      const cachedRaw = globalThis.MEMORY_CACHE?.get(getSlug(p));
      const plat = cachedRaw ? (Number.parseInt(cachedRaw, 10) || 0) : 0;
      setTotalPlat += plat * required;
    });

    // --- Potential Sort Logic ---
    let farmablePieces = 0;
    const ownedRelics = new Set((state.inventory || []).map(r => r.name.toUpperCase()));
    allPossibleParts.forEach(p => {
      const owned = state.primeInventory[p] || 0;
      const required = getRequiredCount(setName, p);
      if (owned < required) {
        const relicsForPart = state.relicsDatabase[p] || [];
        if (relicsForPart.some(r => ownedRelics.has(r.name.toUpperCase()))) farmablePieces++;
      }
    });

    const potentialScore = (piecesOwned / allPossibleParts.length) + (farmablePieces * 0.5);

    if (numSets === 999) numSets = 0;
    setMetrics.set(setName, { numSets, setTotalPlat, piecesOwned, potentialScore });
  });

  setNames.sort((a, b) => {
    if (a === "Otros") return 1;
    if (b === "Otros") return -1;

    const metricA = setMetrics.get(a);
    const metricB = setMetrics.get(b);

    if (sortMode === "sets_desc") {
      if (metricA.numSets !== metricB.numSets) return metricB.numSets - metricA.numSets;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "sets_asc") {
      if (metricA.piecesOwned !== metricB.piecesOwned) return metricB.piecesOwned - metricA.piecesOwned;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "plat_desc") {
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "relic_potential") {
      if (metricA.potentialScore !== metricB.potentialScore) return metricB.potentialScore - metricA.potentialScore;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else {
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    }
  });

  if (setNames.length === 0) {
    const emptyMsg = TEXTS[state.currentLang].inventory.empty || "Inventory empty";
    list.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">${emptyMsg}</div>`;
    return;
  }

  globalThis.primeRenderId = (globalThis.primeRenderId || 0) + 1;
  const currentRenderId = globalThis.primeRenderId;

  setTimeout(() => {
    if (globalThis.primeRenderId !== currentRenderId) return;

    const headerHtml = `
      <div class="inventory-total-header">
         <div class="total-label">${TEXTS[state.currentLang].inventory.lblTotalValue || "ESTIMATED TOTAL VALUE"}</div>
         <div class="total-value"><span id="total-prime-value">...</span> <span class="plat-icon-inline"></span></div>
      </div>`;

    if (list.querySelector(".inventory-total-header")) {
      const oldTotal = document.getElementById("total-prime-value")?.textContent;
      list.innerHTML = headerHtml;
      if (oldTotal) document.getElementById("total-prime-value").textContent = oldTotal;
    } else {
      list.innerHTML = headerHtml;
    }

    let currentIndex = 0;
    const renderChunk = () => {
      if (globalThis.primeRenderId !== currentRenderId) return;

      const fragment = document.createDocumentFragment();
      const chunkSize = 5;
      const end = Math.min(currentIndex + chunkSize, setNames.length);

      for (; currentIndex < end; currentIndex++) {
        const setName = setNames[currentIndex];
        const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

        groups[setName].sort((a, b) => a.name.length - b.name.length);

        let numSets = 0;
        let allPossibleParts = [];
        if (setName !== "Otros") {
          // Fetching parts logic
          if (state.setsDatabase?.[setName]) {
            allPossibleParts = state.setsDatabase[setName];
          } else {
            allPossibleParts = globalThis.setPartsCache?.get(setName) || [];
          }
          numSets = setMetrics.get(setName).numSets;
        }

        let groupHtml = `
      <div class="inv-set-group collapsed" id="set-group-${safeSetId}">
        <div class="inv-set-header" data-action="toggle-inv-set" data-setid="${safeSetId}" style="cursor:pointer;">
          <div class="header-controls">
            <div style="display:flex; gap:4px;">
              ${numSets >= 1 ? `<button class="delete-set-btn" data-action="decrement-prime-set" data-setname="${escapeHTML(setName)}" title="-1 Set" style="font-size:0.75em; padding: 2px 4px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 3px; cursor: pointer; transition: all 0.2s; line-height: 1;">-1</button>` : ''}
              <button class="delete-set-btn" data-action="delete-prime-set" data-setname="${escapeHTML(setName)}" title="Delete Everything">×</button>
            </div>
            <span class="toggle-icon">▼</span>
          </div>
          
          <div class="header-main">
            ${(() => {
            const setIcon = getItemIcon(setName);
            return setIcon
              ? `<img src="${setIcon}" class="item-icon-small" loading="lazy" onerror="this.style.display='none'">`
              : "";
          })()}
            <span class="set-title">${escapeHTML(setName)}</span>
            <span class="tracker-link-icon" onclick="event.stopPropagation(); globalThis.openSetDetail('${escapeHTML(setName)}')" title="Set Tracker" style="cursor:pointer; margin-left:8px; display:inline-flex; align-items:center; vertical-align:middle; flex-shrink:0;">
              ${TARGET_SVG_INLINE}
            </span>
            <a href="https://warframe.market/items/${getSlug(setName + " Set")}" target="_blank" class="market-link-icon" onclick="event.stopPropagation()" style="margin-left:6px; flex-shrink:0; font-size:1.1em;">↗</a>
          </div>

          <div class="header-info">
             <span class="set-count-badge" style="display:${numSets > 0 ? "inline-block" : "none"};">${numSets} ${numSets === 1 ? 'SET' : 'SETS'}</span>
             <span class="set-total-price" id="set-price-${safeSetId}">0 <span class="plat-icon-inline"></span></span>
             <span id="set-mkt-${safeSetId}" class="set-price-marker" style="display:none;">...</span>
          </div>
        </div>
        <div class="inv-set-content">
          ${(setName === "Otros" ? groups[setName].map(p => p.name) : allPossibleParts)
            .map((partName) => {
              const qty = state.primeInventory[partName] || 0;
              const safeId = partName.replaceAll(/[^a-zA-Z0-9]/g, "");
              const shortName = partName.replace(setName, "").trim() || (TEXTS[state.currentLang].lblBlueprint || "Blueprint");
              const requiredCount = getRequiredCount(setName, partName);
              const dotsHtml = generateDotsHtml(qty, requiredCount);

              // Price fetch is now handled at the end of renderChunk or by updatePrimeTotalValue for items already in cache

              return `
              <div class="inv-row-mini">
                <div class="row-main" onclick="globalThis.openSetDetail('${escapeHTML(setName)}')" style="cursor:pointer;">
                  ${(() => {
                  const partIcon = getItemIcon(partName);
                  return partIcon
                    ? `<img src="${partIcon}" class="item-icon-mini" loading="lazy" onerror="this.style.display='none'">`
                    : "";
                })()}
                   <div class="name-column">
                     <span class="part-name">${escapeHTML(shortName)}</span>
                     <div class="live-tracker" data-part="${escapeHTML(partName)}" data-req="${requiredCount}">
                        ${dotsHtml}
                     </div>
                  </div>
                </div>

                <div class="row-info">
                   <a href="https://warframe.market/items/${getSlug(partName)}" target="_blank" class="market-link-icon-mini" onclick="event.stopPropagation()">↗</a>
                   <span class="price-badge-small" id="price-p-${safeId}" data-qty="${qty}" data-item="${escapeHTML(partName)}">${(() => {
                  const cached = globalThis.MEMORY_CACHE?.get(getSlug(partName));
                  if (cached !== undefined && !Number.isNaN(Number.parseInt(cached, 10))) return Number.parseInt(cached, 10);
                  return "...";
                })()} <span class="plat-icon-inline"></span></span>
                </div>

                <div class="inv-qty-controls-mini">
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(partName)}" data-amount="-1"></button>
                  <span class="qty-num" data-part="${escapeHTML(partName)}">${qty}</span>
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(partName)}" data-amount="1">+</button>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = groupHtml;
        fragment.appendChild(tempDiv.firstElementChild);
      }

      list.appendChild(fragment);
      updatePrimeTotalValue();

      if (currentIndex < setNames.length) {
        requestAnimationFrame(renderChunk);
      } else {
        setNames.forEach((setName) => {
          if (setName === "Otros") return;
          const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");
          const el = document.getElementById(`set-mkt-${safeSetId}`);
          if (el) addToQueue(setName + " Set", el);
        });
        //This is needed for the prices to update and be somewhat ready 
        if (typeof warmupPrices === "function") {
          warmupPrices();
        }

        setTimeout(updatePrimeTotalValue, 100);
      }
    };

    requestAnimationFrame(renderChunk);

    // LIVE SYNC: Start a temporary interval to pick up prices as they finish loading from the queue
    if (globalThis.invTotalSyncInterval) clearInterval(globalThis.invTotalSyncInterval);
    let syncCount = 0;
    globalThis.invTotalSyncInterval = setInterval(() => {
      syncCount++;
      updatePrimeTotalValue();
      // Stop after 20 seconds or if inventory is closed
      if (syncCount > 40 || !document.getElementById("inventory-list-parts")) {
        clearInterval(globalThis.invTotalSyncInterval);
      }
    }, 500);
  }, 10);
}

export async function updatePrimeTotalValue() {
  let totalGlobal = 0;
  const entries = Object.entries(state.primeInventory);
  const invGroups = {};

  entries.forEach(([itemName, qty]) => {
    if (qty > 0) {
      const setNameRaw = getSetName(itemName);
      if (!invGroups[setNameRaw]) {
        invGroups[setNameRaw] = { parts: {}, setPrice: 0 };
      }

      const itemSlug = getSlug(itemName);
      let price = 0;

      const safeId = itemName.replaceAll(/[^a-zA-Z0-9]/g, "");
      const badge = document.getElementById(`price-p-${safeId}`);

      const cachedRaw = globalThis.MEMORY_CACHE?.get(itemSlug);
      if (cachedRaw !== undefined) {
        price = Number.parseInt(cachedRaw, 10);
        if (badge) {
          badge.classList.remove("price-loading-blink");
          if (badge.textContent.includes("...") || badge.textContent.trim() === "") {
            badge.innerHTML = `${price} <span class="plat-icon-inline"></span>`;
          }
        }
      } else if (badge) {
        badge.classList.add("price-loading-blink");
      }
      if (Number.isNaN(price)) price = 0;

      invGroups[setNameRaw].parts[itemName] = { qty, price };
    }
  });

  Object.keys(invGroups).forEach((setNameRaw) => {
    if (setNameRaw === "Otros") return;
    const safeSetId = setNameRaw.replaceAll(/[^a-zA-Z0-9]/g, "");
    const mktEl = document.getElementById(`set-mkt-${safeSetId}`);

    const cachedRaw = globalThis.MEMORY_CACHE?.get(getSlug(setNameRaw + " Set"));
    const price = cachedRaw === undefined ? 0 : Number.parseInt(cachedRaw, 10);

    if (cachedRaw !== undefined) {
      if (!Number.isNaN(price) && mktEl) {
        mktEl.classList.remove("price-loading-blink");
        mktEl.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0; margin-top:2px;">
            <span style="font-size:0.55em; opacity:0.5; line-height:1; letter-spacing:0.5px;">MARKET SET</span>
            <span style="font-size:0.85em;">${price} <span class="plat-icon-inline"></span></span>
          </div>
        `;
        mktEl.style.display = "inline-block";
      }
    } else if (mktEl) {
      mktEl.classList.add("price-loading-blink");
      if (mktEl.textContent === "") mktEl.textContent = "...";
      mktEl.style.display = "inline-block";
    }

    invGroups[setNameRaw].setPrice = Number.isNaN(price) ? 0 : price;
    invGroups[setNameRaw].setPriceLoaded = (cachedRaw !== undefined);
  });

  Object.keys(invGroups).forEach((setName) => {
    const subtotal = calculateGroupSubtotal(setName, invGroups[setName]);
    const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

    const el = document.getElementById(`set-price-${safeSetId}`);
    if (el) {
      el.innerHTML = `${new Intl.NumberFormat().format(subtotal)} <span class="plat-icon-inline"></span>`;
    }
    totalGlobal += subtotal;
  });

  const totalEl = document.getElementById("total-prime-value");
  if (totalEl) {
    totalEl.textContent = new Intl.NumberFormat().format(totalGlobal);
    totalEl.classList.remove("loading-blink");
  }
}

function calculateGroupSubtotal(setName, groupData) {
  if (setName === "Otros") {
    return sumIndividualParts(groupData.parts);
  }

  let allPossibleParts = [];
  if (state.setsDatabase?.[setName]) {
    allPossibleParts = state.setsDatabase[setName];
  } else {
    allPossibleParts = Object.keys(state.itemsDatabase).filter(
      (name) =>
        (name === setName || name.startsWith(setName + " ")) &&
        !name.endsWith(" Set"),
    );
  }

  if (allPossibleParts.length === 0) {
    return sumIndividualParts(groupData.parts);
  }

  const numSets = calculatePossibleSets(setName, groupData, allPossibleParts);

  if (numSets > 0 && groupData.setPriceLoaded) {
    return calculateSetPlusLeftovers(setName, groupData, numSets);
  }

  return sumIndividualParts(groupData.parts);
}

function sumIndividualParts(parts) {
  let subtotal = 0;
  for (const p in parts) {
    const qty = parts[p].qty || 0;
    const price = parts[p].price || 0;
    subtotal += qty * price;
  }
  return subtotal;
}

function calculatePossibleSets(setName, groupData, allPossibleParts) {
  let numSets = 999;

  allPossibleParts.forEach((p) => {
    const hasQty = groupData.parts[p]?.qty || 0;
    const required = getRequiredCount(setName, p) || 1;
    const possibleSets = Math.floor(hasQty / required);

    if (possibleSets < numSets) {
      numSets = possibleSets;
    }
  });

  return numSets === 999 ? 0 : numSets;
}

function calculateSetPlusLeftovers(setName, groupData, numSets) {
  let subtotal = numSets * (groupData.setPrice || 0);

  for (const partName in groupData.parts) {
    const required = getRequiredCount(setName, partName) || 1;
    const remaining = (groupData.parts[partName].qty || 0) - numSets * required;

    if (remaining > 0) {
      subtotal += remaining * (groupData.parts[partName].price || 0);
    }
  }

  return subtotal;
}

export function exportInventory() {
  if (
    (!state.inventory || state.inventory.length === 0) &&
    Object.keys(state.primeInventory || {}).length === 0
  ) {
    return showToast("Inventory is completely empty.");
  }

  try {
    const exportData = {
      relics: state.inventory || [],
      parts: state.primeInventory || {},
    };
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voidstonks_inv_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data?.relics !== undefined && data.parts !== undefined) {
        if (
          confirm(
            `Archivo de inventario dual cargado.\n\nThis will overwrite your entire inventory (Relics & Parts). Are you sure?`
          )
        ) {
          state.inventory = data.relics;
          state.primeInventory = data.parts;
          saveAppState();
          renderInventory();
          renderPrimeInventory();
          showToast("Successfully updated complete inventory.");
        }
      } else if (Array.isArray(data)) {
        if (
          confirm(
            `Archivo Legacy cargado con ${data.length} items.\n\nThis will overwrite your current relic inventory. Are you sure?`
          )
        ) {
          state.inventory = data;
          saveAppState();
          renderInventory();
          showToast("Successfully updated relic inventory.");
        }
      } else {
        showToast("File has incorrect format: ERROR");
      }
    } catch (err) {
      console.error(err);
      showToast("Error reading JSON file.");
    }
  };
  input.click();
}

Object.assign(globalThis, {
  modifyInv,
  selectRelicFromInv,
  filterInvTier,
  addCurrentToInv,
  switchInvView,
  modifyPrimePart,
  deletePrimeSet,
  decrementPrimeSet,
  toggleInvSet,
  openSetDetail,
  renderInventory,
  renderPrimeInventory,
  clearInventory,
  toggleInventoryPanel,
  exportInventory,
  importInventory,
});

document.addEventListener("click", (e) => {
  const actionTarget = e.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const data = actionTarget.dataset;

  switch (action) {
    case "select-relic-from-inv":
      selectRelicFromInv(data.relic);
      break;
    case "modify-inv":
      requestAnimationFrame(() => modifyInv(data.relic, Number.parseInt(data.amount)));
      break;
    case "add-current-to-inv":
      requestAnimationFrame(() => addCurrentToInv());
      break;
    case "toggle-inv-set":
      requestAnimationFrame(() => toggleInvSet(data.setid));
      break;
    case "delete-prime-set":
      requestAnimationFrame(() => deletePrimeSet(data.setname));
      break;
    case "decrement-prime-set":
      requestAnimationFrame(() => decrementPrimeSet(data.setname));
      break;
    case "modify-prime-part":
      requestAnimationFrame(() => modifyPrimePart(data.part, Number.parseInt(data.amount)));
      break;
  }
});
