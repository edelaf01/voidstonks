import { state, saveAppState } from "../state.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
import { addToQueue, getSlug, getPriceValue } from "../api.js";
import { escapeHTML } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
  generateSetProgressTooltip,
} from "../utils/ui_utils.js";

let debounceTimer;

export function findBestRelicMatch(inputVal) {
  if (!inputVal) return "";
  const normInput = inputVal.toUpperCase().trim();
  const normNoRelic = normInput.replace(/\s+RELIC$/, "");

  // Las eras principales ("AXI", "LITH", "NEO", "MESO", "REQUIEM") despliegan la lista completa en el dropdown
  const eras = ["AXI", "LITH", "NEO", "MESO", "REQUIEM"];
  if (eras.includes(normNoRelic)) {
    const exact = state.allRelicNames.find(
      (n) => n.toUpperCase() === normInput || n.toUpperCase() === normNoRelic + " RELIC"
    );
    return exact || "";
  }

  // 1. Coincidencia exacta por nombre (ej: "AXI A1", "LITH G1")
  let found = state.allRelicNames.find(
    (n) => n.toUpperCase() === normInput || n.toUpperCase() === normNoRelic + " RELIC"
  );
  if (found) return found;

  // 2. Coincidencia por inicio de código (ej: "AXI A1")
  found = state.allRelicNames.find(
    (n) => n.toUpperCase() === normNoRelic || n.toUpperCase().startsWith(normNoRelic)
  );
  if (found) return found;

  // 3. Coincidencia por recompensa / drop (ej: "KRONEN", "FORMA", "RHINO")
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

  // 1. Coincidencias por nombre de reliquia (ej: "AXI A1", "LITH G1", "A1", "AXI")
  const nameMatches = state.allRelicNames.filter((n) => {
    const upper = n.toUpperCase();
    return upper.includes(val) || upper.includes(valNoRelic);
  });

  // 2. Coincidencias por objeto que contiene (ej: "KRONEN", "FORMA", "RHINO")
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
      // Si el texto es parcial (ej: "AXI"), mantener el dropdown desplegado y no ocultar resultados previos si se hace clic
      return;
    }

    state.selectedRelic = realName;

    const listDiv = document.getElementById("relic-drops-list");
    const container = document.getElementById("relic-contents");
    if (!listDiv || !container) return;

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");
      renderRelicStatusBadge(state.selectedRelic);
      const items = [...state.relicsDatabase[state.selectedRelic]].sort(
        (a, b) => b.chance - a.chance
      );
      const fragment = document.createDocumentFragment();
      items.forEach((item) => fragment.appendChild(createRelicDropRow(item)));
      listDiv.replaceChildren(fragment);
      generateMessage();
    }
  } catch (e) {
    console.error("Error en manualRelicUpdate:", e);
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
    statusBadge.dataset.tooltipHtml = globalThis.getRelicDropTooltip(relicName);
  } else {
    statusBadge.innerText = t.vaulted || "VAULTED";
    statusBadge.dataset.tooltip = t.vaulted;
  }
}
//TODO Too complex , 16 out of 15 close
function createRelicDropRow(item) {
  const row = document.createElement("div");
  row.className = "component-row";
  row.draggable = true;
  row.ondragstart = (e) => {
    e.dataTransfer.setData("text/plain", item.name);
    e.dataTransfer.effectAllowed = "copy";
  };

  const isUntradable =
    item.name.includes("Forma Blueprint") ||
    item.name.includes("Kuva") ||
    item.name === "Riven Sliver";
  //TODO FIX LINT
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
        <button class="mini-action-btn" data-action="modify-prime-part" data-part="${escapeHTML(item.name)}" data-amount="1" onclick="event.stopPropagation(); requestAnimationFrame(() => { globalThis.modifyPrimePart('${escapeHTML(item.name)}', 1); showToast('${escapeHTML(item.name)} +1'); })">+1</button>
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
  const refinement = document.getElementById("refinement").value;
  const squadSize = state.playerCount || 1;
  const badges = document.querySelectorAll("#relic-drops-list .price-badge");

  const data = items.map((item) => ({
    ...item,
    rarityType:
      item.chance < 5 ? "rare" : item.chance < 20 ? "uncommon" : "common",
    price:
      Number.parseInt(
        Array.from(badges).find((b) => b.dataset.item === item.name)?.innerText,
      ) || 0,
  }));

  const totalEV = calculateSquadEV(data, refinement, squadSize);
  const ducatEV = calculateSquadEV(
    data.map((i) => ({ ...i, price: i.ducats })),
    refinement,
    squadSize,
  );

  const disp = document.getElementById("relic-profit-display");
  if (disp) {
    disp.innerHTML = `<div style="text-align:right"><span>~${totalEV.toFixed(1)}<img src="assets/relic_contents/platinum.webp" class="plat-icon"></span><br><span style="font-size:0.7em; color:var(--wf-gold-text)">~${ducatEV.toFixed(1)} <img src="assets/Ducats.webp" class="ducat-icon"></span></div>`;
    disp.classList.remove("loading");
  }

  updateRelicVerdict(state.selectedRelic, totalEV);
}

/**
 * Compares the EV of opening (already factoring refinement + squad size)
 * against the raw market price of selling the relic intact, and renders
 * an ABRIR / VENDER recommendation badge.
 * @param {string} relicName
 * @param {number} openEV  expected platinum from opening
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
    const squad = `${state.playerCount}/4`;
    const ctx = `${refText} · ${squad}`;

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

export function calculateSquadEV(items, refinement, squadSize) {
  const rates = DROP_CHANCES[refinement] || DROP_CHANCES.Intact;
  const itemsWithProb = items
    .map((i) => ({
      price: i.price || 0,
      prob:
        i.rarityType === "rare"
          ? rates.rare
          : i.rarityType === "uncommon"
            ? rates.uncommon / 2
            : rates.common / 3,
    }))
    .sort((a, b) => a.price - b.price);

  let ev = 0,
    acc = 0;
  for (let item of itemsWithProb) {
    let nextAcc = acc + item.prob;
    ev +=
      item.price * (Math.pow(nextAcc, squadSize) - Math.pow(acc, squadSize));
    acc = nextAcc;
  }
  return ev;
}

export function generateMessage() {
  const t = TEXTS[state.currentLang];
  const rName = state.selectedRelic || t.defaultRelic;
  const ref = document.getElementById("refinement");
  const refText = ref.options[ref.selectedIndex]?.text || "Intact";
  const link = state.selectedRelic
    //TODO FIX LINT should look into translations too
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
      //TODO FIX LINT
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
      //i should be using this but apparently not
      //const averages = state.relicAverages ? state.relicAverages[info.relic] : null;
      //TODO FIX LINT and why do i need this?
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
      };
      grid.appendChild(btn);
    });
  container.appendChild(grid);
}

Object.assign(globalThis, {
  handleRelicTyping,
  manualRelicUpdate,
  generateMessage,
  renderRelicsForPartInline,
  changeCount: (n) => {
    state.playerCount = Math.max(1, Math.min(4, state.playerCount + n));
    document.getElementById("countDisplay").innerText = state.playerCount;
    generateMessage();
  },
});
