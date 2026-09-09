import { state, saveAppState } from "../../state.js";
import { TEXTS } from "../../config.js";
import { addToQueue, getPriceValue } from "../../services/market/prices.service.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { relicOpenEV, getPlayerOdds } from "../../utils/inventory/relic_drop_odds.utils.js";
import { escapeHTML } from "../ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
} from "../../utils/ui_utils.js";
import {
  generateDotsHtml,
  generateSetProgressTooltip,
  getRelicDropTooltip,
} from "../ui_tooltips.js";
// same specifier (?v=1.1) as ui.js/main.js: another one would load a second module instance
import { updateRecommendedMissions } from "../farms/ui_fissures.js?v=1.1";
import { trackBestSetForRelic, renderSetTracker } from "./ui_set_tracker.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { isTouchPointer } from "../../utils/tap.js";

let debounceTimer;

// last relic the fissure panel opened with: manualRelicUpdate also runs on re-renders, and without this
// the panel reopened after the user closed it
let lastFissureRelic = null;

export function findBestRelicMatch(inputVal) {
  if (!inputVal) return "";
  const normInput = inputVal.toUpperCase().trim();
  const normNoRelic = normInput.replace(/\s+RELIC$/, "");

  // the main eras open the full list in the dropdown
  const eras = ["AXI", "LITH", "NEO", "MESO", "REQUIEM"];
  if (eras.includes(normNoRelic)) {
    const exact = state.allRelicNames.find(
      (n) => n.toUpperCase() === normInput || n.toUpperCase() === normNoRelic + " RELIC"
    );
    return exact || "";
  }

  // 1. exact name ("AXI A1")
  let found = state.allRelicNames.find(
    (n) => n.toUpperCase() === normInput || n.toUpperCase() === normNoRelic + " RELIC"
  );
  if (found) return found;

  // 2. code prefix
  found = state.allRelicNames.find(
    (n) => n.toUpperCase() === normNoRelic || n.toUpperCase().startsWith(normNoRelic)
  );
  if (found) return found;

  // 3. by reward ("KRONEN", "FORMA", "RHINO")
  if (state.relicsDatabase) {
    for (const [relicName, drops] of Object.entries(state.relicsDatabase)) {
      if (drops.some((d) => d.name.toUpperCase().includes(normInput))) {
        return relicName;
      }
    }
  }
  return "";
}

export function handleRelicTyping() {
  const input = document.getElementById("relicInput");
  if (!input) return;
  const val = input.value.toUpperCase().trim();
  const container = document.getElementById("relic-contents");
  const dropdown = document.getElementById("relicDropdown");
  saveAppState();

  if (val.length < 1) {
    if (dropdown) {
      dropdown.classList.add("hidden");
      dropdown.style.display = "none";
    }
    container?.classList.add("hidden");
    state.selectedRelic = "";
    return;
  }

  const valNoRelic = val.replace(/\s+RELIC$/, "");

  const nameMatches = state.allRelicNames.filter((n) => {
    const upper = n.toUpperCase();
    return upper.includes(val) || upper.includes(valNoRelic);
  });

  const dropMatches = [];
  if (state.relicsDatabase) {
    for (const [relicName, drops] of Object.entries(state.relicsDatabase)) {
      if (nameMatches.includes(relicName)) continue;
      const matchingDrop = drops.find((d) => d.name.toUpperCase().includes(val));
      if (matchingDrop) {
        dropMatches.push({ relicName, dropName: matchingDrop.name });
      }
    }
  }

  const combined = [];
  nameMatches.forEach((n) => combined.push({ relicName: n, label: n }));
  dropMatches.forEach((d) =>
    combined.push({ relicName: d.relicName, label: `${d.relicName} (${d.dropName})` })
  );

  const matches = combined.slice(0, 15);

  if (matches.length > 0 && dropdown) {
    dropdown.innerHTML = "";
    dropdown.classList.remove("hidden");
    dropdown.style.display = "block";
    matches.forEach((itemObj) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerText = itemObj.label;
      item.onclick = () => {
        input.value = itemObj.relicName;
        dropdown.classList.add("hidden");
        dropdown.style.display = "none";
        document.getElementById("relic-contents")?.classList.remove("hidden");
        manualRelicUpdate();
        // here and not in manualRelicUpdate(), which runs on every input: picking from the dropdown is when you
        // have really chosen
        trackBestSetForRelic(itemObj.relicName);
      };
      dropdown.appendChild(item);
    });
  } else {
    if (dropdown) {
      dropdown.classList.add("hidden");
      dropdown.style.display = "none";
    }
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(manualRelicUpdate, 350);
}

export function manualRelicUpdate() {
  try {
    const relicInput = document.getElementById("relicInput");
    if (!relicInput) return;
    const inputVal = relicInput.value.trim();
    if (!inputVal) {
      document.getElementById("relic-contents")?.classList.add("hidden");
      return;
    }

    const realName = findBestRelicMatch(inputVal);
    if (!realName) {
      // partial text ("AXI"): keep the dropdown open
      return;
    }

    state.selectedRelic = realName;

    const listDiv = document.getElementById("relic-drops-list");
    const container = document.getElementById("relic-contents");
    if (!listDiv || !container) return;

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");
      renderRelicStatusBadge(state.selectedRelic);
      renderRelicInvCounter();
      const items = [...state.relicsDatabase[state.selectedRelic]].sort(
        (a, b) => b.chance - a.chance
      );
      const fragment = document.createDocumentFragment();
      items.forEach((item) => fragment.appendChild(createRelicDropRow(item)));
      listDiv.replaceChildren(fragment);
      initLongPressDrag(listDiv);
      generateMessage();

      if (state.selectedRelic !== lastFissureRelic) {
        lastFissureRelic = state.selectedRelic;
        // on mobile the panel covered the relic just searched: fissures are still fetched, it just does not
        // open by itself
        if (globalThis.innerWidth > 768) {
          document.getElementById("best-missions-container")?.classList.add("open");
        }
        updateRecommendedMissions(state.selectedRelic.split(" ")[0]).catch(console.error);
      }
    }
  } catch (e) {
    console.error("Error en manualRelicUpdate:", e);
  }
}

// saved copies of the open relic. The old inventory was an array of repeated strings, migrated on the
// first +/-, so both shapes are read
export function renderRelicInvCounter() {
  const rotulo = document.getElementById("txt-relic-inv-count");
  if (!rotulo) return;
  const relic = state.selectedRelic;
  const n = (state.inventory || []).reduce((total, item) => {
    if (typeof item === "string") return total + (item === relic ? 1 : 0);
    return total + (item?.name === relic ? item.count || 0 : 0);
  }, 0);
  const t = TEXTS[state.currentLang]?.inventory || {};
  rotulo.textContent = (t.relicInvCount || "In your inventory: {n}").replace("{n}", n);

  // names the relic: a bare "+1" got confused with the part buttons below
  const boton = document.getElementById("btn-relic-inv-add");
  if (boton && relic) {
    const titulo = (t.relicInvAddTitle || "Add {relic} to your inventory").replace("{relic}", relic);
    boton.title = titulo;
    boton.setAttribute("aria-label", titulo);
  }
}

function renderRelicStatusBadge(relicName) {
  const statusBadge = document.getElementById("relic-status-badge");
  if (!statusBadge) return;
  const status = state.relicStatusDB[relicName] || "vaulted";
  const t = TEXTS[state.currentLang];
  statusBadge.className = `badge ${status}`;
  statusBadge.style.display = "inline-block";
  if (status === "active" || status === "aya") {
    statusBadge.innerText = status === "aya" ? "AYA (RESURGENCE)" : (t.active || "ACTIVE");
    statusBadge.dataset.tooltipHtml = getRelicDropTooltip(relicName);
  } else {
    statusBadge.innerText = t.vaulted || "VAULTED";
    statusBadge.dataset.tooltip = t.vaulted;
  }
}
// longer than the tab fan's 220 ms: here the gesture competes with list scroll
const LONG_PRESS_MS = 400;
// moving more than this before the timer fires means scroll
const MOVE_CANCEL_PX = 10;

/**
 * Long press drag: the touch version of HTML5 drag and drop, which fingers do not fire. Delegated on the
 * list, since rows are rebuilt for every relic.
 */
function initLongPressDrag(listDiv) {
  if (listDiv.dataset.lpDrag) return;
  listDiv.dataset.lpDrag = "1";

  let timer = null;
  let dragging = false;
  let row = null;
  let itemName = "";
  let startX = 0;
  let startY = 0;

  const tracker = () => document.getElementById("set-tracker");

  const hint = (key) => {
    const el = tracker()?.querySelector(".tracker-dropzone-text");
    const txt = TEXTS[state.currentLang]?.setTab?.[key];
    if (el && txt) el.textContent = txt;
  };

  const overTracker = (touch) => {
    const t = tracker();
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    return !!(t && el && t.contains(el));
  };

  const cleanup = () => {
    clearTimeout(timer);
    timer = null;
    row?.classList.remove("is-lifted");
    tracker()?.classList.remove("drag-hover");
    if (dragging) hint("dropHint");
    dragging = false;
    row = null;
    itemName = "";
  };

  listDiv.addEventListener("touchstart", (e) => {
    // a badly ended earlier gesture would leave the timer alive
    cleanup();
    if (e.touches.length !== 1) return;
    row = e.target.closest(".component-row.is-draggable");
    if (!row) return;
    itemName = row.dataset.part || "";
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      dragging = true;
      row.classList.add("is-lifted");
      // haptic cue that the gesture caught: the finger covers the row
      navigator.vibrate?.(15);
      tracker()?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, LONG_PRESS_MS);
  }, { passive: true });

  // passive: false on purpose: preventDefault() cannot run in a passive listener
  listDiv.addEventListener("touchmove", (e) => {
    if (!row) return;
    const t = e.touches[0];
    if (!dragging) {
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL_PX) cleanup();
      return;
    }
    e.preventDefault();
    const over = overTracker(t);
    tracker()?.classList.toggle("drag-hover", over);
    hint(over ? "dropActive" : "dropHint");
  }, { passive: false });

  listDiv.addEventListener("touchend", (e) => {
    const drop = dragging && itemName && overTracker(e.changedTouches[0]);
    const name = itemName;
    cleanup();
    if (drop) globalThis.trackSetFromPart?.(name);
  });

  listDiv.addEventListener("touchcancel", cleanup);
}

// builds the whole row in one innerHTML; split it by block if it needs changes again
function createRelicDropRow(item) {
  const row = document.createElement("div");
  row.className = "component-row";
  // draggable to the set progress panel; .is-draggable and the tooltip announce it, since the cursor
  // does not show on touch
  row.draggable = true;
  row.classList.add("is-draggable");
  // the name in the DOM too: the touch drag is delegated and only has the row under the finger
  row.dataset.part = item.name;
  const st = TEXTS[state.currentLang]?.setTab || {};
  row.dataset.tooltip = (isTouchPointer() ? st.dragTipTouch : st.dragTip) || "";
  row.ondragstart = (e) => {
    e.dataTransfer.setData("text/plain", item.name);
    e.dataTransfer.effectAllowed = "copy";
  };

  const isUntradable =
    item.name.includes("Forma Blueprint") ||
    item.name.includes("Kuva") ||
    item.name === "Riven Sliver";
  let rarityKey =
    item.chance <= 5 ? "rare" : item.chance <= 11 ? "uncommon" : "common";
  if (isUntradable) {
    if (!item.name.toLowerCase().includes("forma blueprint")) {
      rarityKey = "forma";
    }
  }
  row.dataset.rarity = rarityKey;

  const setName = getSetName(item.name);
  const dots =
    setName === "Otros"
      ? ""
      : generateDotsHtml(
        state.primeInventory[item.name] || 0,
        getRequiredCount(setName, item.name),
      );

  const tooltipHtml = setName === "Otros" ? "" : generateSetProgressTooltip(setName);

  row.innerHTML = `
    <div class="component-info" style="flex:1; min-width:0;">
      <span class="rarity-indicator">${TEXTS[state.currentLang].rarityAbbr[rarityKey] || ""}</span>
      <div class="name-wrapper">
        <img src="${getItemIcon(item.name)}" class="item-icon-mini item-interactive" loading="lazy" onerror="this.style.display='none'" onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapeHTML(item.name)}')">
        <div class="name-column">
          <span class="component-name item-interactive" onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapeHTML(item.name)}')">
            ${escapeHTML(item.name)}
          </span>
          <div class="progress-tooltip-wrapper">
             <div class="live-tracker" data-part="${escapeHTML(item.name)}" data-req="${getRequiredCount(setName, item.name)}">
               ${dots}
             </div>
             ${tooltipHtml ? `<div class="progress-tooltip-content">${tooltipHtml}</div>` : ""}
          </div>
        </div>
      </div>
    </div>
    
    ${!isUntradable
      ? `<div class="actions-col-wrapper" style="margin-right:10px;">
        <a href="https://warframe.market/items/${getSlug(item.name)}" target="_blank" class="market-btn-mini" onclick="event.stopPropagation()" title="Warframe Market">${state.currentLang === "es" ? "MERCADO" : "MARKET"}</a>
        <button class="mini-action-btn" data-action="modify-prime-part" data-part="${escapeHTML(item.name)}" data-amount="1" onclick="event.stopPropagation(); requestAnimationFrame(() => { globalThis.modifyPrimePart('${escapeHTML(item.name)}', 1); showToast(globalThis.qtyToast('${escapeHTML(item.name)}', 1)); })">+1</button>
      </div>`
      : `<div class="actions-col-wrapper" style="margin-right:10px;"></div>`
    }

    <div style="display:flex; align-items:center; gap:8px;">
      <span class="ducat-val" style="color:var(--wf-gold-text); font-size:0.85em; font-weight:bold; ${isUntradable ? 'opacity:0.3;' : ''}">${item.ducats || 0} <img src="assets/Ducats.webp" class="ducat-icon" ${isUntradable ? 'style="opacity:0.6;"' : ''}></span>
      <div class="price-badge ${isUntradable ? "untradable" : "loading"}" data-item="${escapeHTML(item.name)}" ${isUntradable ? 'style="opacity:0.3;"' : ''}>${isUntradable ? "0" : "..."}</div>
    </div>`;

  if (!isUntradable) addToQueue(item.name, row.querySelector(".price-badge"));
  return row;
}

export function updateRelicTotal() {
  if (!state.selectedRelic || !state.relicsDatabase[state.selectedRelic])
    return;
  const items = state.relicsDatabase[state.selectedRelic];
  // getPlayerOdds, not the <select>: refinement is global, and one source avoids mixing DOM and state
  const { refinement, squadSize } = getPlayerOdds();
  const badges = document.querySelectorAll("#relic-drops-list .price-badge");

  const priceOf = (item) =>
    Number.parseInt(
      Array.from(badges).find((b) => b.dataset.item === item.name)?.innerText,
      10,
    ) || 0;

  const totalEV = relicOpenEV(items, { refinement, squadSize, valueOf: priceOf });
  const ducatEV = relicOpenEV(items, {
    refinement,
    squadSize,
    valueOf: (i) => i.ducats || 0,
  });

  const disp = document.getElementById("relic-profit-display");
  if (disp) {
    disp.innerHTML = `<div style="text-align:right"><span>~${totalEV.toFixed(1)}<img src="assets/relic_contents/platinum.webp" class="plat-icon"></span><br><span style="font-size:0.7em; color:var(--wf-gold-text)">~${ducatEV.toFixed(1)} <img src="assets/Ducats.webp" class="ducat-icon"></span></div>`;
    disp.classList.remove("loading");
  }

  updateRelicVerdict(state.selectedRelic, totalEV);
}

/**
 * Opening EV (refinement and squad already in) against selling the relic intact: OPEN / SELL badge.
 * @param {string} relicName
 * @param {number} openEV
 */
export function updateRelicVerdict(relicName, openEV) {
  const box = document.getElementById("relic-verdict");
  if (!box || !relicName) return;
  const es = state.currentLang === "es";

  // warframe.market lists relics with a "_relic" suffix on the slug.
  const relicSlug = `${getSlug(relicName)}_relic`;
  getPriceValue(relicName, relicSlug).then((sellPrice) => {
    // Bail if selection changed while the price was in flight.
    if (state.selectedRelic !== relicName) return;
    box.classList.remove("hidden", "open", "sell", "neutral");

    const ref = document.getElementById("refinement");
    const refText = ref?.options[ref.selectedIndex]?.text || "";
    const ctx = `${refText} · ${getPlayerOdds().squadSize}/4`;

    if (!sellPrice || sellPrice <= 0) {
      box.classList.add("neutral");
      box.innerHTML = `
        <span class="verdict-tag">${es ? "ABRIR" : "OPEN"}</span>
        <span class="verdict-detail">${es ? "Sin precio de venta en el mercado" : "No market sell price"}<br>${ctx}</span>`;
      return;
    }

    const open = openEV >= sellPrice;
    const diff = Math.abs(openEV - sellPrice);
    box.classList.add(open ? "open" : "sell");
    const tag = open
      ? (es ? "ABRIR" : "OPEN")
      : (es ? "VENDER" : "SELL");
    const reason = open
      ? (es ? "Abrir renta más" : "Opening is worth more")
      : (es ? "Vender intacta renta más" : "Selling intact is worth more");

    box.innerHTML = `
      <span class="verdict-tag">${tag}</span>
      <span class="verdict-detail">
        ${reason} <b>(+${diff.toFixed(1)}<img src="assets/relic_contents/platinum.webp" class="plat-icon">)</b><br>
        ${es ? "Abrir" : "Open"} ~<b>${openEV.toFixed(1)}</b> · ${es ? "Vender" : "Sell"} ~<b>${sellPrice}</b> · ${ctx}
      </span>`;
  });
}

export function generateMessage() {
  const t = TEXTS[state.currentLang];
  const rName = state.selectedRelic || t.defaultRelic;
  const ref = document.getElementById("refinement");
  const refText = ref.options[ref.selectedIndex]?.text || "Intact";
  const link = state.selectedRelic
    ? state.currentLang === "en"
      ? `[${rName} Relic]`
      : `[Reliquia ${rName}]`
    : `[${t.defaultRelic}]`;
  const msg = `H ${link} ${refText} ${state.playerCount === 4 ? "3/4" : state.playerCount + "/4"}`;
  const box = document.getElementById("finalMessage");
  if (box) {
    box.innerText = msg;
    updateRelicTotal();
  }
}

export function renderRelicsForPartInline(partName, container) {
  const relics = state.itemsDatabase[partName] || [];
  container.innerHTML = "";
  if (relics.length === 0) {
    container.innerHTML = `<div class="vaulted-msg">Vaulted</div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "relic-grid";
  relics
    .sort((a, b) => a.relic.localeCompare(b.relic))
    .forEach((info) => {
      const btn = document.createElement("div");
      const rc =
        info.chance <= 5 ? "rare" : info.chance <= 22 ? "uncommon" : "common";
      const tier = info.relic.split(" ")[0].toLowerCase();
      btn.className = `relic-chip ${rc}`;

      const relicEraImg = `<span class="relic-era-icon ${tier}" style="flex-shrink:0; transform:scale(1.3); margin: 4px;"></span>`;

      const vaultStatus = state.relicStatusDB ? state.relicStatusDB[info.relic] : null;
      const t = TEXTS[state.currentLang];
      const isVaulted = vaultStatus === "vaulted";
      const statusClass = isVaulted ? "vaulted" : "active";
      const statusText = isVaulted ? (t.vaulted || "VAULTED") : (t.active || "ACTIVE");
      const vaultHtml = `<span class="status-badge ${statusClass}" style="font-size:0.65em; padding:2px 6px; border-radius:4px;">${statusText}</span>`;
      btn.style.height = "auto";
      btn.style.minHeight = "min-content";

      btn.style.position = "relative";

      btn.dataset.tooltipRelic = info.relic;

      btn.innerHTML = `
        <span class="info-icon" style="position:absolute; top:4px; right:6px; font-size:1.1em; opacity:0.6; z-index:2;">ℹ️</span>
        <div style="display:flex; flex-direction:column; align-items:center; gap:6px; width:100%;">
          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
            ${relicEraImg}
            <span style="font-weight:800; font-size:1.0em; color:#fff;">${info.relic}</span>
          </div>
          ${vaultHtml}
        </div>
        <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1); width:100%; text-align:center;">
          <span style="font-size:0.7em; font-weight:bold; opacity:0.6; text-transform:uppercase;">${rc} Drop</span>
        </div>
      `;
      btn.onclick = (e) => {
        if (e.target.closest('.info-icon')) return;

        state.selectedRelic = info.relic;
        const searchInput = document.getElementById("relicInput");
        if (searchInput) searchInput.value = info.relic;
        if (globalThis.manualRelicUpdate) globalThis.manualRelicUpdate();
        if (globalThis.switchTab) globalThis.switchTab("relic");
        trackBestSetForRelic(info.relic);
      };
      grid.appendChild(btn);
    });
  container.appendChild(grid);
}

/**
 * Refinement and squad are global: the verdict here, the inventory chips, the set tracker and the
 * routes all use them. Both controls go through here and everything recomputes at once.
 */
export function setRefinement(label) {
  state.refinement = label;
  const select = document.getElementById("refinement");
  if (select && select.value !== label) select.value = label;
  saveAppState();
  generateMessage();
  refreshOddsDependents();
}

export function setSquadSize(size) {
  state.squadSize = Math.min(4, Math.max(1, Number.parseInt(size, 10) || 4));
  saveAppState();
  refreshOddsDependents();
}

export function updateProfitLabel() {
  const t = TEXTS[state.currentLang];
  if (!t) return;
  const { squadSize } = getPlayerOdds();

  const label = document.getElementById("lbl-profit");
  if (label) {
    label.innerText = squadSize <= 1
      ? t.lblProfitSolo
      : (t.lblProfitSquad || "").replace("{n}", String(squadSize));
  }

  const select = document.getElementById("squadSize");
  if (select && select.value !== String(squadSize)) select.value = String(squadSize);
}

export function refreshOddsDependents() {
  updateProfitLabel();
  updateRelicTotal();
  if (state.currentActiveSet) renderSetTracker();
  globalThis.renderInventory?.();
  globalThis.renderFarmRoutes?.().catch((e) => console.warn("[rutas] tasas:", e));
}

exposeGlobals({
  handleRelicTyping,
  manualRelicUpdate,
  generateMessage,
  renderRelicsForPartInline,
  setRefinement,
  setSquadSize,
  changeCount: (n) => {
    state.playerCount = Math.max(1, Math.min(4, state.playerCount + n));
    document.getElementById("countDisplay").innerText = state.playerCount;
    generateMessage();
  },
}, "ui.components/inventory/ui_relics.js");
