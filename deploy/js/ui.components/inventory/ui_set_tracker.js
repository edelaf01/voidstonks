import { state } from "../../state.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { showToast } from "../ui_components.js";
import { getSlug } from "../../utils/slugs.utils.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  calculateTotalFullSets,
} from "../../utils/ui_utils.js";
import { generateDotsHtml } from "../ui_tooltips.js";
import { getPartRarity, calculatePartExpectedRuns, DROP_RATES_BY_RARITY } from "../../utils/inventory/relic_drop_odds.utils.js";

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

function updateTrackerSim(refinement, squadSize, targetPart) {
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
    // 18px y no 14: el icono son cuatro reliquias sobre un remolino, y por debajo de ese
  // tamaño se funden en una mancha.
  const relicImgHtml = `<img src="assets/remolino.webp" style="width:18px; height:18px; object-fit:contain; vertical-align:middle; margin-right:3px;">`;

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

  // Puente al mercado: teniendo el set completo, el siguiente paso natural es venderlo.
  // Solo redirige —publicar vive en la pestaña de órdenes, que ya sabe de sesión, precios
  // y estado de publicación—; duplicar eso aquí sería mantener dos veces lo mismo.
  //
  // Si ya está en venta se dice, en vez de invitar a publicarlo otra vez. El dato sale
  // del último cruce que hizo la pestaña de órdenes: se consulta por globalThis para no
  // meterle a esta vista, que es de datos locales, una dependencia de la API.
  const alreadyListed = totalFullSets > 0 && globalThis.isSetListed?.(setSlug);
  // Sin sesión que autorice a publicar no se ofrece el botón: acabaría en un aviso.
  const canPublish = globalThis.canPublishToWfm?.();

  const sellBtnHtml = totalFullSets === 0 ? ""
    : alreadyListed
      ? `<span class="set-listed-tag" title="${escapeHTML(t.setListedTitle)}">${escapeHTML(t.setListed)}</span>`
      : canPublish
        ? `<button type="button" class="set-sell-btn" onclick="event.stopPropagation(); globalThis.sellSetFromInventory('${escapeHTML(state.currentActiveSet).replaceAll("'", "\\'")}')" title="${escapeHTML(t.sellSetTitle)}">${escapeHTML(t.sellSet)}</button>`
        : "";

  // 18px y no 14: el icono son cuatro reliquias sobre un remolino, y por debajo de ese
  // tamaño se funden en una mancha.
  const relicImgHtml = `<img src="assets/remolino.webp" style="width:18px; height:18px; object-fit:contain; vertical-align:middle; margin-right:3px;">`;

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
        ${sellBtnHtml}
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

// Lo invocan los <select> del simulador de runs, que se pintan desde aquí.
exposeGlobals({ updateTrackerSim }, "ui.components/inventory/ui_set_tracker.js");
