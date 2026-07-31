import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { addToQueue, getSlug } from "../api.js";
import { escapeHTML, showToast } from "./ui_components.js";

import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  generateDotsHtml,
  calculateTotalFullSets,
  DEFAULT_WEAPON_SVG
} from "../utils/ui_utils.js";
import { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } from "../utils/relic_drop_odds.utils.js";
import { fetchAllFissures } from "../services/fissures.service.js";
import {
  getFissureSetRecommendations,
  attachSetPrices,
  filterSetRecommendations,
  getSetRecsPrefs,
  saveSetRecsPrefs,
} from "../services/set_recommendations.service.js";
let debounceTimer;
let cachedShowcasePools = null;
let _lastSetRecs = [];
let _setRecsLoaded = false;
globalThis.DEFAULT_WEAPON_SVG = DEFAULT_WEAPON_SVG;
globalThis.DEFAULT_WEAPON_DATA_URL = "data:image/svg+xml;utf8," + encodeURIComponent(DEFAULT_WEAPON_SVG);

function renderEmptySetsShowcase(container) {
  const isEs = state.currentLang === "es";

  // Dynamically resolve prime items from the database
  let poolWarframes = [];
  let poolPrimaries = [];
  let poolMelees = [];

  if (cachedShowcasePools) {
    poolWarframes = cachedShowcasePools.poolWarframes;
    poolPrimaries = cachedShowcasePools.poolPrimaries;
    poolMelees = cachedShowcasePools.poolMelees;
  } else {
    try {
      const dbKeys = Object.keys(state.itemsDatabase || {});
      if (dbKeys.length > 0) {
        // Extract unique prime set names (e.g. "Wisp Prime", "Braton Prime")
        const uniqueSetNames = Array.from(new Set(
          dbKeys.map(k => getSetName(k)).filter(name => name && name.endsWith(" Prime"))
        )).sort((a, b) => a.localeCompare(b));

        const manifest = state.primeManifest || [];
        const weapons = state.weaponDetailsDB || [];

        uniqueSetNames.forEach(setName => {
          // 1. Check in entities/manifest (Warframes & Sentinels)
          const entity = manifest.find(i => i.name === setName);
          if (entity) {
            if (entity.type === "Warframe") {
              poolWarframes.push(setName);
            } else {
              poolPrimaries.push(setName); // Sentinels / Companions go to poolPrimaries
            }
            return;
          }

          // 2. Check in weapons database
          const weapon = weapons.find(i => i.name === setName);
          if (weapon) {
            if (weapon.type === "Melee") {
              poolMelees.push(setName);
            } else if (["Pistol", "Dual Pistols", "Throwing"].includes(weapon.type)) {
              poolMelees.push(setName); // Group secondaries with Melees for balanced columns
            } else {
              poolPrimaries.push(setName); // Primaries (Rifle, Shotgun, Bow, Sniper, Arch-Gun) go to poolPrimaries
            }
            return;
          }

          // 3. Fallback name heuristics if database entries aren't fully resolved yet
          const lower = setName.toLowerCase();
          if (lower.includes("carrier") || lower.includes("helios") || lower.includes("wyrm") || lower.includes("dethcube") || lower.includes("nautilus") || lower.includes("shade") || lower.includes("oxylus") || lower.includes("diriga") || lower.includes("djinn") || lower.includes("taxon")) {
            poolPrimaries.push(setName);
          } else if (lower.includes("lex") || lower.includes("pyrana") || lower.includes("ak") || lower.includes("vasto") || lower.includes("bronco") || lower.includes("magnus") || lower.includes("sicarus") || lower.includes("zylok") || lower.includes("knell") || lower.includes("velox") || lower.includes("pandero") || lower.includes("afuris") || lower.includes("aksomati") || lower.includes("akstiletto") || lower.includes("lato") || lower.includes("spira") || lower.includes("hikou")) {
            poolMelees.push(setName);
          } else {
            poolPrimaries.push(setName);
          }
        });

        // Cache the categorized pools for all future renders
        cachedShowcasePools = { poolWarframes, poolPrimaries, poolMelees };
      }
    } catch (err) {
      console.error("Error dynamically building empty sets showcase pools:", err);
    }
  }

  // Absolute hardcoded fallbacks in case database is empty or still loading on startup
  if (poolWarframes.length === 0) {
    poolWarframes = [
      "Xaku Prime",
      "Wisp Prime",
      "Saryn Prime",
      "Mesa Prime",
      "Volt Prime",
      "Rhino Prime",
      "Nekros Prime",
      "Nova Prime"
    ];
  }
  if (poolPrimaries.length === 0) {
    poolPrimaries = [
      "Braton Prime",
      "Burston Prime",
      "Boltor Prime",
      "Soma Prime",
      "Acceltra Prime",
      "Carrier Prime",
      "Helios Prime",
      "Wyrm Prime"
    ];
  }
  if (poolMelees.length === 0) {
    poolMelees = [
      "Glaive Prime",
      "Orthos Prime",
      "Kronen Prime",
      "Nikana Prime",
      "Guandao Prime",
      "Pangolin Prime",
      "Lex Prime",
      "Pyrana Prime"
    ];
  }

  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const c1 = shuffle(poolWarframes).slice(0, 10);
  const doubleSets1 = [...c1, ...c1];

  const c2 = shuffle(poolPrimaries).slice(0, 10);
  const doubleSets2 = [...c2, ...c2];

  const c3 = shuffle(poolMelees).slice(0, 10);
  const doubleSets3 = [...c3, ...c3];

  const renderColumnCards = (setsList, colId) => {
    let html = "";
    const len = setsList.length;
    for (let i = 0; i < len; i++) {
      const setName = setsList[i];
      let icon = getItemIcon(setName) || globalThis.DEFAULT_WEAPON_DATA_URL;
      if (icon.startsWith("<svg")) {
        icon = "data:image/svg+xml;utf8," + encodeURIComponent(icon);
      }
      const safeIcon = icon.replace(/"/g, '&quot;');
      html += `
        <div class="showcase-card" id="set-showcase-card-${colId}-${i}" onclick="globalThis.selectShowcaseSet('${setName}')">
          <img class="showcase-img" src="${safeIcon}" onerror="this.onerror=null; this.src=globalThis.DEFAULT_WEAPON_DATA_URL;" loading="lazy">
          <span class="showcase-name">${setName}</span>
        </div>
      `;
    }
    return html;
  };

  const col1Html = renderColumnCards(doubleSets1, 1);
  const col2Html = renderColumnCards(doubleSets2, 2);
  const col3Html = renderColumnCards(doubleSets3, 3);

  container.innerHTML = `
    <style>
      .showcase-card {
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 15px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        box-sizing: border-box;
        transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        cursor: pointer;
      }
      .showcase-card:hover {
        background: rgba(0, 229, 255, 0.08) !important;
        border-color: rgba(0, 229, 255, 0.35) !important;
        box-shadow: 0 0 15px rgba(0, 229, 255, 0.2);
      }
      .showcase-card:hover .showcase-img {
        transform: scale(1.15);
      }
      .showcase-img {
        width: 90px;
        height: 56px;
        object-fit: contain;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .showcase-name {
        font-size: 0.72rem;
        font-weight: bold;
        margin-top: 10px;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
      }
    </style>
    <div class="empty-showcase-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; box-sizing: border-box; text-align: center; border-top: 1px solid rgba(255,255,255,0.03); margin-top: 30px; width: 100%;">
      <div style="font-size: 1.15rem; font-weight: 800; color: var(--wf-gold-text); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1.5px; text-shadow: 0 0 10px rgba(0, 229, 255, 0.15);">
        ${isEs ? "SETS POPULARES" : "PRIME SETS"}
      </div>
      <div style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 25px;">
        ${isEs ? "Selecciona un set popular para ver sus componentes y precios" : "Select a PRIME set to view its components and pricing"}
      </div>
      
      <div class="ticker-grid-expanded">
        <div class="ticker-column-large">
          ${col1Html}
        </div>
        <div class="ticker-column-large">
          ${col2Html}
        </div>
        <div class="ticker-column-large">
          ${col3Html}
        </div>
      </div>
    </div>
  `;
}

globalThis.selectShowcaseSet = function (setName) {
  const input = document.getElementById("setItemInput");
  if (input) {
    input.value = setName;
    searchSet();
  }
};

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
  if (query.length < 2) {
    renderEmptySetsShowcase(container);
    return;
  }

  const dbKeys = Object.keys(state.itemsDatabase);
  const matches = dbKeys.filter((k) => k.toLowerCase().includes(query)).sort((a, b) => a.localeCompare(b));
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
    .sort((a, b) => a.localeCompare(b))
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
    // Populate , this works to avoid stutters when loading or adding sets 
    requestAnimationFrame(() => updateMacroTracker(title));
  }
}

export function activateSetTracker(setName, itemsInSet) {
  state.currentActiveSet = setName;
  state.activeSetParts = itemsInSet;
  renderSetTracker();
}

const SIM_TEXTS = {
  es: {
    allPartsLabel: "este Set completo",
    radiantName: "Radiante",
    flawlessName: "Fabulosa",
    exceptionalName: "Excepcional",
    intactName: "Intacta",
    radiant: "Radiante (100t)",
    flawless: "Fabulosa (50t)",
    exceptional: "Excepcional (25t)",
    intact: "Intacta (0t)",
    squad4: "4 jugadores",
    squad3: "3 jugadores",
    squad2: "2 jugadores",
    squad1: "1 jugador",
    allParts: "Todas las Piezas (Set)",
    runsEstTitle: "Runs promedio estimados para conseguir 1 copia de esta pieza",
    setComplete: "Set Completo",
    runsFormat: "~{n} runs",
    partDone: "Listo",
    partRunsTitle: "Promedio estimado: ~{runs} runs para 1 copia",
    descText: "De media obtienes <strong>{targetName}</strong> en <strong>~{avgRuns} runs</strong> jugando con <strong>{players} jugador(es)</strong> usando reliquia <strong>{refName}</strong>.",
    rangeText: "Caso Mejor: <strong>{bestRuns} run(s)</strong> | Promedio: <strong>~{avgRuns} runs</strong> | Caso Peor (95% suerte): <strong>~{worstRuns} runs</strong>.",
  },
  en: {
    allPartsLabel: "this whole Set",
    radiantName: "Radiant",
    flawlessName: "Flawless",
    exceptionalName: "Exceptional",
    intactName: "Intact",
    radiant: "Radiant (100t)",
    flawless: "Flawless (50t)",
    exceptional: "Exceptional (25t)",
    intact: "Intact (0t)",
    squad4: "4 players",
    squad3: "3 players",
    squad2: "2 players",
    squad1: "1 player",
    allParts: "All Parts (Whole Set)",
    runsEstTitle: "Estimated average runs to get 1 copy of this part",
    setComplete: "Set Complete",
    runsFormat: "~{n} runs",
    partDone: "Done",
    partRunsTitle: "Estimated average: ~{runs} runs for 1 copy",
    descText: "On average you obtain <strong>{targetName}</strong> in <strong>~{avgRuns} runs</strong> playing with <strong>{players} player(s)</strong> using <strong>{refName}</strong> relics.",
    rangeText: "Best Case: <strong>{bestRuns} run(s)</strong> | Average: <strong>~{avgRuns} runs</strong> | Worst Case (95% luck): <strong>~{worstRuns} runs</strong>.",
  }
};

export function getPartShortName(partName, setName) {
  if (!partName) return "";
  const langBP = TEXTS[state.currentLang]?.lblBlueprint || "Blueprint";
  if (!setName) return partName;
  if (partName === setName) return langBP;
  if (partName.startsWith(setName)) {
    const trimmed = partName.substring(setName.length).trim();
    return trimmed || langBP;
  }
  return partName;
}

export { getPartRarity, calculatePartExpectedRuns };

export function calculateSetStats(refinement, squadSize, targetPart) {
  const pName = (targetPart && targetPart !== "all")
    ? targetPart
    : (state.selectedTrackerPart || (state.activeSetParts && state.activeSetParts[0]));

  if (!pName) {
    return { avgRuns: 0, bestRuns: 0, worstRuns: 0 };
  }

  const rarity = getPartRarity(pName);
  const pSingle = DROP_RATES_BY_RARITY[rarity]?.[refinement] || 0.10;
  const pSquad = 1 - Math.pow(1 - pSingle, squadSize);

  if (pSquad <= 0) {
    return { avgRuns: 0, bestRuns: 0, worstRuns: 0 };
  }

  const avgRuns = 1 / pSquad;
  const worstRuns = Math.ceil(Math.log(0.05) / Math.log(1 - pSquad));

  return {
    avgRuns,
    bestRuns: 1,
    worstRuns,
  };
}

export function calculateSetTotalExpectedRuns(refinement, squadSize, targetPart = "all") {
  return calculateSetStats(refinement, squadSize, targetPart).avgRuns;
}

globalThis.updateTrackerSim = function (refinement, squadSize, targetPart) {
  if (refinement) state.trackerRefinement = refinement;
  if (squadSize) state.trackerSquadSize = parseInt(squadSize, 10);
  if (targetPart !== undefined) state.selectedTrackerPart = targetPart;

  const summaryWrapper = document.getElementById("tracker-runs-summary-wrapper");
  const explanationWrapper = document.getElementById("tracker-explanation-wrapper");

  if (summaryWrapper && explanationWrapper) {
    const lang = state.currentLang === "es" ? "es" : "en";
    const st = SIM_TEXTS[lang];
    const t = TEXTS[state.currentLang];

    const stats = calculateSetStats(state.trackerRefinement, state.trackerSquadSize, state.selectedTrackerPart);
    const relicImgHtml = `<img src="assets/relic.webp" style="width:14px; height:14px; object-fit:contain; vertical-align:middle; margin-right:3px;">`;

    summaryWrapper.innerHTML = stats.avgRuns > 0
      ? `<div class="tracker-runs-summary-badge" title="${st.runsEstTitle}">${relicImgHtml} ${st.runsFormat.replace("{n}", stats.avgRuns.toFixed(1))}</div>`
      : `<div class="tracker-runs-summary-badge" style="background:rgba(66,245,108,0.15); border-color:rgba(66,245,108,0.5); color:#81c784;">${st.setComplete}</div>`;

    const targetLabel = getPartShortName(state.selectedTrackerPart, state.currentActiveSet);

    const refNameKey = `${state.trackerRefinement}Name`;
    const refNameStr = st[refNameKey] || state.trackerRefinement;

    explanationWrapper.innerHTML = stats.avgRuns > 0
      ? `<div class="tracker-explanation-card">
           <div class="tracker-explanation-text">
             ${st.descText.replace("{targetName}", escapeHTML(targetLabel)).replace("{avgRuns}", stats.avgRuns.toFixed(1)).replace("{players}", state.trackerSquadSize).replace("{refName}", refNameStr)}
           </div>
           <div class="tracker-range-text">
             ${st.rangeText.replace("{bestRuns}", stats.bestRuns).replace("{avgRuns}", stats.avgRuns.toFixed(1)).replace("{worstRuns}", stats.worstRuns)}
           </div>
         </div>`
      : `<div class="tracker-explanation-card" style="border-color:rgba(66,245,108,0.3);">
           <div class="tracker-explanation-text" style="color:#81c784;">
             ${st.setComplete} (${escapeHTML(targetLabel)})
           </div>
         </div>`;

    document.querySelectorAll(".tracker-item").forEach((row) => {
      const pName = row.dataset.partName;
      if (pName) {
        if (pName === state.selectedTrackerPart) {
          row.classList.add("selected-tracker-part");
        } else {
          row.classList.remove("selected-tracker-part");
        }
        const owned = state.primeInventory[pName] || 0;
        const req = getRequiredCount(state.currentActiveSet, pName);
        const missing = Math.max(0, req - owned);
        const partRuns = missing > 0 ? calculatePartExpectedRuns(pName, state.trackerRefinement, state.trackerSquadSize) : 0;
        const partRunsSpan = row.querySelector(".part-runs-badge");
        if (partRunsSpan) {
          const partTitleTpl = st?.partRunsTitle || "Promedio estimado: ~{runs} runs para 1 copia";
          const partDoneTxt = st?.partDone || "Listo";
          const runsFmtTpl = st?.runsFormat || "~{n} runs";
          partRunsSpan.title = missing > 0 ? partTitleTpl.replace("{runs}", partRuns.toFixed(1)) : partDoneTxt;
          partRunsSpan.innerHTML = missing > 0 ? `${relicImgHtml} ${runsFmtTpl.replace("{n}", partRuns.toFixed(1))}` : partDoneTxt;
        }
      }
    });
  } else {
    renderSetTracker();
  }
};

export function renderSetTracker() {
  const container = document.getElementById("set-tracker");
  const list = document.getElementById("tracker-list");
  const title = document.getElementById("tracker-title");
  const t = TEXTS[state.currentLang];
  const lang = state.currentLang === "es" ? "es" : "en";
  const st = SIM_TEXTS[lang];

  if (!state.currentActiveSet) {
    container.style.display = "none";
    return;
  }

  // Garantizar que siempre se muestren TODAS las piezas del Set juntas al mismo tiempo
  if (state.currentActiveSet && state.itemsDatabase) {
    const fullParts = Object.keys(state.itemsDatabase).filter(
      (n) => (n === state.currentActiveSet || n.startsWith(state.currentActiveSet + " ")) && !n.endsWith(" Set")
    );
    if (fullParts.length > 0) {
      state.activeSetParts = fullParts;
    }
  }

  container.style.display = "block";
  list.innerHTML = "";

  state.trackerRefinement = state.trackerRefinement || "radiant";
  state.trackerSquadSize = state.trackerSquadSize || 4;
  if (!state.selectedTrackerPart || state.selectedTrackerPart === "all" || !state.activeSetParts.includes(state.selectedTrackerPart)) {
    state.selectedTrackerPart = state.activeSetParts[0] || "";
  }

  const setSlug = getSlug(state.currentActiveSet + " Set");
  const setUrl = `https://warframe.market/items/${setSlug}`;

  const setIcon = getItemIcon(state.currentActiveSet + " Set") || "";
  const setIconHtml = setIcon
    ? `<img src="${setIcon}" style="width:36px; height:36px; object-fit:contain; filter:drop-shadow(0 0 5px rgba(200,150,50,0.5));">`
    : "";

  const stats = calculateSetStats(state.trackerRefinement, state.trackerSquadSize, state.selectedTrackerPart);
  const totalFullSets = calculateTotalFullSets(state.currentActiveSet);

  const badgeColor = totalFullSets > 0 ? "var(--wf-gold-text)" : "#666";
  const badgeBg = totalFullSets > 0 ? "rgba(221,169,56,0.15)" : "rgba(100,100,100,0.1)";
  const badgeBorder = totalFullSets > 0 ? "rgba(221,169,56,0.3)" : "rgba(100,100,100,0.2)";
  const setBadge = `<span style="color:${badgeColor}; font-weight:bold; font-size:0.8em; background:${badgeBg}; border:1px solid ${badgeBorder}; padding:2px 6px; border-radius:4px; text-transform:uppercase; white-space:nowrap; text-align:center;">(${totalFullSets} ${t.countMsg || "Sets"})</span>`;

  const relicImgHtml = `<img src="assets/relic.webp" style="width:14px; height:14px; object-fit:contain; vertical-align:middle; margin-right:3px;">`;

  const runsBadgeHtml = stats.avgRuns > 0
    ? `<div class="tracker-runs-summary-badge" title="${st.runsEstTitle}">${relicImgHtml} ${st.runsFormat.replace("{n}", stats.avgRuns.toFixed(1))}</div>`
    : `<div class="tracker-runs-summary-badge" style="background:rgba(66,245,108,0.15); border-color:rgba(66,245,108,0.5); color:#81c784;">${st.setComplete}</div>`;

  const partOptionsHtml = state.activeSetParts.map((pName) => {
    const pLabel = pName === state.currentActiveSet
      ? (t.lblBlueprint || "Blueprint")
      : pName.replaceAll(state.currentActiveSet, "").trim();
    const isSel = state.selectedTrackerPart === pName ? 'selected' : '';
    return `<option value="${escapeHTML(pName)}" ${isSel}>${escapeHTML(pLabel)}</option>`;
  }).join("");

  const targetLabel = getPartShortName(state.selectedTrackerPart, state.currentActiveSet);

  const refNameKey = `${state.trackerRefinement}Name`;
  const refNameStr = st[refNameKey] || state.trackerRefinement;

  const explanationHtml = stats.avgRuns > 0
    ? `<div class="tracker-explanation-card">
         <div class="tracker-explanation-text">
           ${st.descText.replace("{targetName}", escapeHTML(targetLabel)).replace("{avgRuns}", stats.avgRuns.toFixed(1)).replace("{players}", state.trackerSquadSize).replace("{refName}", refNameStr)}
         </div>
         <div class="tracker-range-text">
           ${st.rangeText.replace("{bestRuns}", stats.bestRuns).replace("{avgRuns}", stats.avgRuns.toFixed(1)).replace("{worstRuns}", stats.worstRuns)}
         </div>
       </div>`
    : `<div class="tracker-explanation-card" style="border-color:rgba(66,245,108,0.3);">
         <div class="tracker-explanation-text" style="color:#81c784;">
           ${st.setComplete} (${escapeHTML(targetLabel)})
         </div>
       </div>`;

  title.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; line-height:1; width:100%; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span data-tooltip="${t.tooltipTracker}" style="color:#888; text-transform:uppercase; letter-spacing:1px; font-weight:800; font-size:0.75em; cursor:help;">${t.trackerTitle}:</span> 
        ${setIconHtml}
        <a href="${setUrl}" target="_blank" class="set-header-link" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
          <span style="font-weight:bold; font-size:1.15em; color:var(--wf-gold-text); filter:drop-shadow(0 2px 4px rgba(221,169,56,0.3));">${state.currentActiveSet}</span>
        </a>
        ${setBadge}
      </div>

      <div class="tracker-sim-controls" onclick="event.stopPropagation()">
        <select id="tracker-part-sel" class="tracker-sim-select" onchange="globalThis.updateTrackerSim(null, null, this.value)">
          ${partOptionsHtml}
        </select>

        <select id="tracker-refinement-sel" class="tracker-sim-select" onchange="globalThis.updateTrackerSim(this.value, null, null)">
          <option value="radiant" ${state.trackerRefinement === 'radiant' ? 'selected' : ''}>${st.radiant}</option>
          <option value="flawless" ${state.trackerRefinement === 'flawless' ? 'selected' : ''}>${st.flawless}</option>
          <option value="exceptional" ${state.trackerRefinement === 'exceptional' ? 'selected' : ''}>${st.exceptional}</option>
          <option value="intact" ${state.trackerRefinement === 'intact' ? 'selected' : ''}>${st.intact}</option>
        </select>

        <select id="tracker-squad-sel" class="tracker-sim-select" onchange="globalThis.updateTrackerSim(null, this.value)">
          <option value="4" ${state.trackerSquadSize === 4 ? 'selected' : ''}>${st.squad4}</option>
          <option value="3" ${state.trackerSquadSize === 3 ? 'selected' : ''}>${st.squad3}</option>
          <option value="2" ${state.trackerSquadSize === 2 ? 'selected' : ''}>${st.squad2}</option>
          <option value="1" ${state.trackerSquadSize === 1 ? 'selected' : ''}>${st.squad1}</option>
        </select>

        <span id="tracker-runs-summary-wrapper">${runsBadgeHtml}</span>
      </div>
    </div>
    <div id="tracker-explanation-wrapper">${explanationHtml}</div>
  `;

  state.activeSetParts.forEach((partName) => {
    const wrapper = document.createElement("div");
    const ownedCount = state.primeInventory[partName] || 0;
    const requiredCount = getRequiredCount(state.currentActiveSet, partName);
    const missing = Math.max(0, requiredCount - ownedCount);

    const row = document.createElement("div");
    row.className = state.selectedTrackerPart === partName ? "tracker-item selected-tracker-part" : "tracker-item";
    row.dataset.partName = partName;

    const nameText =
      partName === state.currentActiveSet
        ? (t.lblBlueprint || "Blueprint")
        : partName.replaceAll(state.currentActiveSet, "").trim();

    const partSlug = getSlug(partName);
    const partIcon = getItemIcon(partName) || "";
    const imgWrapper = document.createElement("div");
    imgWrapper.className = "tracker-img-wrapper";
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
        row.style.zIndex = "1000";
        imgWrapper.style.zIndex = "100000";
        hoverTimer = setTimeout(() => {
          const drawer = row.nextElementSibling;
          if (drawer?.classList.contains("hidden")) {
            row.click();
          }
        }, 500);
      };
      imgEl.onmouseleave = () => {
        row.style.zIndex = "";
        imgWrapper.style.zIndex = "";
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
    row.style.cursor = "pointer";

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
    arrowLink.style.flexShrink = "0";
    arrowLink.onclick = (e) => e.stopPropagation();

    // Runs badge por pieza con icono .webp y traducciones (por 1 copia)
    const partRuns = missing > 0
      ? calculatePartExpectedRuns(partName, state.trackerRefinement, state.trackerSquadSize)
      : 0;
    const partRunsSpan = document.createElement("span");
    partRunsSpan.className = missing > 0 ? "part-runs-badge" : "part-runs-badge done";
    const partTitleTpl = st?.partRunsTitle || "Promedio estimado: ~{runs} runs para 1 copia";
    const partDoneTxt = st?.partDone || "Listo";
    const runsFmtTpl = st?.runsFormat || "~{n} runs";

    partRunsSpan.title = missing > 0
      ? partTitleTpl.replace("{runs}", partRuns.toFixed(1))
      : partDoneTxt;
    partRunsSpan.innerHTML = missing > 0 ? `${relicImgHtml} ${runsFmtTpl.replace("{n}", partRuns.toFixed(1))}` : partDoneTxt;

    const dotsDiv = document.createElement("div");
    dotsDiv.className = "live-tracker";
    dotsDiv.dataset.part = partName;
    dotsDiv.dataset.req = requiredCount;
    dotsDiv.style.display = "flex";
    dotsDiv.style.alignItems = "center";
    dotsDiv.style.flexShrink = "0";
    dotsDiv.style.justifyContent = "flex-end";
    dotsDiv.innerHTML = generateDotsHtml(ownedCount, requiredCount);

    const ducatsSpan = document.createElement("span");
    const dVal = state.itemsDatabase[partName] ? state.itemsDatabase[partName][0].ducats : 0;

    if (dVal > 0) {
      ducatsSpan.style.color = "var(--wf-gold-text)";
      ducatsSpan.style.fontSize = "0.8em";
      ducatsSpan.style.fontWeight = "bold";
      ducatsSpan.style.display = "flex";
      ducatsSpan.style.alignItems = "center";
      ducatsSpan.style.justifyContent = "flex-end";
      ducatsSpan.style.flexShrink = "0";
      ducatsSpan.innerHTML = `${dVal}&nbsp;<img src="assets/Ducats.webp" class="ducat-icon" style="width:14px; height:14px; object-fit:contain;">`;
    }

    const controlsDiv = document.createElement("div");
    controlsDiv.style.display = "flex";
    controlsDiv.style.alignItems = "center";
    controlsDiv.style.justifyContent = "flex-end";
    controlsDiv.style.flexShrink = "0";
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
    row.appendChild(partRunsSpan);
    row.appendChild(dotsDiv);
    row.appendChild(ducatsSpan);
    row.appendChild(controlsDiv);

    const drawer = document.createElement("div");
    drawer.className = "tracker-drawer hidden";

    row.onclick = () => {
      state.selectedTrackerPart = partName;
      const partSel = document.getElementById("tracker-part-sel");
      if (partSel) partSel.value = partName;
      document.querySelectorAll(".tracker-item").forEach((r) => r.classList.remove("selected-tracker-part"));
      row.classList.add("selected-tracker-part");

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
        import("../utils/ui_utils.js").then((m) => {
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

// Ver MAINTENANCE_FISSURE_SET_RECS.md
const MAX_SET_RECS = 12;

function renderSetRecGuide(t) {
  const guideTitle = t.fissureSetRecs?.guideTitle || "¿Cómo funciona esto?";
  const guideText = t.fissureSetRecs?.guideText ||
    "Cruza las fisuras activas ahora mismo con los sets Prime que te faltan. Por cada pieza que te falta muestra: en qué fisura activa puede caer, los runs promedio esperados para conseguirla (radiante, 4 jugadores), y su precio de compra suelta en el mercado. Si comprarla sale claramente más barato que farmearla, aparece marcada.";

  return `
    <details class="set-rec-guide">
      <summary>${escapeHTML(guideTitle)}</summary>
      <p>${escapeHTML(guideText)}</p>
    </details>`;
}

function renderSetRecFilters(prefs, t) {
  const maxMissingLabel = t.fissureSetRecs?.maxMissing || "Máx. piezas restantes";
  const buyOnlyLabel = t.fissureSetRecs?.buyOnlyFilter || "Solo donde sale a cuenta comprar";
  const anyLabel = t.fissureSetRecs?.anyMissing || "Cualquiera";
  const filtersTitle = t.fissureSetRecs?.filtersTitle || "Filtros";
  const maxMissingHelp = t.fissureSetRecs?.maxMissingHelp ||
    "Muestra solo sets a los que les falten como mucho esas piezas. Útil para centrarte en los que casi tienes terminados.";
  const buyOnlyHelp = t.fissureSetRecs?.buyOnlyHelp ||
    "Deja solo las piezas cuyo precio en el mercado es más barato que el coste estimado de farmearlas.";
  const moreMissionsHint = t.fissureSetRecs?.moreMissionsHint ||
    "¿Faltan misiones? Los tipos de misión que ves aquí dependen de tus filtros de fisuras. Ábrelos en el panel de Fisuras → Filtros para añadir más.";

  return `
    <div class="set-rec-filters">
      <span class="set-rec-filters-title">${escapeHTML(filtersTitle)}</span>

      <div class="set-rec-filter-row">
        <label class="set-rec-filter-label" for="set-rec-filter-missing">${escapeHTML(maxMissingLabel)}</label>
        <select id="set-rec-filter-missing" class="alarm-select" aria-describedby="set-rec-filter-missing-help">
          <option value="0" ${prefs.maxMissing === 0 ? "selected" : ""}>${escapeHTML(anyLabel)}</option>
          <option value="1" ${prefs.maxMissing === 1 ? "selected" : ""}>1</option>
          <option value="2" ${prefs.maxMissing === 2 ? "selected" : ""}>&le; 2</option>
          <option value="3" ${prefs.maxMissing === 3 ? "selected" : ""}>&le; 3</option>
        </select>
        <small class="set-rec-filter-help" id="set-rec-filter-missing-help">${escapeHTML(maxMissingHelp)}</small>
      </div>

      <div class="set-rec-filter-row">
        <label class="lfg-checkbox-wrapper">
          <input type="checkbox" id="set-rec-filter-buy" ${prefs.buyOnly ? "checked" : ""}
                 aria-describedby="set-rec-filter-buy-help">
          <span class="lfg-label">${escapeHTML(buyOnlyLabel)}</span>
        </label>
        <small class="set-rec-filter-help" id="set-rec-filter-buy-help">${escapeHTML(buyOnlyHelp)}</small>
      </div>

      <p class="set-rec-more-missions">${escapeHTML(moreMissionsHint)}</p>
    </div>`;
}

function renderSetRecCards(recs, t) {
  const missingLabel = t.fissureSetRecs?.missing || "faltan";
  const runsLabel = t.fissureSetRecs?.runsShort || "runs";
  const buyBadgeLabel = t.fissureSetRecs?.buyBadge || "Sale más a cuenta comprarla";
  const buyPriceLabel = t.fissureSetRecs?.buyPrice || "Comprar";
  const emptyLabel = t.fissureSetRecs?.emptyFiltered || "Ningún set coincide con estos filtros.";

  if (recs.length === 0) {
    return `<div class="set-rec-empty">${escapeHTML(emptyLabel)}</div>`;
  }

  return recs.map((rec) => {
    const platText = rec.setPricePlat > 0 ? ` · ${Math.round(rec.setPricePlat)}p` : "";
    const partsHtml = rec.matches.map((m) => {
      const shortName = escapeHTML(getPartShortName(m.part, rec.setName));
      const nodesHtml = m.fissures.slice(0, 3).map((f) => {
        const typeLabel = t.modes[f.type.toLowerCase()] || f.type;
        return `<span class="set-rec-node" data-expiry="${f.expiry}">${escapeHTML(f.node)} <em>(${escapeHTML(typeLabel)})</em></span>`;
      }).join("");
      const runsText = Number.isFinite(m.avgRuns) ? `~${m.avgRuns.toFixed(1)} ${runsLabel}` : "";
      const buyText = m.buyPricePlat > 0 ? `${buyPriceLabel}: ${Math.round(m.buyPricePlat)}p` : "";
      const buyBadge = m.betterToBuy ? `<span class="set-rec-buy-badge">${escapeHTML(buyBadgeLabel)}</span>` : "";
      return `
        <div class="set-rec-part">
          <div class="set-rec-part-top">
            <span class="set-rec-part-name">${shortName}</span>
            <span class="set-rec-part-stats">${escapeHTML(runsText)}${buyText ? ` · ${escapeHTML(buyText)}` : ""}</span>
            ${buyBadge}
          </div>
          <div class="set-rec-nodes">${nodesHtml}</div>
        </div>`;
    }).join("");

    return `
      <div class="set-rec-card">
        <div class="set-rec-header">
          <span class="set-rec-name">${escapeHTML(rec.setName)}</span>
          <span class="set-rec-meta">${rec.missingCount}/${rec.totalParts} ${escapeHTML(missingLabel)}${platText}</span>
        </div>
        ${partsHtml}
      </div>`;
  }).join("");
}

function bindSetRecFilterListeners(container, t) {
  const missingSelect = document.getElementById("set-rec-filter-missing");
  const buyCheckbox = document.getElementById("set-rec-filter-buy");
  const cardsArea = document.getElementById("fissure-set-recs-cards");

  const applyAndRerender = () => {
    const prefs = {
      maxMissing: parseInt(missingSelect?.value, 10) || 0,
      buyOnly: !!buyCheckbox?.checked,
    };
    saveSetRecsPrefs(prefs);
    if (cardsArea) {
      cardsArea.innerHTML = renderSetRecCards(filterSetRecommendations(_lastSetRecs, prefs), t);
    }
  };

  missingSelect?.addEventListener("change", applyAndRerender);
  buyCheckbox?.addEventListener("change", applyAndRerender);

  const toggleBtn = document.getElementById("fissure-set-recs-toggle");
  toggleBtn?.addEventListener("click", () => container.classList.toggle("collapsed"));
}

/**
 * Pinta el bloque "Fisuras para tus sets" en la pestaña Set (#fissure-set-recs, ver index.html).
 * Se llama al entrar en la pestaña y tras cada cambio de inventario/reliquias relevante.
 * No repite el fetch de fisuras si ya se cargaron en esta sesión de la pestaña — usa
 * fetchAllFissures (cache en memoria de 2 min de fissures.service.js).
 */
export async function renderFissureSetRecommendations() {
  const container = document.getElementById("fissure-set-recs");
  if (!container) return;
  if (!state.setsDatabase || !state.itemsDatabase) return;

  _setRecsLoaded = true;
  const t = TEXTS[state.currentLang];
  const activeMissions = await fetchAllFissures();

  const recs = getFissureSetRecommendations(activeMissions).slice(0, MAX_SET_RECS);

  if (recs.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    _lastSetRecs = [];
    return;
  }

  await attachSetPrices(recs);
  _lastSetRecs = recs;

  const title = t.fissureSetRecs?.title || "Fisuras para tus sets";
  const prefs = getSetRecsPrefs();
  const filtered = filterSetRecommendations(recs, prefs);

  container.innerHTML = `
    <button type="button" class="tier-header-btn fissure-set-recs-toggle" id="fissure-set-recs-toggle">
      <span>${escapeHTML(title)} (${recs.length})</span> <span class="arrow-icon">▼</span>
    </button>
    <div class="fissure-set-recs-content">
      ${renderSetRecGuide(t)}
      ${renderSetRecFilters(prefs, t)}
      <div id="fissure-set-recs-cards">${renderSetRecCards(filtered, t)}</div>
    </div>
  `;
  container.style.display = "block";

  bindSetRecFilterListeners(container, t);
}
