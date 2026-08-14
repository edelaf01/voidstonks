import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getItemIcon } from "../../utils/ui_utils.js";
import { getPriceValue, MEMORY_CACHE } from "../../services/market/prices.service.js";
import { exposeGlobals } from "../../utils/global_registry.js";

/**
 * Ducanator: la pestaña que ordena las piezas prime por ducados frente a su precio en platino.
 *
 * Es una pestaña aparte con su propio estado (columna y sentido de orden, filtro de "solo lo
 * que tengo", umbral) y vivía dentro de ui_inventory.js. No usa NADA del inventario —se midió—,
 * así que el corte es de una sola dirección: el inventario le pide las tres funciones de
 * cálculo de ducados y ya.
 */

export function getPartDucats(partName) {
  const info = state.itemsDatabase?.[partName];
  return info && info[0]?.ducats ? info[0].ducats : 0;
}

// Ducats-per-platinum efficiency, as a numeric score.
// No plat (unknown/zero) but ducats -> Infinity (best); no ducats -> 0.
export function ducatRatio(ducats, plat) {
  if (!ducats || ducats <= 0) return 0;
  if (!plat || plat <= 0) return Infinity;
  return ducats / plat;
}

// Renders the ratio as a small labelled tag (∞ / N.N duc·pl⁻¹).
export function formatDucatRatio(ducats, plat) {
  const r = ducatRatio(ducats, plat);
  if (r === 0) return "";
  const txt = r === Infinity ? "∞" : r.toFixed(1);
  return `<span class="ratio-num">${txt}</span><span class="ratio-unit">d/pl</span>`;
}

/**
 * Ducanator view: flat list of the prime parts you own (qty > 0), ranked by
 * ducat-per-platinum efficiency so you fund what gives many ducats but little
 * plat, and keep what is worth more sold. Reuses MEMORY_CACHE / getPriceValue.
 */
export function renderDucanatorView(list, opts = {}) {
  const t = TEXTS[state.currentLang];
  const dt = t.ducanator || {};

  const searchInput = (opts.search || "").toLowerCase();
  const ownedOnly = opts.ownedOnly !== false; // default: only what you own
  const sortCol = opts.sortCol || "ratio"; // name | plat | ducats | ratio
  const sortDir = opts.sortDir || -1; // -1 desc (most profitable first), 1 asc
  // Prices at/below this many plat are "safe to fund" (won't waste a sale).
  const KEEP_PLAT_THRESHOLD = Number.isFinite(opts.threshold) ? opts.threshold : 15;
  // Called again once missing prices arrive, to re-rank with real data.
  const rerender = opts.rerender || null;

  const rows = Object.entries(state.primeInventory)
    .filter(([name, qty]) => !ownedOnly || qty > 0)
    .filter(([name]) => !searchInput || name.toLowerCase().includes(searchInput))
    .map(([name, qty]) => {
      const ducats = getPartDucats(name);
      const cachedRaw = globalThis.MEMORY_CACHE?.get(getSlug(name));
      const plat = cachedRaw !== undefined ? (Number.parseInt(cachedRaw, 10) || 0) : null;
      // Efficiency = ducats per plat sacrificed. Unknown/zero plat -> best score.
      const eff = ducatRatio(ducats, plat === null ? 0 : plat);
      return { name, qty, ducats, plat, eff };
    })
    .filter((r) => r.ducats > 0);

  const effNum = (r) => (r.eff === Infinity ? Number.MAX_VALUE : r.eff);
  rows.sort((a, b) => {
    let cmp;
    if (sortCol === "name") cmp = a.name.localeCompare(b.name);
    else if (sortCol === "plat") cmp = (a.plat ?? -1) - (b.plat ?? -1);
    else if (sortCol === "ducats") cmp = a.ducats - b.ducats;
    else cmp = effNum(a) - effNum(b); // ratio
    return cmp * sortDir;
  });

  let fundableDucats = 0;
  let fundableParts = 0;
  let keepPlat = 0;
  const fundRows = [];
  const keepRows = [];

  // Infinity (plat desconocido) queda fuera del máximo a propósito: si entrara, una
  // sola pieza sin precio dejaría las barras del resto en casi nada.
  const maxFiniteEff = rows.reduce((m, r) => (r.eff !== Infinity && r.eff > m ? r.eff : m), 0);

  rows.forEach((r) => {
    const platReady = r.plat !== null;
    const shouldFund = !platReady || r.plat <= KEEP_PLAT_THRESHOLD;
    if (shouldFund) {
      fundableDucats += r.ducats * r.qty;
      fundableParts += r.qty;
    } else {
      keepPlat += r.plat * r.qty;
    }
    const effTxt = r.eff === Infinity ? "∞" : r.eff.toFixed(1);
    const platTxt = platReady ? `${r.plat}` : "...";
    // Ancho relativo al mejor ratio; suelo del 6% para que una fila floja siga siendo visible.
    const effPct = r.eff === Infinity
      ? 100
      : (maxFiniteEff > 0 ? Math.max(6, Math.round((r.eff / maxFiniteEff) * 100)) : 0);
    const icon = getItemIcon(r.name);
    const iconHtml = icon
      ? `<img src="${icon}" class="duc-img item-icon-small" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span class="duc-img duc-img-empty"></span>`;
    const qtyHtml = r.qty > 1 ? `<span class="duc-qty">×${r.qty}</span>` : "";

    const html = `
      <div class="duc-row${shouldFund ? " is-fund" : ""}">
        <div class="duc-name-col">
          <span class="duc-img-wrap">${iconHtml}${qtyHtml}</span>
          <div class="duc-name-text">
            <a href="https://warframe.market/items/${getSlug(r.name)}" target="_blank" class="part-name duc-link">${escapeHTML(r.name)}</a>
          </div>
        </div>
        <div class="duc-plat${platReady ? "" : " is-pending"}">${platTxt}<span class="plat-icon-inline"></span></div>
        <div class="duc-ducats">${r.ducats}<span class="ducat-icon-inline"></span></div>
        <div class="duc-eff" title="${escapeHTML(dt.effTitle || "Ducats per platinum")}">
          <span class="duc-eff-bar" style="width:${effPct}%"></span>
          <span class="duc-eff-num">${effTxt}</span>
        </div>
      </div>`;
    (shouldFund ? fundRows : keepRows).push(html);
  });

  // Clickable column headers: click sorts by that column, click again flips direction.
  const arrowFor = (c) => (c === sortCol ? (sortDir === -1 ? " ▼" : " ▲") : "");
  const th = (c, label, extraClass = "") => `
      <button class="duc-th ${extraClass} ${c === sortCol ? "active" : ""}" onclick="globalThis.setDucatSort('${c}')" title="${escapeHTML(dt.sortHint || "Click to sort")}">${escapeHTML(label)}${arrowFor(c)}</button>`;
  const headerRow = `
      <div class="duc-head">
        ${th("name", dt.colItem || "Item")}
        ${th("plat", dt.colPlat || "Plat", "num")}
        ${th("ducats", dt.colDucats || "Ducats", "num")}
        ${th("ratio", dt.colRatio || "Ratio", "num")}
      </div>`;

  const emptyMsg = dt.empty || "No prime parts with ducat value. Scan or add parts first.";
  const section = (label, items, kind) => items.length === 0 ? "" : `
      <div class="duc-section duc-section-${kind}">
        <div class="duc-section-header">
          <span class="duc-section-dot"></span>
          ${escapeHTML(label)}
          <span class="duc-section-count">${items.length}</span>
        </div>
        <div class="duc-list">${items.join("")}</div>
      </div>`;

  list.innerHTML = `
    <div class="duc-panel">
      <div class="duc-summary">
        <div class="duc-stat duc-stat-gold">
          <span class="duc-stat-val">${fundableDucats.toLocaleString()}<span class="ducat-icon-inline"></span></span>
          <span class="duc-stat-label">${escapeHTML(dt.fundSection || "Trade for ducats")} · ${fundableParts}</span>
        </div>
        <div class="duc-stat duc-stat-plat">
          <span class="duc-stat-val">${keepPlat.toLocaleString()}<span class="plat-icon-inline"></span></span>
          <span class="duc-stat-label">${escapeHTML(dt.keepSection || "Better to sell")} · ${keepRows.length}</span>
        </div>
      </div>
      ${rows.length === 0
        ? `<div class="duc-empty">${escapeHTML(emptyMsg)}</div>`
        : headerRow
          + section(dt.fundSection || "Trade for ducats", fundRows, "fund")
          + section(dt.keepSection || "Better to sell", keepRows, "keep")}
    </div>`;

  // Fetch missing plat prices, then re-rank once they land.
  const pending = rows.filter((r) => r.plat === null);
  if (pending.length > 0) {
    globalThis.ducanatorFetchId = (globalThis.ducanatorFetchId || 0) + 1;
    const fetchId = globalThis.ducanatorFetchId;
    Promise.all(pending.map((r) => getPriceValue(r.name, getSlug(r.name)))).then(() => {
      if (globalThis.ducanatorFetchId !== fetchId) return;
      if (rerender) rerender();
    });
  }
}

// Column sort state for the Ducats tab (default: ratio, most profitable first).
let ducatSortCol = "ratio";
let ducatSortDir = -1;

export function setDucatSort(col) {
  if (ducatSortCol === col) {
    ducatSortDir = -ducatSortDir;
  } else {
    ducatSortCol = col;
    ducatSortDir = col === "name" ? 1 : -1; // names A-Z, numbers high-to-low
  }
  renderDucanatorTab();
}

// El checkbox sigue en el DOM (oculto) porque es donde renderDucanatorTab lee el estado;
// el chip solo es su cara visible.
export function toggleDucatOwned() {
  const cb = document.getElementById("ducat-owned-only");
  if (!cb) return;
  cb.checked = !cb.checked;
  const chip = document.getElementById("ducat-owned-chip");
  if (chip) {
    chip.classList.toggle("active", cb.checked);
    chip.setAttribute("aria-pressed", String(cb.checked));
  }
  renderDucanatorTab();
}

export function clearDucatSearch() {
  const input = document.getElementById("ducat-search");
  if (!input) return;
  input.value = "";
  input.focus();
  renderDucanatorTab();
}

// Standalone Ducanator tab: reads its own filter controls and renders into #ducat-content.
export function renderDucanatorTab() {
  const list = document.getElementById("ducat-content");
  if (!list) return;
  const search = document.getElementById("ducat-search")?.value || "";
  document.getElementById("ducat-search-clear")?.classList.toggle("hidden", search === "");
  const opts = {
    search,
    ownedOnly: document.getElementById("ducat-owned-only")?.checked !== false,
    sortCol: ducatSortCol,
    sortDir: ducatSortDir,
    threshold: Number.parseInt(document.getElementById("ducat-threshold")?.value ?? "15", 10),
    rerender: () => {
      if (state.activeTab !== "ducat") return;
      renderDucanatorTab();
    },
  };
  renderDucanatorView(list, opts);
}

export function updateDucatThreshold(val) {
  const out = document.getElementById("ducat-threshold-val");
  if (out) out.innerHTML = `${val}<span class="plat-icon-inline"></span>`;
  renderDucanatorTab();
}


// Los cinco los invoca index.html con onclick inline; se publican desde aquí, que es donde
// viven ahora, en vez de desde ui_inventory.js.
exposeGlobals({
    renderDucanatorTab,
    setDucatSort,
    updateDucatThreshold,
    toggleDucatOwned,
    clearDucatSearch,
}, "ui.components/inventory/ui_ducanator.js");
