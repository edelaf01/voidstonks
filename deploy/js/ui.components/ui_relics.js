import { state, saveAppState } from "../state.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
import { addToQueue, getSlug } from "../api.js";
import { escapeHTML } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
  generateSetProgressTooltip,
} from "./ui_utils.js";

let debounceTimer;

export function handleRelicTyping() {
  const input = document.getElementById("relicInput");
  const val = input.value.toUpperCase().trim();
  const container = document.getElementById("relic-contents");
  const dropdown = document.getElementById("relicDropdown");
  saveAppState();
  if (val.length < 1) {
    dropdown?.classList.add("hidden");
    container?.classList.add("hidden");
    state.selectedRelic = "";
    return;
  }
  const matches = state.allRelicNames
    .filter((n) => n.toUpperCase().includes(val))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 10);
  if (matches.length > 0 && dropdown) {
    dropdown.innerHTML = "";
    dropdown.classList.remove("hidden");
    matches.forEach((name) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.innerText = name;
      item.onclick = () => {
        input.value = name;
        dropdown.classList.add("hidden");
        document.getElementById("relic-contents")?.classList.remove("hidden");
        manualRelicUpdate();
      };
      dropdown.appendChild(item);
    });
  } else {
    dropdown?.classList.add("hidden");
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(manualRelicUpdate, 600);
}

export function manualRelicUpdate() {
  try {
    const relicInput = document.getElementById("relicInput");
    if (!relicInput) return;
    const inputVal = relicInput.value.trim().toUpperCase();
    const realName =
      state.allRelicNames.find((n) => n.toUpperCase() === inputVal) ||
      relicInput.value;
    state.selectedRelic = realName;

    const listDiv = document.getElementById("relic-drops-list");
    const container = document.getElementById("relic-contents");
    if (!listDiv || !container) return;

    if (state.selectedRelic && state.relicsDatabase[state.selectedRelic]) {
      container.classList.remove("hidden");
      renderRelicStatusBadge(state.selectedRelic);
      const items = [...state.relicsDatabase[state.selectedRelic]].sort(
        (a, b) => b.chance - a.chance,
      );
      const fragment = document.createDocumentFragment();
      items.forEach((item) => fragment.appendChild(createRelicDropRow(item)));
      listDiv.replaceChildren(fragment);
      generateMessage();
    } else {
      container.classList.add("hidden");
    }
  } catch (e) {
    console.error("Error en manualRelicUpdate:", e);
  }
}

function renderRelicStatusBadge(relicName) {
  const statusBadge = document.getElementById("relic-status-badge");
  if (!statusBadge) return;
  const status = state.relicStatusDB[relicName] || "vaulted";
  statusBadge.className = `badge ${status}`;
  statusBadge.style.display = "inline-block";
  if (status === "active" || status === "aya") {
    statusBadge.innerText = status === "aya" ? "AYA (RESURGENCE)" : "ACTIVE";
    statusBadge.dataset.tooltipHtml = globalThis.getRelicDropTooltip(relicName);
  } else {
    statusBadge.innerText = "VAULTED";
    statusBadge.dataset.tooltip = TEXTS[state.currentLang].vaulted;
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
        <a href="https://warframe.market/items/${getSlug(item.name)}" target="_blank" class="market-btn-mini" onclick="event.stopPropagation()" title="Warframe Market">MARKET</a>
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
      const isVaulted = vaultStatus === "vaulted";
      const statusClass = isVaulted ? "vaulted" : "active";
      const statusText = isVaulted ? "VAULTED" : "ACTIVE";
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
