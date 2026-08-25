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

// Solo PIEZAS: los nombres de armas y warframes no se traducen en el juego.
// La base viene en inglés de warframe.market, pero se busca "chasis de saryn".
export const SET_SEARCH_SYNONYMS = {
  // Warframes
  chasis: "chassis",
  sistema: "systems",
  sistemas: "systems",
  neuroptica: "neuroptics",
  neuropticas: "neuroptics",
  casco: "neuroptics",
  // Genéricas
  plano: "blueprint",
  planos: "blueprint",
  proyecto: "blueprint",
  bp: "blueprint",
  // Armas de fuego
  canon: "barrel",
  receptor: "receiver",
  culata: "stock",
  // Cuerpo a cuerpo
  hoja: "blade",
  hojas: "blade",
  cuchilla: "blade",
  mango: "handle",
  empunadura: "hilt",
  guarda: "guard",
  cabeza: "head",
  disco: "disc",
  // Arcos
  cuerda: "string",
  agarre: "grip",
  extremidad: "limb",
  inferior: "lower",
  superior: "upper",
  // Centinelas y compañeros
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

// Eran 1200 ms sin ningún indicador. Por debajo de ~500 cada tecla dispararía otra tanda
// de precios contra la API.
const SEARCH_DEBOUNCE_MS = 600;

// Sin techo, buscar "chassis" pintaba un par de cientos de sets, cada uno con sus precios
// pendientes de resolver.
const MAX_SET_CARDS = 12;
const MAX_SINGLE_CARDS = 10;

let _searchIndex = null;
let _searchIndexKeyCount = -1;

// Reindexar ~4000 nombres en cada pulsación es lo único de este flujo que se nota en móvil,
// así que el índice solo se reconstruye cuando cambia el tamaño de la base.
function getSetSearchIndex() {
  const keys = Object.keys(state.itemsDatabase || {});
  if (!_searchIndex || _searchIndexKeyCount !== keys.length) {
    _searchIndex = buildSearchIndex(keys);
    _searchIndexKeyCount = keys.length;
  }
  return _searchIndex;
}

/** "Saryn Prime Chassis" -> "Saryn Prime"; null si no es una variante agrupable. */
function baseSetNameOf(itemName) {
  for (const variant of ["Prime", "Vandal", "Wraith"]) {
    const idx = itemName.indexOf(variant);
    if (idx !== -1) return `${itemName.slice(0, idx).trim()} ${variant}`.trim();
  }
  return null;
}

// Sin la entrada "... Set": el set entero ya está en la cabecera de la tarjeta, con su
// enlace al mercado y su precio.
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

  // Sin esta señal la pantalla se queda con los resultados anteriores durante el debounce
  // y se lee como que la app ha dejado de responder.
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
    // El puente PRIMERO y el carrusel debajo: lo tuyo a medias vale más que una lista de sets
    // populares, pero el carrusel se queda porque con el inventario vacío es lo único que hay.
    renderSetsBridge(container);
    renderEmptySetsShowcase(container, { append: true });
    return;
  }

  const t = TEXTS[state.currentLang];

  // Cubre lo que hacía el filtro por substring (una coincidencia literal siempre queda
  // por encima del umbral) y además tolera orden libre, erratas, iniciales y español.
  const hits = searchIndex(query, getSetSearchIndex(), {
    synonyms: SET_SEARCH_SYNONYMS,
    threshold: 0.5,
  });

  // Un set puntúa lo que puntúe su mejor pieza, para que "chasis de saryn" coloque el set
  // de Saryn arriba aunque el nombre del set no case con "chasis".
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

  // Se pinta el set COMPLETO aunque solo casara una pieza: quien busca "chasis de saryn"
  // quiere ver qué le falta del set, no una fila suelta.
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

// Va pegada a la primera rejilla y no en la cabecera de resultados: ahí es donde hay que
// actuar. Como pista propia y no como data-tooltip, porque styles.css oculta el tooltip
// global por debajo de 768px.
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

/** Se rehace en cada cambio de idioma: el texto de la ayuda vive dentro del botón. */
// Delegado en #setResults y no un listener por chip: la tira se repinta en cada búsqueda, y
// enganchar seis botones cada vez deja listeners colgando del DOM anterior.
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

  // Una vez por tarjeta y no por chip: recorre el inventario entero, y un set son ~5 piezas
  // por ~6 reliquias cada una.
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

        // Cuántas tienes de ESA reliquia. Va dentro del <span> del nombre y no como tercer hijo
        // del header porque el header es un space-between de dos elementos: un tercero mandaría
        // el icono de era al centro. Solo se pinta si tienes alguna — un "×0" en cada chip es
        // ruido en la mitad de la rejilla.
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
    // Populate , this works to avoid stutters when loading or adding sets 
    requestAnimationFrame(() => updateMacroTracker(title));
  }
}

export function activateSetTracker(setName, itemsInSet) {
  state.currentActiveSet = setName;
  state.activeSetParts = itemsInSet;
  renderSetTracker();
}

/**
 * Pone en seguimiento el set al que pertenece una pieza. Lo comparten el arrastre con ratón
 * (drop de HTML5) y la pulsación larga en táctil: dos caminos de entrada, una sola decisión
 * sobre qué pasa al soltar.
 * @returns {boolean} false si la pieza no pertenece a ningún set.
 */
export function trackSetFromPart(itemName) {
  const st = TEXTS[state.currentLang]?.setTab || {};
  const setName = getSetName(itemName);

  // "Otros" son las piezas sueltas (Forma, Kuva…): soltarlas no hacía NADA, ni un aviso,
  // así que el gesto parecía roto justo cuando se está aprendiendo.
  if (setName === "Otros") {
    showToast((st.dropNoSet || "{part} does not belong to any set").replace("{part}", itemName));
    return false;
  }

  const allParts = Object.keys(state.itemsDatabase).filter(
    (n) => (n === setName || n.startsWith(setName + " ")) && !n.endsWith(" Set"),
  );
  activateSetTracker(setName, allParts);
  showToast((st.trackingToast || "Tracking {set}").replace("{set}", setName));
  return true;
}

function openSetFromRelicReward(partName) {
    const setName = getSetName(partName);
    if (setName === "Otros") return;
    // globalThis, no import: ui.js importa este módulo y el inverso sería un ciclo.
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
  // Lo llama el arrastre por pulsación larga desde ui_relics.js. Por el registro y no por
  // import: ui_sets.js no importa ui_relics.js y no conviene abrir esa arista.
  trackSetFromPart,
  openSetFromRelicReward,
}, "ui.components/inventory/ui_sets.js");

setTimeout(() => {
  const trackerContainer = document.getElementById("set-tracker");
  if (trackerContainer && !trackerContainer.dataset.dndInit) {
    trackerContainer.dataset.dndInit = "true";
    // El rótulo de la zona vacía cambia a "suelta aquí" mientras se sobrevuela: es la
    // confirmación de que el sitio acepta lo que llevas, y no hay otra en un panel vacío.
    const setHint = (key) => {
      const el = trackerContainer.querySelector(".tracker-dropzone-text");
      const txt = TEXTS[state.currentLang]?.setTab?.[key];
      if (el && txt) el.textContent = txt;
    };
    trackerContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      trackerContainer.classList.add("drag-hover");
      setHint("dropActive");
    });
    // Sin comprobar relatedTarget, pasar por encima de cualquier hijo dispara dragleave y el
    // resaltado parpadea mientras mueves el cursor DENTRO de la propia zona.
    trackerContainer.addEventListener("dragleave", (e) => {
      if (trackerContainer.contains(e.relatedTarget)) return;
      trackerContainer.classList.remove("drag-hover");
      setHint("dropHint");
    });
    trackerContainer.addEventListener("drop", (e) => {
      e.preventDefault();
      trackerContainer.classList.remove("drag-hover");
      setHint("dropHint");
      const itemName = e.dataTransfer.getData("text/plain");
      if (itemName) trackSetFromPart(itemName);
    });
  }
}, 500);

// Ver MAINTENANCE_FISSURE_SET_RECS.md
