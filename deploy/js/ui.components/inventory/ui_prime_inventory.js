import { state, saveAppState } from "../../state.js";
import { TEXTS } from "../../config.js";
import { addToQueue, getPriceValue } from "../../services/market/prices.service.js";
import { warmupPrices } from "../../services/inventory/inventory.service.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { emptyStateHtml } from "../ui_components.js";
import {
  getItemIcon,
  getSetName,
  getRequiredCount,
  calculateTotalFullSets,
} from "../../utils/ui_utils.js";
import { generateDotsHtml } from "../ui_tooltips.js";
import { renderFarmRoutes } from "../farms/ui_farm_routes.js";
import { getPartDucats, formatDucatRatio } from "./ui_ducanator.js";
import { calculateGroupSubtotal } from "../../services/inventory/inventory_value.service.js";
import { initLivePrices, repaintLivePrices } from "./ui_inventory_live.js";
import { exposeGlobals } from "../../utils/global_registry.js";

const TARGET_SVG_INLINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="22" height="22" style="filter:drop-shadow(0 0 2px rgba(0,204,204,0.5));">
  <defs>
    <linearGradient id="miniGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fdf4df"/> <stop offset="100%" stop-color="#c09131"/> </linearGradient>
    <radialGradient id="miniVoid" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#66ffff"/> <stop offset="100%" stop-color="#00cccc"/> </radialGradient>
  </defs>
  <circle cx="18" cy="18" r="17" fill="#010410" stroke="#c09131" stroke-width="0.5"/>
  <circle cx="18" cy="18" r="14" fill="none" stroke="url(#miniGold)" stroke-width="1.5" opacity="0.7"/>
  <circle cx="18" cy="18" r="8" fill="none" stroke="#00cccc" stroke-width="1" opacity="0.8"/>
  <circle cx="18" cy="18" r="2.5" fill="url(#miniVoid)" stroke="#fdf4df" stroke-width="0.5"/>
  <g stroke="#c09131" stroke-width="0.25" opacity="0.5">
    <line x1="18" y1="4" x2="18" y2="32"/>
    <line x1="4" y1="18" x2="32" y2="18"/>
  </g>
  <g transform="translate(19,17) rotate(-45)">
    <path d="M0,2 L-1.5,-2 L0,-1 L1.5,-2 Z" fill="#000" opacity="0.5" transform="translate(1,1)"/>
    <path d="M0,1 L-1,-2 L1,-2 Z" fill="#999"/>
    <rect x="-0.75" y="-7" width="1.5" height="6" rx="0.3" fill="url(#miniGold)"/>
    <path d="M0,-7 L-3,-11 L0,-10 L3,-11 Z" fill="#66ffff" stroke="#fdf4df" stroke-width="0.2"/>
  </g>
</svg>`;

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

  const safePartHtml = escapeHTML(name);

  if (current === 0 || newQty === 0) {
    renderPrimeInventory();
  } else {
    const qtySpans = document.querySelectorAll(
      `.inv-btn-small[data-part="${safePartHtml}"] ~ .qty-num, .qty-num[data-part="${safePartHtml}"]`
    );
    qtySpans.forEach(span => {
      span.textContent = newQty;
      span.classList.remove("pulse-anim");
      span.classList.add("pulse-anim");
    });

    const safeId = name.replaceAll(/[^a-zA-Z0-9]/g, "");
    const badge = document.getElementById(`price-p-${safeId}`);
    if (badge) badge.dataset.qty = newQty;

    setTimeout(updatePrimeTotalValue, 10);
    if (newQty > 0) {
      const slug = getSlug(name);
      getPriceValue(name, slug).then(() => {
        updatePrimeTotalValue();
      });
    }
  }
  requestAnimationFrame(() => {
    const trackers = document.querySelectorAll(`.live-tracker[data-part="${safePartHtml}"]`);
    trackers.forEach(t => {
      const required = Number.parseInt(t.dataset.req) || 1;
      t.innerHTML = generateDotsHtml(newQty, required);
    });
    const setName = getSetName(name);
    if (setName && setName !== "Otros") {
      const safeSetNameId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

      if (typeof calculateTotalFullSets === "function") {
        const fullSets = calculateTotalFullSets(setName);
        const setBadge = document.querySelector(`#set-group-${safeSetNameId} .set-count-badge`);
        if (setBadge) {
          setBadge.innerHTML = `${fullSets} ${fullSets === 1 ? 'SET' : 'SETS'}`;
          setBadge.style.display = fullSets > 0 ? "inline-block" : "none";
        }
      }

      if (state.activeTab === "set" && typeof globalThis.updateMacroTracker === "function") {
        globalThis.updateMacroTracker(setName);
      }

      if (state.currentActiveSet === setName && typeof globalThis.renderSetTracker === "function") {
        globalThis.renderSetTracker();
      }

      // Sumar o quitar una pieza cambia lo que falta, o sea el orden entero de las rutas.
      // Solo si la pestaña está delante: pintarlas oculto es trabajo tirado, y al volver a
      // ella switchTab las reconstruye igualmente.
      if (state.activeTab === "relic") {
        renderFarmRoutes().catch((e) => console.warn("[INVENTORY] Error renderizando rutas:", e));
      }
    }

    const rewardCounts = document.querySelectorAll(`.app-owned-val[data-part="${safePartHtml}"]`);
    rewardCounts.forEach(span => {
      const lbl = state.currentLang === "es" ? "TENÍAS" : "OWNED";
      span.textContent = `${lbl}: ${newQty}`;
    });
  });
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

export function decrementPrimeSet(setName) {
  let allPossibleParts = [];
  if (state.setsDatabase?.[setName]) {
    allPossibleParts = state.setsDatabase[setName];
  } else {
    allPossibleParts = globalThis.setPartsCache?.get(setName) || [];
  }

  if (allPossibleParts.length === 0) return;

  let anyRemoved = false;
  allPossibleParts.forEach(p => {
    const reqMatch = p.match(/(\d+)x$/);
    let requiredCount = 1;
    let partName = p;
    if (reqMatch) {
      requiredCount = Number.parseInt(reqMatch[1], 10);
      partName = p.replace(/\s*\d+x$/, "").trim();
    }

    if (state.primeInventory[partName]) {
      state.primeInventory[partName] = Math.max(0, state.primeInventory[partName] - requiredCount);
      anyRemoved = true;
      if (state.primeInventory[partName] === 0) {
        delete state.primeInventory[partName];
      }
    }
  });

  if (anyRemoved) {
    saveAppState();
    renderPrimeInventory();
  }
}

/**
 * Grupos de set que el usuario ha abierto.
 *
 * En memoria y no solo en la clase CSS: renderPrimeInventory() rehace el innerHTML entero al
 * añadir la PRIMERA copia de una pieza (o al quitar la última), así que el set que estabas
 * rellenando se cerraba en la cara y había que volver a abrirlo tras cada +1.
 *
 * No se persiste: es estado de "dónde estoy mirando ahora", no una preferencia.
 */
const openSetGroups = new Set();

export function toggleInvSet(safeSetId) {
  const el = document.getElementById(`set-group-${safeSetId}`);
  if (!el) return;
  // toggle() devuelve si la clase QUEDÓ puesta, o sea si quedó plegado.
  if (el.classList.toggle("collapsed")) openSetGroups.delete(safeSetId);
  else openSetGroups.add(safeSetId);
}

export function openSetDetail(setName) {
  // Vía globalThis (switchTab lo publica main.js; handleSetTyping, ui_sets.js): importarlos
  // crearía un ciclo de carga. Ver el test de ciclos en tests/import-graph.test.mjs.
  globalThis.switchTab("set");
  const input = document.getElementById("setItemInput");
  if (input) {
    input.value = setName;
    globalThis.handleSetTyping();
  }
}

let lastRenderedHash = "";

/**
 * Etiqueta de mercado en la cabecera de un set: "Vender" si está completo y sin
 * publicar, "En venta" si ya lo tienes listado en warframe.market.
 *
 * El estado sale del último cruce que hizo la pestaña de órdenes, consultado por
 * globalThis: el inventario es una vista de datos locales y no debe pedir nada a la
 * red para pintarse. Sin cruce previo se ofrece "Vender", que solo redirige.
 *
 * @param {string} setName nombre del set ("Ash Prime")
 * @param {number} numSets sets completos que tiene el usuario
 */
function sellTagHtml(setName, numSets) {
  if (setName === "Otros" || numSets < 1) return "";

  const t = TEXTS[state.currentLang];
  if (globalThis.isSetListed?.(getSlug(setName + " Set"))) {
    return `<span class="set-listed-tag" title="${escapeHTML(t.setListedTitle)}">${escapeHTML(t.setListed)}</span>`;
  }

  // Sin sesión utilizable no se ofrece: el botón acabaría en un aviso, y un botón que
  // nunca funciona es peor que su ausencia. La sesión vive en sessionStorage, así que
  // esto cambia al reconectar y el inventario se repinta.
  if (!globalThis.canPublishToWfm?.()) return "";

  return `<button type="button" class="set-sell-btn" data-action="go-sell-set" data-setname="${escapeHTML(setName)}" title="${escapeHTML(t.sellSetTitle)}">${escapeHTML(t.sellSet)}</button>`;
}

// Ducat value for a single prime part (canonical source: itemsDatabase).
export function renderPrimeInventory() {
  const list = document.getElementById("inventory-list-parts");
  if (!list) return;

  const panel = document.getElementById("inventory-sidebar");
  if (panel && !panel.classList.contains("open")) return;

  // La instancia de las rutas que vive en este panel. renderFarmRoutes() repinta las dos, así
  // que llamarlo desde aquí también refresca la de la pestaña Reliquia — que es lo que se
  // quiere: las dos miran el mismo inventario.
  //
  // Import directo y no globalThis: este import es además lo que CARGA el módulo. Al quitarlo
  // se quedó sin importar por nadie, exposeGlobals no llegó a correr y todas las llamadas
  // —que van con `?.()`— se saltaron sin un solo error. El panel desapareció de las dos
  // pestañas y la consola no dijo nada.
  renderFarmRoutes().catch((e) => console.warn("[INVENTORY] Error renderizando rutas:", e));

  const searchInput = (document.getElementById("prime-inv-search")?.value || "").toLowerCase();
  const sortMode = document.getElementById("prime-inv-sort")?.value || "alpha";

  // showEmptyPrime entra en la huella: sin él, marcar la casilla no repintaba nada porque el
  // inventario no había cambiado.
  const newHash = JSON.stringify(state.primeInventory) + state.currentLang + searchInput + sortMode
    + (state.settings?.showEmptyPrime ? "|0s" : "");
  if (newHash === lastRenderedHash && list.children.length > 0) {
    setTimeout(updatePrimeTotalValue, 10);
    return;
  }
  lastRenderedHash = newHash;

  const entries = Object.entries(state.primeInventory);
  const groups = {};
  entries.forEach(([name, qty]) => {
    const setName = getSetName(name);
    if (!groups[setName]) groups[setName] = [];
    if (qty > 0 || state.settings?.showEmptyPrime) {
      groups[setName].push({ name, qty });
    }
  });

  let setNames = Object.keys(groups);

  if (searchInput) {
    setNames = setNames.filter(n => {
      if (n.toLowerCase().includes(searchInput)) return true;
      const parts = groups[n] || [];
      return parts.some(p => p.name.toLowerCase().includes(searchInput));
    });
  }

  const setMetrics = new Map();
  setNames.forEach(setName => {
    if (setName === "Otros") {
      setMetrics.set(setName, { numSets: 0, setTotalPlat: 0 });
      return;
    }

    let allPossibleParts = [];
    if (state.setsDatabase?.[setName]) {
      allPossibleParts = state.setsDatabase[setName];
    } else {
      if (!globalThis.setPartsCache) globalThis.setPartsCache = new Map();
      if (!globalThis.setPartsCache.has(setName) || globalThis.setPartsCache.get(setName).length === 0) {
        const parts = Object.keys(state.itemsDatabase || {}).filter(
          (name) => (name === setName || name.startsWith(setName + " ")) && !name.endsWith(" Set")
        );
        globalThis.setPartsCache.set(setName, parts);
      }
      allPossibleParts = globalThis.setPartsCache.get(setName);
    }

    let numSets = 999;
    let setTotalPlat = 0;
    let piecesOwned = 0;

    allPossibleParts.forEach(p => {
      const owned = state.primeInventory[p] || 0;
      const required = getRequiredCount(setName, p);
      if (owned >= required) piecesOwned++;

      const possible = Math.floor(owned / required);
      if (possible < numSets) numSets = possible;

      const cachedRaw = globalThis.MEMORY_CACHE?.get(getSlug(p));
      const plat = cachedRaw ? (Number.parseInt(cachedRaw, 10) || 0) : 0;
      setTotalPlat += plat * required;
    });

    // --- Potential Sort Logic ---
    let farmablePieces = 0;
    const ownedRelics = new Set((state.inventory || []).map(r => r.name.toUpperCase()));
    allPossibleParts.forEach(p => {
      const owned = state.primeInventory[p] || 0;
      const required = getRequiredCount(setName, p);
      if (owned < required) {
        const relicsForPart = state.relicsDatabase[p] || [];
        if (relicsForPart.some(r => ownedRelics.has(r.name.toUpperCase()))) farmablePieces++;
      }
    });

    const potentialScore = (piecesOwned / allPossibleParts.length) + (farmablePieces * 0.5);

    if (numSets === 999) numSets = 0;
    // Lo que FALTA, que es lo que de verdad pregunta el orden "cerquitas de terminar".
    // Contar las piezas que tienes premia a los sets grandes: uno de 8 con 5 tuyas (faltan 3)
    // se colaba por delante de uno de 4 con 3 (falta 1).
    const piecesMissing = allPossibleParts.length - piecesOwned;
    setMetrics.set(setName, { numSets, setTotalPlat, piecesOwned, piecesMissing, potentialScore });
  });

  setNames.sort((a, b) => {
    if (a === "Otros") return 1;
    if (b === "Otros") return -1;

    const metricA = setMetrics.get(a);
    const metricB = setMetrics.get(b);

    if (sortMode === "sets_desc") {
      if (metricA.numSets !== metricB.numSets) return metricB.numSets - metricA.numSets;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "sets_asc") {
      // Los ya completos al final: un set terminado no está "a punto de terminar", y con
      // 0 piezas que faltan encabezaba justo la lista de lo que te queda por cerrar.
      const doneA = metricA.piecesMissing === 0;
      const doneB = metricB.piecesMissing === 0;
      if (doneA !== doneB) return doneA ? 1 : -1;
      if (metricA.piecesMissing !== metricB.piecesMissing) return metricA.piecesMissing - metricB.piecesMissing;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "plat_desc") {
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else if (sortMode === "relic_potential") {
      if (metricA.potentialScore !== metricB.potentialScore) return metricB.potentialScore - metricA.potentialScore;
      return metricB.setTotalPlat - metricA.setTotalPlat;
    } else {
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    }
  });

  if (setNames.length === 0) {
    const inv = TEXTS[state.currentLang]?.inventory;
    list.innerHTML = emptyStateHtml(
      inv?.emptyParts || "No prime parts saved yet.",
      inv?.emptyScannerHint,
      inv?.emptyScannerHintMobile,
    );
    return;
  }

  globalThis.primeRenderId = (globalThis.primeRenderId || 0) + 1;
  const currentRenderId = globalThis.primeRenderId;

  setTimeout(() => {
    if (globalThis.primeRenderId !== currentRenderId) return;

    const headerHtml = `
      <div class="inventory-total-header">
         <div class="total-label">${TEXTS[state.currentLang].inventory.lblTotalValue || "ESTIMATED TOTAL VALUE"}</div>
         <div class="total-value"><span id="total-prime-value">...</span> <span class="plat-icon-inline"></span></div>
      </div>`;

    if (list.querySelector(".inventory-total-header")) {
      const oldTotal = document.getElementById("total-prime-value")?.textContent;
      list.innerHTML = headerHtml;
      if (oldTotal) document.getElementById("total-prime-value").textContent = oldTotal;
    } else {
      list.innerHTML = headerHtml;
    }

    let currentIndex = 0;
    const renderChunk = () => {
      if (globalThis.primeRenderId !== currentRenderId) return;

      const fragment = document.createDocumentFragment();
      const chunkSize = 5;
      const end = Math.min(currentIndex + chunkSize, setNames.length);

      for (; currentIndex < end; currentIndex++) {
        const setName = setNames[currentIndex];
        const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

        groups[setName].sort((a, b) => a.name.length - b.name.length);

        let numSets = 0;
        let allPossibleParts = [];
        if (setName !== "Otros") {
          // Fetching parts logic
          if (state.setsDatabase?.[setName]) {
            allPossibleParts = state.setsDatabase[setName];
          } else {
            allPossibleParts = globalThis.setPartsCache?.get(setName) || [];
          }
          numSets = setMetrics.get(setName).numSets;
        }

        let groupHtml = `
      <div class="inv-set-group${openSetGroups.has(safeSetId) ? "" : " collapsed"}" id="set-group-${safeSetId}">
        <div class="inv-set-header" data-action="toggle-inv-set" data-setid="${safeSetId}" style="cursor:pointer;">
          <div class="header-controls">
            <div style="display:flex; gap:4px;">
              ${numSets >= 1 ? `<button class="delete-set-btn" data-action="decrement-prime-set" data-setname="${escapeHTML(setName)}" title="-1 Set" style="font-size:0.75em; padding: 2px 4px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 3px; cursor: pointer; transition: all 0.2s; line-height: 1;">-1</button>` : ''}
              <button class="delete-set-btn" data-action="delete-prime-set" data-setname="${escapeHTML(setName)}" title="Delete Everything">×</button>
            </div>
            <span class="toggle-icon">▼</span>
          </div>
          
          <div class="header-main">
            ${(() => {
            const setIcon = getItemIcon(setName);
            return setIcon
              ? `<img src="${setIcon}" class="item-icon-small" loading="lazy" onerror="this.style.display='none'">`
              : "";
          })()}
            <span class="set-title">${escapeHTML(setName)}</span>
            <span class="tracker-link-icon" onclick="event.stopPropagation(); globalThis.openSetDetail('${escapeHTML(setName)}')" title="Set Tracker" style="cursor:pointer; margin-left:8px; display:inline-flex; align-items:center; vertical-align:middle; flex-shrink:0;">
              ${TARGET_SVG_INLINE}
            </span>
            <a href="https://warframe.market/items/${getSlug(setName + " Set")}" target="_blank" class="market-link-icon" onclick="event.stopPropagation()" style="margin-left:6px; flex-shrink:0; font-size:1.1em;">↗</a>
          </div>

          <div class="header-info">
             <span class="set-count-badge" style="display:${numSets > 0 ? "inline-block" : "none"};">${numSets} ${numSets === 1 ? 'SET' : 'SETS'}</span>
             ${sellTagHtml(setName, numSets)}
             <span class="set-total-price" id="set-price-${safeSetId}">0 <span class="plat-icon-inline"></span></span>
             <span id="set-mkt-${safeSetId}" class="set-price-marker" style="display:none;">...</span>
          </div>
        </div>
        <div class="inv-set-content">
          ${(setName === "Otros" ? groups[setName].map(p => p.name) : allPossibleParts)
            .map((partName) => {
              const qty = state.primeInventory[partName] || 0;
              const safeId = partName.replaceAll(/[^a-zA-Z0-9]/g, "");
              const shortName = partName.replace(setName, "").trim() || (TEXTS[state.currentLang].lblBlueprint || "Blueprint");
              const requiredCount = getRequiredCount(setName, partName);
              const dotsHtml = generateDotsHtml(qty, requiredCount);

              // Price fetch is now handled at the end of renderChunk or by updatePrimeTotalValue for items already in cache

              return `
              <div class="inv-row-mini">
                <div class="row-main" onclick="globalThis.openSetDetail('${escapeHTML(setName)}')" style="cursor:pointer;">
                  ${(() => {
                  const partIcon = getItemIcon(partName);
                  return partIcon
                    ? `<img src="${partIcon}" class="item-icon-mini" loading="lazy" onerror="this.style.display='none'">`
                    : "";
                })()}
                   <div class="name-column">
                     <span class="part-name">${escapeHTML(shortName)}</span>
                     <div class="live-tracker" data-part="${escapeHTML(partName)}" data-req="${requiredCount}">
                        ${dotsHtml}
                     </div>
                  </div>
                </div>

                <div class="row-info">
                   <a href="https://warframe.market/items/${getSlug(partName)}" target="_blank" class="market-link-icon-mini" onclick="event.stopPropagation()">↗</a>
                   <span class="ratio-tag" id="ratio-p-${safeId}" title="${escapeHTML((TEXTS[state.currentLang].ducanator || {}).effTitle || "Ducados por platino")}">${(() => {
                  const dv = getPartDucats(partName);
                  const cached = globalThis.MEMORY_CACHE?.get(getSlug(partName));
                  const p = (cached !== undefined && !Number.isNaN(Number.parseInt(cached, 10))) ? Number.parseInt(cached, 10) : null;
                  return p !== null ? formatDucatRatio(dv, p) : "";
                })()}</span>
                   <span class="price-badge-small" id="price-p-${safeId}" data-qty="${qty}" data-item="${escapeHTML(partName)}">${(() => {
                  const cached = globalThis.MEMORY_CACHE?.get(getSlug(partName));
                  if (cached !== undefined && !Number.isNaN(Number.parseInt(cached, 10))) return Number.parseInt(cached, 10);
                  const slug = getSlug(partName);
                  getPriceValue(partName, slug).then((price) => {
                    const badgeEl = document.getElementById(`price-p-${safeId}`);
                    if (badgeEl) {
                      badgeEl.innerHTML = `${price} <span class="plat-icon-inline"></span>`;
                      badgeEl.classList.remove("price-loading-blink");
                      updatePrimeTotalValue();
                    }
                    const ratioEl = document.getElementById(`ratio-p-${safeId}`);
                    if (ratioEl) ratioEl.innerHTML = formatDucatRatio(getPartDucats(partName), price);
                  });
                  return "...";
                })()} <span class="plat-icon-inline"></span></span>
                </div>

                <div class="inv-qty-controls-mini">
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(partName)}" data-amount="-1"></button>
                  <span class="qty-num" data-part="${escapeHTML(partName)}">${qty}</span>
                  <button class="inv-btn-small" data-action="modify-prime-part" data-part="${escapeHTML(partName)}" data-amount="1">+</button>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;

        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = groupHtml;
        fragment.appendChild(tempDiv.firstElementChild);
      }

      list.appendChild(fragment);
      updatePrimeTotalValue();

      if (currentIndex < setNames.length) {
        requestAnimationFrame(renderChunk);
      } else {
        setNames.forEach((setName) => {
          if (setName === "Otros") return;
          const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");
          const el = document.getElementById(`set-mkt-${safeSetId}`);
          if (el) addToQueue(setName + " Set", el);
        });
        //This is needed for the prices to update and be somewhat ready 
        if (typeof warmupPrices === "function") {
          warmupPrices();
        }

        setTimeout(updatePrimeTotalValue, 100);
      }
    };

    requestAnimationFrame(renderChunk);

    // LIVE SYNC: Start a temporary interval to pick up prices as they finish loading from the queue
    if (globalThis.invTotalSyncInterval) clearInterval(globalThis.invTotalSyncInterval);
    let syncCount = 0;
    globalThis.invTotalSyncInterval = setInterval(() => {
      syncCount++;
      updatePrimeTotalValue();
      // Stop after 20 seconds or if inventory is closed
      if (syncCount > 40 || !document.getElementById("inventory-list-parts")) {
        clearInterval(globalThis.invTotalSyncInterval);
      }
    }, 500);
  }, 10);
}

export async function updatePrimeTotalValue() {
  let totalGlobal = 0;
  const entries = Object.entries(state.primeInventory);
  const invGroups = {};

  entries.forEach(([itemName, qty]) => {
    if (qty > 0) {
      const setNameRaw = getSetName(itemName);
      if (!invGroups[setNameRaw]) {
        invGroups[setNameRaw] = { parts: {}, setPrice: 0 };
      }

      const itemSlug = getSlug(itemName);
      let price = 0;

      const safeId = itemName.replaceAll(/[^a-zA-Z0-9]/g, "");
      const badge = document.getElementById(`price-p-${safeId}`);

      const cachedRaw = globalThis.MEMORY_CACHE?.get(itemSlug);
      if (cachedRaw !== undefined) {
        price = Number.parseInt(cachedRaw, 10);
        if (badge) {
          badge.classList.remove("price-loading-blink");
          if (badge.textContent.includes("...") || badge.textContent.trim() === "") {
            badge.innerHTML = `${price} <span class="plat-icon-inline"></span>`;
          }
        }
      } else if (badge) {
        badge.classList.add("price-loading-blink");
      }
      if (Number.isNaN(price)) price = 0;

      invGroups[setNameRaw].parts[itemName] = { qty, price };
    }
  });

  Object.keys(invGroups).forEach((setNameRaw) => {
    if (setNameRaw === "Otros") return;
    const safeSetId = setNameRaw.replaceAll(/[^a-zA-Z0-9]/g, "");
    const mktEl = document.getElementById(`set-mkt-${safeSetId}`);

    const cachedRaw = globalThis.MEMORY_CACHE?.get(getSlug(setNameRaw + " Set"));
    const price = cachedRaw === undefined ? 0 : Number.parseInt(cachedRaw, 10);

    if (cachedRaw !== undefined) {
      if (!Number.isNaN(price) && mktEl) {
        mktEl.classList.remove("price-loading-blink");
        mktEl.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0; margin-top:2px;">
            <span style="font-size:0.55em; opacity:0.5; line-height:1; letter-spacing:0.5px;">MARKET SET</span>
            <span style="font-size:0.85em;">${price} <span class="plat-icon-inline"></span></span>
          </div>
        `;
        mktEl.style.display = "inline-block";
      }
    } else if (mktEl) {
      mktEl.classList.add("price-loading-blink");
      if (mktEl.textContent === "") mktEl.textContent = "...";
      mktEl.style.display = "inline-block";
    }

    invGroups[setNameRaw].setPrice = Number.isNaN(price) ? 0 : price;
    invGroups[setNameRaw].setPriceLoaded = (cachedRaw !== undefined);
  });

  Object.keys(invGroups).forEach((setName) => {
    const subtotal = calculateGroupSubtotal(setName, invGroups[setName]);
    const safeSetId = setName.replaceAll(/[^a-zA-Z0-9]/g, "");

    const el = document.getElementById(`set-price-${safeSetId}`);
    if (el) {
      el.innerHTML = `${new Intl.NumberFormat().format(subtotal)} <span class="plat-icon-inline"></span>`;
    }
    totalGlobal += subtotal;
  });

  const totalEl = document.getElementById("total-prime-value");
  if (totalEl) {
    totalEl.textContent = new Intl.NumberFormat().format(totalGlobal);
    totalEl.classList.remove("loading-blink");
  }

  initLivePrices();
  // La lista se acaba de reconstruir: las marcas de precio en vivo iban en el DOM viejo.
  repaintLivePrices();
}

// Los invoca index.html con onclick inline y, varios de ellos, otros módulos por globalThis
// (el escáner en vivo, el tracker de sets, las órdenes) para refrescar sin importar la vista.
/**
 * Búsqueda del panel de piezas. Con debounce porque cada pasada reconstruye la lista entera
 * agrupada por set: a una por pulsación se nota al teclear. Mismo margen que el buscador de
 * la pestaña Set.
 */
let searchDebounce;
export function handlePrimeInvSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderPrimeInventory, 120);
}

/**
 * Casilla "Mostrar también las piezas a 0".
 *
 * `state.settings.showEmptyPrime` se leía en tres sitios y no había forma de encenderlo: el
 * objeto `settings` no lo creaba nadie. Decide solo lo que se PINTA — la petición de precios
 * se queda acotada a tu inventario (ver collectInventorySlugs).
 */
export function toggleShowEmptyPrime(checked) {
  state.settings = { ...state.settings, showEmptyPrime: !!checked };
  saveAppState();
  renderPrimeInventory();
}

exposeGlobals({
  renderPrimeInventory,
  toggleShowEmptyPrime,
  handlePrimeInvSearch,
  modifyPrimePart,
  deletePrimeSet,
  decrementPrimeSet,
  toggleInvSet,
  openSetDetail,
}, "ui.components/inventory/ui_prime_inventory.js");
