import { state, saveAppState, updateInventoryCount } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML, showToast, showCustomConfirm, emptyStateHtml } from "../ui_components.js";

import { manualRelicUpdate, renderRelicInvCounter } from "./ui_relics.js";
import { trackBestSetForRelic } from "./ui_set_tracker.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { ducatRatio, formatDucatRatio } from "./ui_ducanator.js";
import { inventorySignature } from "../../utils/inventory/inventory_signature.js";
import { goalMetaHtml, renderInvGoalChips, relicRuns, compareByGoalSets } from "./ui_inventory_goals.js";
import { calculateRelicValue } from "../../services/inventory/relics.service.js";
import {
  renderPrimeInventory,
  modifyPrimePart,
  deletePrimeSet,
  decrementPrimeSet,
  toggleInvSet,
} from "./ui_prime_inventory.js";



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
    showToast(t.inventory?.toastCleared || "Inventory cleared");
  });
}

let lastInventoryHash = "";

export async function renderInventory() {
  const list = document.getElementById("inventory-list");
  if (!list) return;

  list.classList.remove("inventory-loading");
  renderInvGoalChips();
  syncInvTierChips();

  const goal = state.invGoal || "sets";
  const newHash = inventorySignature(state.inventory) + state.invSearchVal + state.invFilterTier
    + goal + state.invOnlyActive + state.currentLang + JSON.stringify(state.primeInventory).length;
  if (newHash === lastInventoryHash && list.children.length > 0) {
    return;
  }
  lastInventoryHash = newHash;

  if (!state.inventory || state.inventory.length === 0) {
    const inv = TEXTS[state.currentLang]?.inventory;
    list.innerHTML = emptyStateHtml(
      inv?.emptyRelics || "No relics saved yet.",
      inv?.emptyScannerHint,
      inv?.emptyScannerHintMobile,
    );
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
      // Una vaulted no se puede volver a farmear: al planificar runs, estorba.
      if (state.invOnlyActive) {
        const raw = typeof item === "string" ? item : item.name;
        if (state.relicStatusDB[raw] === "vaulted") return false;
      }
      return true;
    });

    if (goal === "recent") {
      filtered.reverse();
    } else if (goal === "sets") {
      // No necesita precios: sale de las tasas de drop y del inventario de piezas prime,
      // así que ordena al instante sin esperar a warframe.market.
      const runs = new Map();
      for (const item of filtered) {
        const name = typeof item === "string" ? item : item.name;
        runs.set(name, relicRuns(name, typeof item === "string" ? 1 : item.count || 1));
      }
      filtered.sort((a, b) => compareByGoalSets(
        runs.get(typeof a === "string" ? a : a.name),
        runs.get(typeof b === "string" ? b : b.name),
      ));
    } else {
      const valueMap = new Map();

      // Por TANDAS, no todo de golpe: cada reliquia pide el precio de sus ~6 drops, así
      // que con un inventario grande un Promise.all sobre la lista entera dispara miles
      // de lecturas a la vez y deja el hilo bloqueado hasta que resuelven todas.
      const ok = await forEachRelicChunk(filtered, currentRenderId, async (name) => {
        valueMap.set(name, await calculateRelicValue(name));
      });
      if (!ok) return;

      filtered.sort((a, b) => {
        const nameA = typeof a === "string" ? a : a.name;
        const nameB = typeof b === "string" ? b : b.name;
        const valA = valueMap.get(nameA);
        const valB = valueMap.get(nameB);

        if (!valA) return 1;
        if (!valB) return -1;

        if (goal === "plat") return valB.intact - valA.intact;
        if (goal === "ducats") return valB.ducats - valA.ducats;
        if (goal === "ratio") return ducatRatio(valB.ducats, valB.intact) - ducatRatio(valA.ducats, valA.intact);
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
                   <span id="ratio-${safeId}" class="ratio-tag" title="${escapeHTML((TEXTS[state.currentLang].ducanator || {}).effTitle || "Ducados por platino")}">...</span>
                </div>
                ${goal === "sets" ? `<div class="inv-goal-line">${goalMetaHtml(itemName, count)}</div>` : ""}
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

/**
 * Recorre las reliquias en tandas cediendo el hilo, y aborta si cambió el filtro. La tanda
 * acota las peticiones vivas: cada reliquia pide ~6 drops, así que 25 son ~150 en vuelo.
 * Sin tope, un inventario de 500 lanzaba ~3000 y la pestaña se quedaba clavada.
 * @returns {Promise<boolean>} false si se canceló a mitad.
 */
async function forEachRelicChunk(relicList, renderId, fn) {
  const CHUNK = 25;
  for (let i = 0; i < relicList.length; i += CHUNK) {
    if (globalThis.relicRenderId !== renderId) return false;
    await Promise.all(relicList.slice(i, i + CHUNK).map((item) => {
      const name = typeof item === "string" ? item : item.name;
      return fn(name);
    }));
    await new Promise((r) => setTimeout(r, 0));
  }
  return globalThis.relicRenderId === renderId;
}

/**
 * Rellena precio/ducados/ratio de cada fila según resuelven.
 *
 * Antes lo hacía un setInterval de 1 s repetido 15 veces que en CADA vuelta recalculaba
 * TODAS las filas: con 500 reliquias, ~45.000 promesas para pintar 500 números, y cada
 * cambio de orden volvía a empezar. Tampoco se precalientan ya los precios con un <div>
 * desechable por drop (3000 nodos detached por render): calculateRelicValue pide esos
 * mismos precios y getPriceValue ya deduplica lo que está en vuelo.
 */
async function triggerPriceFetch(relicList) {
  const renderId = globalThis.relicRenderId;
  await forEachRelicChunk(relicList, renderId, async (rName) => {
    const stats = await calculateRelicValue(rName);
    const safeId = rName.replaceAll(/[^a-zA-Z0-9]/g, "");
    const priceEl = document.getElementById(`price-${safeId}`);
    if (!priceEl) return;
    priceEl.innerHTML = `${stats.intact}<span class="plat-icon-inline"></span>`;
    priceEl.classList.remove("price-loading");
    const ducEl = document.getElementById(`duc-${safeId}`);
    const ratioEl = document.getElementById(`ratio-${safeId}`);
    if (ducEl) ducEl.innerHTML = `${stats.ducats} <span class="ducat-icon-inline"></span>`;
    if (ratioEl) ratioEl.innerHTML = formatDucatRatio(stats.ducats, stats.intact);
  });
}

export function modifyInv(name, amount) {
  const oldLength = state.inventory ? state.inventory.length : 0;
  updateInventoryCount(name, amount);
  saveAppState();
  renderRelicInvCounter();
  // "Rutas aconsejadas" se calcula sobre ESTE inventario y no se enteraba de que cambiara: se
  // quedaba con la lista de antes hasta el refresco de 150 s. Coalescido porque los +/- se
  // pulsan en ráfaga. Por globalThis (lo publica ui_farm_routes.js) y no import: ui.js ya
  // importa este módulo y el inverso cerraría el ciclo que rompe la carga.
  globalThis.scheduleFarmRoutesRefresh?.();

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

  // Vía globalThis (lo publica main.js), no import: ui.js ya importa este módulo y
  // el import inverso crearía un ciclo que rompe la carga. Ver tests/import-graph.
  globalThis.switchTab("relic");
  // Cerrar, no `toggleInventoryPanel(false)`: esa alterna. Desde el panel daba igual (estaba
  // abierto → cerraba), pero estas mismas chapas de reliquia salen en "Rutas aconsejadas" con
  // el panel cerrado, y ahí el clic lo abría encima del contenido.
  document.getElementById("inventory-container")?.classList.remove("open");
  manualRelicUpdate();
  trackBestSetForRelic(name);
}

/**
 * Marca el chip de tier activo. Se llama también desde renderInventory porque el tier ahora
 * sobrevive a la recarga: sin esto, al arrancar filtrando por AXI el chip encendido seguía
 * siendo el "ALL" que trae el HTML.
 *
 * Por data-tier y no por el texto del botón: el rótulo de REQUIEM es "REQ", y comparar
 * innerText obligaba a un caso especial que se rompería al traducir los chips.
 */
function syncInvTierChips() {
  const tier = state.invFilterTier || "ALL";
  document.querySelectorAll(".inv-tier-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tier === tier);
  });
}

export function filterInvTier(tier) {
  state.invFilterTier = tier;
  saveAppState();
  syncInvTierChips();
  renderInventory();
}

export function addCurrentToInv() {
  if (!state.selectedRelic) return;

  updateInventoryCount(state.selectedRelic, 1);
  saveAppState();
  globalThis.scheduleFarmRoutesRefresh?.();

  const msg =
    state.currentLang === "es"
      ? `${state.selectedRelic} añadida al inventario.`
      : `${state.selectedRelic} added to inventory.`;

  showToast(msg);
  renderRelicInvCounter();

  // Aquí había un "✔ OK" temporal sobre el botón de #manual-add-container, que ya no existe
  // en el HTML: la guarda era siempre falsa. La confirmación la da el toast de arriba.

  renderInventory();
}
/**
 * Rótulos del panel lateral. Estaban escritos en inglés dentro del HTML y no pasaban por
 * TEXTS, así que "RELICS", "PRIME INVENTORY", EXPORT e IMPORT se quedaban en inglés con la
 * app en español. El título de la papelera cambia con la vista porque lo que borra también.
 */
export function updateInventoryPanelLabels() {
  const t = TEXTS[state.currentLang]?.inventory || {};
  renderRelicInvCounter();
  const isParts = state.currentInvView === "parts";

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el && text) el.textContent = text;
  };
  set("inv-tab-relics", t.viewRelics);
  set("inv-tab-parts", t.viewParts);

  const label = (sel, text) => {
    const el = document.querySelector(sel);
    if (el && text) el.textContent = text;
  };
  label(".export-btn .btn-text", t.btnExport);
  label(".import-btn .btn-text", t.btnImport);

  const purge = document.querySelector(".orokin-clear-btn");
  const purgeTitle = isParts ? t.purgePartsTitle : t.purgeRelicsTitle;
  if (purge && purgeTitle) {
    purge.title = purgeTitle;
    purge.setAttribute("aria-label", purgeTitle);
  }

  const showEmpty = document.getElementById("prime-show-empty");
  if (showEmpty) showEmpty.checked = !!state.settings?.showEmptyPrime;
  const showEmptyLbl = document.getElementById("prime-show-empty-label");
  if (showEmptyLbl && t.showEmpty) {
    showEmptyLbl.textContent = t.showEmpty;
    showEmptyLbl.parentElement.dataset.tooltip = t.showEmptyHelp || "";
  }

  const toggle = document.getElementById("inv-toggle-btn");
  const toggleTitle = isParts ? t.togglePartsTitle : t.toggleRelicsTitle;
  if (toggle && toggleTitle) {
    toggle.title = toggleTitle;
    toggle.setAttribute("aria-label", toggleTitle);
  }
}

export function switchInvView(view) {
  if (state.currentInvView === view && document.getElementById("inventory-list")?.innerHTML.length > 50) return;
  state.currentInvView = view;
  saveAppState();
  const relicControls = document.getElementById("relic-inv-controls");
  const primeControls = document.getElementById("prime-inv-controls");
  const tabRelics = document.getElementById("inv-tab-relics");
  const tabParts = document.getElementById("inv-tab-parts");

  const listRelics = document.getElementById("inventory-list");
  const listParts = document.getElementById("inventory-list-parts");

  updateInventoryPanelLabels();

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



export function exportInventory() {
  const t = TEXTS[state.currentLang]?.inventory || {};
  if (
    (!state.inventory || state.inventory.length === 0) &&
    Object.keys(state.primeInventory || {}).length === 0
  ) {
    return showToast(t.toastNothingToExport || "Nothing to export yet.");
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
    showToast(t.toastDownloaded || "Inventory downloaded");
  } catch (e) {
    console.error("Error exportando:", e);
    showToast(t.toastExportError || "Could not build the file.");
  }
}

export function importInventory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // showCustomConfirm y no confirm(): los dos avisos mezclaban español e inglés en la misma
    // frase, y el confirm nativo se salta el idioma y el estilo del resto de la app.
    const t = TEXTS[state.currentLang]?.inventory || {};

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data?.relics !== undefined && data.parts !== undefined) {
        showCustomConfirm(t.confirmImportAll, () => {
          state.inventory = data.relics;
          state.primeInventory = data.parts;
          saveAppState();
          renderInventory();
          renderPrimeInventory();
          showToast(t.toastImportedAll || "Full inventory updated");
        });
      } else if (Array.isArray(data)) {
        showCustomConfirm((t.confirmImportRelics || "").replace("{n}", data.length), () => {
          state.inventory = data;
          saveAppState();
          renderInventory();
          showToast(t.toastImportedRelics || "Relic inventory updated");
        });
      } else {
        showToast(t.toastBadFormat || "That file is not in the expected format.");
      }
    } catch (err) {
      console.error(err);
      showToast(t.toastReadError || "Could not read the JSON file.");
    }
  };
  input.click();
}

exposeGlobals({
  modifyInv,
  selectRelicFromInv,
  filterInvTier,
  addCurrentToInv,
  switchInvView,
  renderInventory,
  clearInventory,
  toggleInventoryPanel,
  exportInventory,
  importInventory,
}, "ui.components/inventory/ui_inventory.js");

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
    case "go-sell-set":
      // La cabecera del set es clicable (despliega/pliega): sin esto, publicar
      // colapsaría el grupo a la vez.
      e.stopPropagation();
      globalThis.sellSetFromInventory?.(data.setname);
      break;
  }
});
