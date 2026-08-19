import { state } from "../../state.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { TEXTS } from "../../config.js";
import { addToQueue } from "../../services/market/prices.service.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { escapeHTML, showToast } from "../ui_components.js";

import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  calculateTotalFullSets,
  DEFAULT_WEAPON_SVG,
} from "../../utils/ui_utils.js";
import {
  generateDotsHtml,
} from "../ui_tooltips.js";
import { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } from "../../utils/inventory/relic_drop_odds.utils.js";
import { getRelicCounts } from "../../utils/inventory/relic_counts.js";
import { fetchAllFissures } from "../../services/farms/fissures.service.js";
import {
  getFissureSetRecommendations,
  attachSetPrices,
  filterSetRecommendations,
  getSetRecsPrefs,
  saveSetRecsPrefs,
} from "../../services/inventory/set_recommendations.service.js";
import { buildSearchIndex, searchIndex } from "../../utils/fuzzy_search.js";
import { setInputLoading, showLoadingIn } from "../ui_loader.js";
import { createHelpButton, createTip } from "../ui_hints.js";
import { renderEmptySetsShowcase } from "./ui_sets_showcase.js";
import { renderSetsBridge, bridgeTargetFrom } from "./ui_sets_bridge.js";
import { renderSetTracker, updateMacroTracker } from "./ui_set_tracker.js";
let debounceTimer;
globalThis.DEFAULT_WEAPON_SVG = DEFAULT_WEAPON_SVG;
globalThis.DEFAULT_WEAPON_DATA_URL = "data:image/svg+xml;utf8," + encodeURIComponent(DEFAULT_WEAPON_SVG);


function selectShowcaseSet(setName) {
  const input = document.getElementById("setItemInput");
  if (input) {
    input.value = setName;
    searchSet();
  }
}
exposeGlobals({ selectShowcaseSet }, "ui.components/inventory/ui_sets.js");

// parts only: weapon and warframe names are not translated in game. The catalog is English
// (warframe.market) but people search "chasis de saryn".
export const SET_SEARCH_SYNONYMS = {
  // Warframes
  chasis: "chassis",
  sistema: "systems",
  sistemas: "systems",
  neuroptica: "neuroptics",
  neuropticas: "neuroptics",
  casco: "neuroptics",
  // generic
  plano: "blueprint",
  planos: "blueprint",
  proyecto: "blueprint",
  bp: "blueprint",
  // guns
  canon: "barrel",
  receptor: "receiver",
  culata: "stock",
  // melee
  hoja: "blade",
  hojas: "blade",
  cuchilla: "blade",
  mango: "handle",
  empunadura: "hilt",
  guarda: "guard",
  cabeza: "head",
  disco: "disc",
  // bows
  cuerda: "string",
  agarre: "grip",
  extremidad: "limb",
  inferior: "lower",
  superior: "upper",
  // sentinels and companions
  caparazon: "carapace",
  cerebro: "cerebrum",
  bolsa: "pouch",
  arnes: "harness",
  alas: "wings",
  cadena: "chain",
  estrella: "star",
  ornamento: "ornament",
  adorno: "ornament",
  guantelete: "gauntlet",
};

// under ~500 each key fires another price batch against the API
const SEARCH_DEBOUNCE_MS = 600;

// without a cap, "chassis" painted a couple hundred sets with their prices pending
const MAX_SET_CARDS = 12;
const MAX_SINGLE_CARDS = 10;

let _searchIndex = null;
let _searchIndexKeyCount = -1;

// reindexing ~4000 names per key is the only slow part on mobile: rebuilt only when the catalog size
// changes
function getSetSearchIndex() {
  const keys = Object.keys(state.itemsDatabase || {});
  if (!_searchIndex || _searchIndexKeyCount !== keys.length) {
    _searchIndex = buildSearchIndex(keys);
    _searchIndexKeyCount = keys.length;
  }
  return _searchIndex;
}

/** "Saryn Prime Chassis" -> "Saryn Prime"; null when it is not a groupable variant. */
function baseSetNameOf(itemName) {
  for (const variant of ["Prime", "Vandal", "Wraith"]) {
    const idx = itemName.indexOf(variant);
    if (idx !== -1) return `${itemName.slice(0, idx).trim()} ${variant}`.trim();
  }
  return null;
}

// without the "... Set" entry: the whole set is already in the card header
function partsOfSet(setName) {
  return Object.keys(state.itemsDatabase)
    .filter((k) => (k === setName || k.startsWith(`${setName} `)) && !k.endsWith(" Set"))
    .sort((a, b) => {
      if (a === setName) return -1;
      if (b === setName) return 1;
      return a.localeCompare(b);
    });
}

export function handleSetTyping() {
  clearTimeout(debounceTimer);

  const input = document.getElementById("setItemInput");
  const container = document.getElementById("setResults");
  const query = input?.value.trim() || "";

  if (query.length < 2) {
    setInputLoading(input, false);
    debounceTimer = setTimeout(searchSet, 120);
    return;
  }

  // without this signal the old results stay during the debounce and the app looks frozen
  setInputLoading(input, true);
  if (container) showLoadingIn(container, { skeleton: 3 });

  debounceTimer = setTimeout(searchSet, SEARCH_DEBOUNCE_MS);
}

export function searchSet() {
  const input = document.getElementById("setItemInput");
  const container = document.getElementById("setResults");
  if (!container) return;

  const query = (input?.value || "").trim();
  setInputLoading(input, false);
  container.innerHTML = "";

  if (query.length < 2) {
    // the bridge first and the carousel below: your half done sets matter more, but with an empty
    // inventory the carousel is all there is
    renderSetsBridge(container);
    renderEmptySetsShowcase(container, { append: true });
    return;
  }

  const t = TEXTS[state.currentLang];

  // covers the old substring filter (a literal match is always above the threshold) and tolerates free
  // order, typos, initials and Spanish
  const hits = searchIndex(query, getSetSearchIndex(), {
    synonyms: SET_SEARCH_SYNONYMS,
    threshold: 0.5,
  });

  // a set scores like its best part, so "chasis de saryn" puts the Saryn set on top
  const groups = new Map();
  const singles = [];

  for (const hit of hits) {
    const base = baseSetNameOf(hit.item);
    if (base) {
      const prev = groups.get(base);
      if (prev === undefined || hit.score > prev) groups.set(base, hit.score);
    } else if (singles.length < MAX_SINGLE_CARDS) {
      singles.push(hit.item);
    }
  }

  if (groups.size === 0 && singles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "set-search-empty";
    empty.textContent = t.setTab?.noResults || t.notFound;
    container.appendChild(empty);
    renderEmptySetsShowcase(container, { append: true });
    return;
  }

  const rankedSets = [...groups.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_SET_CARDS);

  // the whole set is painted even when one part matched: you want to see what the set lacks
  renderSetsBridge(container);

  rankedSets.forEach(([setName]) => {
    const parts = partsOfSet(setName);
    createSetCard(setName, parts.length > 0 ? parts : [setName], container, false);
  });

  singles.forEach((itemName) => createSetCard(itemName, [itemName], container, true));

  if (groups.size > rankedSets.length) {
    const more = document.createElement("div");
    more.className = "set-search-more";
    more.textContent = state.currentLang === "es"
      ? `Mostrando ${rankedSets.length} de ${groups.size} sets. Afina la búsqueda para ver el resto.`
      : `Showing ${rankedSets.length} of ${groups.size} sets. Narrow the search to see the rest.`;
    container.appendChild(more);
  }

  insertRelicTip(container, t);
}

// next to the first grid, where you act. Its own tip, not a data-tooltip: styles.css hides the global
// tooltip below 768px.
function insertRelicTip(container, t) {
  const firstGrid = container.querySelector(".relic-grid");
  if (!firstGrid) return;

  const tip = createTip({
    text: t.setTab?.relicTip || "Pulsa la reliquia que quieras abrir.",
    icon: "👆",
    storageKey: "vs_tip_set_relics",
  });
  if (tip) firstGrid.parentNode.insertBefore(tip, firstGrid);
}

// delegated on #setResults: the strip repaints on every search, and per chip listeners would dangle
// on the old DOM
function initSetsBridgeDelegation() {
  const container = document.getElementById("setResults");
  if (!container || container.dataset.bridgeWired) return;
  container.dataset.bridgeWired = "1";
  container.addEventListener("click", (e) => {
    const setName = bridgeTargetFrom(e.target);
    if (!setName) return;
    const input = document.getElementById("setItemInput");
    if (!input) return;
    input.value = setName;
    searchSet();
  });
}

export function initSetSearchHelp() {
  initSetsBridgeDelegation();
  const slot = document.getElementById("set-search-help");
  if (!slot) return;

  const t = TEXTS[state.currentLang]?.setTab || {};
  slot.replaceChildren(createHelpButton({
    title: t.helpTitle,
    body: [t.helpIntro, t.helpResults, t.helpRelics],
    label: t.helpAria,
    align: "left",
  }));
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
  const headerProgressHtml = isSingle ? "" : `<div class="macro-tracker" data-set="${escapeHTML(title)}" style="display:flex; align-items:center;"></div>`;

  const rightWrapper = document.createElement("div");
  rightWrapper.style.display = "flex";
  rightWrapper.style.alignItems = "center";
  rightWrapper.style.gap = "12px";

  if (headerProgressHtml) {
    const progressDiv = document.createElement("div");
    progressDiv.innerHTML = headerProgressHtml;
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

  // once per card, not per chip: it walks the whole inventory
  const owned = getRelicCounts();

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
    ${ducatVal > 0 ? `<span class="ducat-val" style="color:var(--wf-gold-text); font-size:0.85em; font-weight:bold;">${ducatVal} <img src="assets/Ducats.webp" class="ducat-icon"></span>` : ''}
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
      const setTabTexts = TEXTS[state.currentLang].setTab || {};

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

        // copies of THAT relic, inside the name span (the header is a two child space-between). Only when you
        // have some.
        const qty = owned[info.relic] || 0;
        const ownedHtml = qty > 0
            ? ` <span class="relic-owned" title="${escapeHTML((setTabTexts.relicOwned || "You own {n}").replace("{n}", qty))}">×${qty}</span>`
            : "";

        btn.innerHTML = `
            <div class="relic-chip-header">
                <span class="relic-name">${escapeHTML(info.relic)}${ownedHtml}</span>
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
          if (!isSingle) {
            const allParts = Object.keys(state.itemsDatabase).filter(
              (n) => (n === title || n.startsWith(title + " ")) && !n.endsWith(" Set")
            );
            activateSetTracker(title, allParts.length > 0 ? allParts : itemNames);
          }
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
    // deferred to avoid stutters when loading or adding sets
    requestAnimationFrame(() => updateMacroTracker(title));
  }
}

export function activateSetTracker(setName, itemsInSet) {
  state.currentActiveSet = setName;
  state.activeSetParts = itemsInSet;
  renderSetTracker();
}

function openSetFromRelicReward(partName) {
    const setName = getSetName(partName);
    if (setName === "Otros") return;
    // globalThis, not import: ui.js imports this module and the reverse would be a cycle
    globalThis.switchTab("set");
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
      import("../ui_components.js").then((m) => m.showToast(
      (TEXTS[state.currentLang]?.setTab?.trackingToast || "Tracking {set}").replace("{set}", setName)));
    }
}

exposeGlobals({
  handleSetTyping,
  searchSet,
  updateMacroTracker,
  renderSetTracker,
  activateSetTracker,
  openSetFromRelicReward,
}, "ui.components/inventory/ui_sets.js");

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
        import("../../utils/ui_utils.js").then((m) => {
          const setName = m.getSetName(itemName);
          if (setName !== "Otros") {
            const allParts = Object.keys(state.itemsDatabase).filter(
              (n) => (n === setName || n.startsWith(setName + " ")) && !n.endsWith(" Set")
            );
            activateSetTracker(setName, allParts);
            import("../ui_components.js").then((c) => c.showToast(
              (TEXTS[state.currentLang]?.setTab?.trackingToast || "Tracking {set}").replace("{set}", setName)));
          }
        });
      }
    });
  }
}, 500);
