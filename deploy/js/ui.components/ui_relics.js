import { state, saveAppState } from "../state.js";
import { TEXTS, DROP_CHANCES } from "../config.js";
import { addToQueue } from "../api.js";
import { escapeHTML, showToast } from "./ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
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

function createRelicDropRow(item) {
  const row = document.createElement("div");
  row.className = "component-row";
  const isUntradable =
    item.name.includes("Forma Blueprint") ||
    item.name.includes("Kuva") ||
    item.name === "Riven Sliver";

  let rarityKey =
    item.chance <= 5 ? "rare" : item.chance <= 11 ? "uncommon" : "common";
  if (isUntradable) rarityKey = "forma";
  row.dataset.rarity = rarityKey;

  const setName = getSetName(item.name);
  const dots =
    setName !== "Otros"
      ? generateDotsHtml(
          state.primeInventory[item.name] || 0,
          getRequiredCount(setName, item.name),
        )
      : "";

  row.innerHTML = `
    <div class="component-info">
      <span class="rarity-indicator">${TEXTS[state.currentLang].rarityAbbr[rarityKey] || ""}</span>
      <div class="name-wrapper">
        <img src="${getItemIcon(item.name)}" class="item-icon-mini item-interactive" onclick="event.stopPropagation(); globalThis.openSetFromRelicReward('${escapeHTML(item.name)}')">
        <div class="name-column">${escapeHTML(item.name)}${dots}</div>
      </div>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="ducat-val">${item.ducats || 0} <span class="ducat-symbol">d</span></span>
      <div class="price-badge ${isUntradable ? "untradable" : "loading"}" data-item="${escapeHTML(item.name)}">${isUntradable ? "0" : "..."}</div>
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
      parseInt(
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
    disp.innerHTML = `<div style="text-align:right"><span>~${totalEV.toFixed(1)}<img src="assets/relic_contents/platinum.webp" class="plat-icon"></span><br><span style="font-size:0.7em; color:var(--wf-gold-text)">~${ducatEV.toFixed(1)} ducats</span></div>`;
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
      btn.innerHTML = `<div class="relic-chip-header"><span>${info.relic}</span><span class="relic-era-icon ${tier}"></span></div>`;
      btn.onclick = () => {
        state.selectedRelic = info.relic;
        document.getElementById("relicInput").value = info.relic;
        manualRelicUpdate();
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
