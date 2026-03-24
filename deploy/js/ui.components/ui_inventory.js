import { state, saveAppState, updateInventoryCount } from "../state.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
import { addToQueue, getSlug, getPriceValue } from "../api.js";
import { escapeHTML, showToast, showCustomConfirm } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
} from "./ui_utils.js"; 

import { manualRelicUpdate } from "./ui_relics.js";


export function toggleInventoryPanel(forceOpen = false) {
  const panel = document.getElementById("inventory-container");
  if (forceOpen) panel.classList.add("open");
  else panel.classList.toggle("open");
  if (panel.classList.contains("open")) renderInventory();
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
                 <span class="relic-status-tag ${isVaulted ? "vaulted" : "active"}">${isVaulted ? "VAULTED" : "ACTIVE"}</span>
                 <span id="duc-${safeId}" class="ducat-tag">... duc</span>
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

  list.innerHTML = "";
  list.appendChild(fragment);

  triggerPriceFetch(filtered);
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
          priceEl.innerHTML = `${stats.intact}<img src="assets/relic_contents/platinum.webp" class="plat-icon">`;
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

export function modifyInv(name, amount) {
  updateInventoryCount(name, amount);
  saveAppState();
  renderInventory();
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
  state.currentInvView = view;
  const relicControls = document.getElementById("relic-inv-controls");
  const tabRelics = document.getElementById("inv-tab-relics");
  const tabParts = document.getElementById("inv-tab-parts");

  if (view === "relics") {
    relicControls.style.display = "flex";
    tabRelics.classList.add("active");
    tabParts.classList.remove("active");
    renderInventory();
  } else {
    relicControls.style.display = "none";
    tabParts.classList.add("active");
    tabRelics.classList.remove("active");
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
  renderPrimeInventory();
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

export function renderPrimeInventory() {
  const list = document.getElementById("inventory-list");
  if (!list) return;

  const entries = Object.entries(state.primeInventory);
  if (entries.length === 0) {
    list.innerHTML = `<div style="padding:20px; text-align:center; color:#666;">Inventory is empty</div>`;
    return;
  }

  const groups = {};
  entries.forEach(([name, qty]) => {
    const setName = getSetName(name);
    if (!groups[setName]) groups[setName] = [];
    groups[setName].push({ name, qty });
  });

  let html = `
    <div class="inventory-total-header">
       <div class="total-label">${TEXTS[state.currentLang].inventory.lblTotalValue || "ESTIMATED TOTAL VALUE"}</div>
       <div class="total-value"><span id="total-prime-value">...</span> <img src="assets/relic_contents/platinum.webp" class="plat-icon" style="height:1em;"></div>
    </div>`;

  Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .forEach((setName) => {
      const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

      groups[setName].sort((a, b) => a.name.length - b.name.length);

      let numSets = 0;
      if (setName !== "Otros") {
        const allPossibleParts = Object.keys(state.itemsDatabase).filter(
          (name) =>
            (name === setName || name.startsWith(setName + " ")) &&
            !name.endsWith(" Set"),
        );

        if (allPossibleParts.length > 0) {
          numSets = 999;
          allPossibleParts.forEach((p) => {
            const owned = state.primeInventory[p] || 0;
            const required = getRequiredCount(setName, p);
            const possible = Math.floor(owned / required);
            if (possible < numSets) numSets = possible;
          });
          if (numSets === 999) numSets = 0;
        }
      }

      html += `
      <div class="inv-set-group" id="set-group-${safeSetId}">
        <div class="inv-set-header" data-action="toggle-inv-set" data-setid="${safeSetId}">
          <div class="header-controls">
            <button class="delete-set-btn" data-action="delete-prime-set" data-setname="${escapeHTML(setName)}">×</button>
            <span class="toggle-icon">▼</span>
          </div>
          
          <div class="header-main" onclick="event.stopPropagation(); globalThis.openSetDetail('${escapeHTML(setName)}')">
            ${(() => {
              const setIcon = getItemIcon(setName);
              return setIcon
                ? `<img src="${setIcon}" class="item-icon-small" onerror="this.style.display='none'">`
                : "";
            })()}
            <span class="set-title">${escapeHTML(setName)}</span>
            <a href="https://warframe.market/items/${getSlug(setName + " Set")}" target="_blank" class="market-link-icon" onclick="event.stopPropagation()">↗</a>
          </div>

          <div class="header-info">
             ${numSets > 0 ? `<span class="set-count-badge">${numSets} SETS</span>` : "<span></span>"}
             <span class="set-total-price" id="set-price-${safeSetId}">0 <img src="assets/relic_contents/platinum.webp" class="plat-icon"></span>
          </div>
          <span id="set-mkt-${safeSetId}" class="set-price-marker" style="display:none" data-setname="${escapeHTML(setName)} Set">...</span>
        </div>
        <div class="inv-set-content">
          ${groups[setName]
            .map((item) => {
              const safeId = item.name.replaceAll(/[^a-zA-Z0-9]/g, "");
              const shortName =
                item.name.replace(setName, "").trim() || "Blueprint";
              const requiredCount = getRequiredCount(setName, item.name);
              const dotsHtml = generateDotsHtml(item.qty, requiredCount);

              return `
              <div class="inv-row-mini">
                <div class="row-main" onclick="globalThis.openSetDetail('${escapeHTML(setName)}')">
                  ${(() => {
                    const partIcon = getItemIcon(item.name);
                    return partIcon
                      ? `<img src="${partIcon}" class="item-icon-mini" onerror="this.style.display='none'">`
                      : "";
                  })()}
                  <div class="name-column">
                     <span class="part-name">${escapeHTML(shortName)}</span>
                     ${dotsHtml}
                  </div>
                </div>

                <div class="row-info">
                   <a href="https://warframe.market/items/${getSlug(item.name)}" target="_blank" class="market-link-icon-mini" onclick="event.stopPropagation()">↗</a>
                   <span class="price-badge-small" id="price-p-${safeId}" data-qty="${item.qty}" data-item="${escapeHTML(item.name)}">...</span>
                </div>

                <div class="inv-qty-controls-mini">
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(item.name)}" data-amount="-1">−</button>
                  <span class="qty-num">${item.qty}</span>
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(item.name)}" data-amount="1">+</button>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;
    });

  list.innerHTML = html;

  entries.forEach(([name]) => {
    const safeId = name.replaceAll(/[^a-zA-Z0-9]/g, "");
    const el = document.getElementById(`price-p-${safeId}`);
    if (el) addToQueue(name, el);
  });

  Object.keys(groups).forEach((setName) => {
    if (setName === "Otros") return;
    const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");
    const el = document.getElementById(`set-mkt-${safeSetId}`);
    if (el) addToQueue(setName + " Set", el);
  });

  setTimeout(updatePrimeTotalValue, 100);
}

export async function updatePrimeTotalValue() {
  let totalGlobal = 0;
  let allLoaded = true;

  if (!state.itemsDatabase) return;

  const invGroups = {};
  const badges = document.querySelectorAll(".price-badge-small");

  badges.forEach((b) => {
    const val = Number.parseInt(b.innerText);
    const qty = Number.parseInt(b.dataset.qty) || 0;
    const itemName = b.dataset.item;
    const setName = getSetName(itemName);

    if (!invGroups[setName]) {
      invGroups[setName] = { parts: {}, setPrice: 0, setPriceLoaded: false };
    }

    invGroups[setName].parts[itemName] = {
      qty,
      price: Number.isNaN(val) ? 0 : val,
      loaded: !Number.isNaN(val),
    };

    if (Number.isNaN(val) && qty > 0) allLoaded = false;
  });

  const setMarkers = document.querySelectorAll(".set-price-marker");
  setMarkers.forEach((m) => {
    const val = Number.parseInt(m.innerText);
    const setNameRaw = m.dataset.setname.replace(" Set", "");

    if (invGroups[setNameRaw]) {
      invGroups[setNameRaw].setPrice = Number.isNaN(val) ? 0 : val;
      invGroups[setNameRaw].setPriceLoaded = !Number.isNaN(val);
      if (Number.isNaN(val) && setNameRaw !== "Otros") allLoaded = false;
    }
  });

  Object.keys(invGroups).forEach((setName) => {
    const subtotal = calculateGroupSubtotal(setName, invGroups[setName]);
    const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

    const el = document.getElementById(`set-price-${safeSetId}`);
    if (el) {
      el.innerHTML = `${subtotal} <img src="assets/relic_contents/platinum.webp" class="plat-icon">`;
    }
    totalGlobal += subtotal;
  });

  const totalEl = document.getElementById("total-prime-value");
  if (totalEl) {
    totalEl.textContent = totalGlobal;
    totalEl.classList.toggle("loading-blink", !allLoaded);
  }

  if (!allLoaded) setTimeout(updatePrimeTotalValue, 1000);
}

function calculateGroupSubtotal(setName, groupData) {
  if (setName === "Otros") {
    return sumIndividualParts(groupData.parts);
  }

  const allPossibleParts = Object.keys(state.itemsDatabase).filter(
    (name) =>
      (name === setName || name.startsWith(setName + " ")) &&
      !name.endsWith(" Set"),
  );

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

      if (Array.isArray(data)) {
        if (
          confirm(
            `Archivo cargado con ${data.length} items.\n\nThis will overwrite your current relic inventory are you sure?`,
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
      modifyInv(data.relic, Number.parseInt(data.amount));
      break;
    case "add-current-to-inv":
      addCurrentToInv();
      break;
    case "toggle-inv-set":
      toggleInvSet(data.setid);
      break;
    case "delete-prime-set":
      deletePrimeSet(data.setname);
      break;
    case "modify-prime-part":
      modifyPrimePart(data.part, Number.parseInt(data.amount));
      break;
  }
});
