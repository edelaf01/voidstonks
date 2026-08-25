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
// Mismo especificador (?v=1.1) que ui.js/main.js: otro distinto crearía una segunda instancia
// del módulo con su propio estado interno.
import { updateRecommendedMissions } from "../farms/ui_fissures.js?v=1.1";
import { trackBestSetForRelic, renderSetTracker } from "./ui_set_tracker.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { isTouchPointer } from "../../utils/tap.js";

let debounceTimer;

// Última reliquia con la que se abrió el panel de fisuras: manualRelicUpdate también corre en
// re-renders (cambio de idioma, debounce del input), y sin este guard el panel se re-abriría
// aunque el usuario lo hubiera cerrado.
let lastFissureRelic = null;

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
        // Aquí y no dentro de manualRelicUpdate(): esa corre en cada oninput, así que
        // "Lith", "Lith D", "Lith D1" resolverían a reliquias distintas y el panel de
        // seguimiento iría saltando de set en set mientras escribes. Elegir del desplegable
        // es el momento en el que de verdad has decidido qué reliquia miras.
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
        // En móvil el panel ocupa 350 de los 390 px y tapaba la reliquia recién buscada.
        // Solo se notaba escribiendo el nombre entero a mano: eligiendo del desplegable, el
        // clic lo cierra otra vez (ui.js cierra los laterales al tocar fuera por debajo de
        // 768 px). Las fisuras se piden igual; lo único que no pasa es abrirlo solo.
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

// Cuántas copias de la reliquia abierta hay guardadas. El inventario viejo era un array de
// strings repetidos y updateInventoryCount() solo lo migra al primer +/-, así que aquí hay que
// saber leer las dos formas.
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

  // El botón es un "+1" a secas, igual que los de las piezas de abajo: sin decir a qué
  // reliquia se refiere, en esa fila se confunde con ellos.
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
// Cuánto hay que aguantar el dedo para que la fila se "levante". Más que los 220 ms del
// abanico de pestañas porque aquí el gesto compite con el scroll de la lista: por debajo de
// ~350 ms, un desplazamiento lento acaba levantando una fila sin querer.
const LONG_PRESS_MS = 400;
// Si el dedo se mueve más que esto ANTES de que salte el temporizador, era un scroll.
const MOVE_CANCEL_PX = 10;

/**
 * Arrastre por pulsación larga: el equivalente táctil del drag-and-drop de HTML5, que con el
 * dedo no dispara. Sin esto, seguir un set arrastrando su pieza era una función que en móvil
 * sencillamente no existía.
 *
 * Delegado en la lista y no fila por fila: las filas se rehacen con cada reliquia que eliges.
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
    // Un gesto anterior mal terminado (un segundo dedo, un touchcancel que no llegó) dejaría
    // el temporizador vivo y levantaría una fila que ya no se está pulsando.
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
      // El aviso de que el gesto "prendió". Sin él no hay forma de saber que ya puedes
      // mover el dedo, porque el dedo tapa justo la fila que cambia de aspecto.
      navigator.vibrate?.(15);
      tracker()?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, LONG_PRESS_MS);
  }, { passive: true });

  // passive:false a propósito: en cuanto el gesto es un arrastre hay que cortar el scroll de
  // la página, y preventDefault() no se puede llamar desde un listener pasivo.
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

// Complejidad alta: monta toda la fila (rareza, precio, ducados, set, tooltip) en un solo
// innerHTML. Trocear en subfunciones por bloque si hay que tocarla otra vez.
function createRelicDropRow(item) {
  const row = document.createElement("div");
  row.className = "component-row";
  // Arrastrable hasta "Progreso del Set". El gesto no se anunciaba en ningún sitio: se marca
  // la fila con .is-draggable (cursor grab + asa) y el tooltip lo dice con palabras, porque
  // el cursor solo no se ve en táctil ni en una captura.
  row.draggable = true;
  row.classList.add("is-draggable");
  // El nombre también en el DOM: el arrastre táctil va delegado en la lista y no tiene el
  // `item` del cierre, solo la fila que hay bajo el dedo.
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
  // Por getPlayerOdds y no leyendo el <select>: el refinamiento es global (manda también en
  // los chips del inventario, el seguidor de sets y las rutas) y aquí se mezclaba el valor del
  // DOM con el squadSize del estado, así que un mismo cálculo usaba las dos fuentes a la vez.
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
    // squadSize, no playerCount: el veredicto calcula con los que ABREN la reliquia, y aquí
    // se enseñaba el contador "Faltan" — que es cuántos te faltan para la escuadra.
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
 * Refinamiento y escuadra son GLOBALES: de ahí sacan las tasas de drop el veredicto de esta
 * pestaña, los chips del panel de inventario (visible a la vez), el seguidor de sets y las
 * rutas. Tenían dos mandos que no se hablaban — el <select> de aquí solo se leía del DOM y
 * nunca escribía el estado, y el simulador de "Rutas aconsejadas" lo escribía sin repintar a
 * los otros tres. Ahora los dos pasan por aquí y todo se recalcula a la vez.
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

/**
 * Rótulo de la cifra de rentabilidad, y el selector de escuadra en sintonía con el estado.
 *
 * La cifra la calcula relicOpenEV() con `state.squadSize`, pero el rótulo decía siempre
 * "Rentabilidad (Media)": quien abre en solitario veía el número de una escuadra de cuatro
 * sin nada que se lo dijera. `lblProfitSolo`/`lblProfitSquad` llevaban escritas en los dos
 * idiomas sin que las invocara nadie.
 *
 * Sincroniza además el <select>, que hay dos —este y el de los filtros de "Rutas aconsejadas"—
 * escribiendo sobre el mismo estado: sin esto uno se quedaba enseñando el valor viejo.
 */
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

/** Repinta todo lo que depende de las tasas de drop, venga el cambio de donde venga. */
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
