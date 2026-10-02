import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getSlug } from "../../utils/slugs.utils.js";
import { getItemIcon } from "../../utils/ui_utils.js";
import { getPriceValue, MEMORY_CACHE } from "../../services/market/prices.service.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { ducatsBeatSale } from "../../utils/inventory/reward_value.js";
import { ducadosDePieza } from "../../utils/inventory/catalog_parts.js";
import { copiasQueSobran } from "../../utils/inventory/baro_picks.js";
import { getSetName, getRequiredCount } from "../../utils/ui_utils.js";

export function getPartDucats(partName) {
  return ducadosDePieza(partName);
}

export function ducatRatio(ducats, plat) {
  if (!ducats || ducats <= 0) return 0;
  if (!plat || plat <= 0) return Infinity;
  return ducats / plat;
}

export function formatDucatRatio(ducats, plat) {
  const r = ducatRatio(ducats, plat);
  if (r === 0) return "";
  const txt = r === Infinity ? "∞" : r.toFixed(1);
  return `<span class="ratio-num">${txt}</span><span class="ratio-unit">d/pl</span>`;
}

export function renderDucanatorView(list, opts = {}) {
  const t = TEXTS[state.currentLang];
  const dt = t.ducanator || {};

  const searchInput = (opts.search || "").toLowerCase();
  const ownedOnly = opts.ownedOnly !== false;
  const keepSets = opts.keepSets !== false;
  const setDeps = { primeInventory: state.primeInventory, setsDatabase: state.setsDatabase, getSetName, getRequiredCount };
  const sortCol = opts.sortCol || "ratio";
  const sortDir = opts.sortDir || -1;
  const rerender = opts.rerender || null;

  const rows = Object.entries(state.primeInventory)
    .filter(([name, qty]) => !ownedOnly || qty > 0)
    .filter(([name]) => !searchInput || name.toLowerCase().includes(searchInput))
    .map(([name, qty]) => {
      const ducats = getPartDucats(name);
      const cachedRaw = MEMORY_CACHE.get(getSlug(name));
      const plat = cachedRaw !== undefined ? (Number.parseInt(cachedRaw, 10) || 0) : null;
      const eff = ducatRatio(ducats, plat === null ? 0 : plat);
      const { sobran, guardas } = keepSets ? copiasQueSobran(name, setDeps) : { sobran: qty, guardas: 0 };
      return { name, qty, ducats, plat, eff, sobran, guardas };
    })
    .filter((r) => r.ducats > 0);

  const effNum = (r) => (r.eff === Infinity ? Number.MAX_VALUE : r.eff);
  rows.sort((a, b) => {
    let cmp;
    if (sortCol === "name") cmp = a.name.localeCompare(b.name);
    else if (sortCol === "plat") cmp = (a.plat ?? -1) - (b.plat ?? -1);
    else if (sortCol === "ducats") cmp = a.ducats - b.ducats;
    else cmp = effNum(a) - effNum(b);
    return cmp * sortDir;
  });

  let fundableDucats = 0;
  let fundableParts = 0;
  let keepPlat = 0;
  const fundRows = [];
  const keepRows = [];
  const setRows = [];

  // Infinity stays out of the max on purpose: one unpriced part would shrink every other bar
  const maxFiniteEff = rows.reduce((m, r) => (r.eff !== Infinity && r.eff > m ? r.eff : m), 0);

  rows.forEach((r) => {
    const platReady = r.plat !== null;
    const shouldFund = !platReady || ducatsBeatSale(r.ducats, r.plat);
    const paraSet = shouldFund && r.qty > 0 && r.sobran === 0;
    if (platReady) {
      if (shouldFund) {
        fundableDucats += r.ducats * r.sobran;
        fundableParts += r.sobran;
      } else {
        keepPlat += r.plat * r.qty;
      }
    }
    const effTxt = r.eff === Infinity ? "∞" : r.eff.toFixed(1);
    const platTxt = platReady ? `${r.plat}` : "...";
    const effPct = r.eff === Infinity
      ? 100
      : (maxFiniteEff > 0 ? Math.max(6, Math.round((r.eff / maxFiniteEff) * 100)) : 0);
    const icon = getItemIcon(r.name);
    const iconHtml = icon
      ? `<img src="${icon}" class="duc-img item-icon-small" loading="lazy" onerror="this.style.visibility='hidden'">`
      : `<span class="duc-img duc-img-empty"></span>`;
    const visibles = shouldFund && !paraSet ? r.sobran : r.qty;
    const qtyHtml = visibles > 1 ? `<span class="duc-qty">×${visibles}</span>` : "";
    const guardaHtml = r.guardas > 0 && shouldFund
      ? `<span class="duc-keep-note">${escapeHTML((dt.keepsForSet || "keeps {n} for the set").replace("{n}", r.guardas))}</span>`
      : "";

    const html = `
      <div class="duc-row${shouldFund ? " is-fund" : ""}">
        <div class="duc-name-col">
          <span class="duc-img-wrap">${iconHtml}${qtyHtml}</span>
          <div class="duc-name-text">
            <a href="https://warframe.market/items/${getSlug(r.name)}" target="_blank" class="part-name duc-link">${escapeHTML(r.name)}</a>
            ${guardaHtml}
          </div>
        </div>
        <div class="duc-plat${platReady ? "" : " is-pending"}">${platTxt}<span class="plat-icon-inline"></span></div>
        <div class="duc-ducats">${r.ducats}<span class="ducat-icon-inline"></span></div>
        <div class="duc-eff" title="${escapeHTML(dt.effTitle || "Ducats per platinum")}">
          <span class="duc-eff-bar" style="width:${effPct}%"></span>
          <span class="duc-eff-num">${effTxt}</span>
        </div>
      </div>`;
    (paraSet ? setRows : shouldFund ? fundRows : keepRows).push(html);
  });

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

  const emptyMsg = dt.empty || "No prime parts with ducat value.";
  const emptyHint = dt.emptyHint || "";
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
        ? `<div class="duc-empty">${escapeHTML(emptyMsg)}`
          + (emptyHint ? `<span class="duc-empty-hint">${escapeHTML(emptyHint)}</span>` : "")
          + `</div>`
        : headerRow
          + section(dt.fundSection || "Trade for ducats", fundRows, "fund")
          + section(dt.keepSection || "Better to sell", keepRows, "keep")
          + section(dt.setSection || "Kept for your sets", setRows, "set")}
    </div>`;

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

let ducatSortCol = "ratio";
let ducatSortDir = -1;

export function setDucatSort(col) {
  if (ducatSortCol === col) {
    ducatSortDir = -ducatSortDir;
  } else {
    ducatSortCol = col;
    ducatSortDir = col === "name" ? 1 : -1;
  }
  renderDucanatorTab();
}

function alternaChip(cbId, chipId) {
  const cb = document.getElementById(cbId);
  if (!cb) return;
  cb.checked = !cb.checked;
  const chip = document.getElementById(chipId);
  if (chip) {
    chip.classList.toggle("active", cb.checked);
    chip.setAttribute("aria-pressed", String(cb.checked));
  }
  renderDucanatorTab();
}

export function toggleDucatOwned() {
  alternaChip("ducat-owned-only", "ducat-owned-chip");
}

export function toggleDucatSets() {
  alternaChip("ducat-keep-sets", "ducat-sets-chip");
}

export function clearDucatSearch() {
  const input = document.getElementById("ducat-search");
  if (!input) return;
  input.value = "";
  input.focus();
  renderDucanatorTab();
}

export function renderDucanatorTab() {
  const list = document.getElementById("ducat-content");
  if (!list) return;
  const search = document.getElementById("ducat-search")?.value || "";
  document.getElementById("ducat-search-clear")?.classList.toggle("hidden", search === "");
  const opts = {
    search,
    ownedOnly: document.getElementById("ducat-owned-only")?.checked !== false,
    keepSets: document.getElementById("ducat-keep-sets")?.checked !== false,
    sortCol: ducatSortCol,
    sortDir: ducatSortDir,
    rerender: () => {
      if (state.activeTab !== "ducat") return;
      renderDucanatorTab();
    },
  };
  renderDucanatorView(list, opts);
}

exposeGlobals({
    renderDucanatorTab,
    setDucatSort,
    toggleDucatOwned,
    toggleDucatSets,
    clearDucatSearch,
}, "ui.components/inventory/ui_ducanator.js");
