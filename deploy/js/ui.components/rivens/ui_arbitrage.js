import { state, saveAppState } from "../../state.js";
import { TEXTS } from "../../config.js";
import { showToast, escapeHTML } from "../ui_components.js";
import { fetchArbitrage, fetchLiveOrders } from "../../repositories/riven.repository.js";

const PLAT = `<img src="assets/relic_contents/platinum.webp" style="width:11px;height:11px;vertical-align:middle;">`;
let lastSnapshot = null; // último snapshot crudo, para re-filtrar sin re-pedir

function arbT() {
  return (TEXTS[state.currentLang] || {}).arbitrage || {};
}

function arbCfg() {
  const d = { minSpread: 5, minPct: 8, minPrice: 0, sort: "spread" };
  return { ...d, ...(state.arbSettings || {}) };
}

// Aplica los parámetros ajustables (filtro + orden) sobre las oportunidades del snapshot.
function filteredOps() {
  const ops = (lastSnapshot?.opportunities) || [];
  const c = arbCfg();
  const out = ops.filter(o =>
    o.spread >= c.minSpread && o.pct >= c.minPct && o.sell >= c.minPrice
  );
  if (c.sort === "pct") out.sort((a, b) => b.pct - a.pct);
  else if (c.sort === "price") out.sort((a, b) => b.buy - a.buy);
  else out.sort((a, b) => b.spread - a.spread);
  return out;
}

function ageBadge(ts, live) {
  if (live) return `<span class="arb-age" style="font-size:0.55rem;color:#42f56c;margin-left:5px;font-weight:bold;">● LIVE</span>`;
  if (!ts) return `<span class="arb-age"></span>`;
  const mins = (Date.now() - ts) / 60000;
  let txt, color;
  if (mins < 15) { color = "#42f56c"; txt = mins < 1 ? "<1m" : `${Math.round(mins)}m`; }
  else if (mins < 120) { color = "#e0b040"; txt = `${Math.round(mins)}m`; }
  else { color = "#ff6666"; const h = mins / 60; txt = h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`; }
  return `<span class="arb-age" title="Antigüedad del dato" style="font-size:0.55rem;color:${color};margin-left:5px;">⏱ ${txt}</span>`;
}

function arbRowHtml(o) {
  const rankBadge = (o.rank !== null && o.rank !== undefined)
    ? `<span style="font-size:0.6rem;color:#c59afc;border:1px solid rgba(155,89,182,0.4);border-radius:3px;padding:0 3px;margin-left:4px;">R${o.rank}</span>`
    : "";
  const slug = escapeHTML(o.slug);
  const name = escapeHTML(o.name);
  return `
    <div class="arb-row" data-slug="${slug}" style="display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(155,89,182,0.12);border-radius:6px;padding:7px 9px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.8rem;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}${rankBadge}${ageBadge(o.ts)}</div>
        <div style="font-size:0.68rem;color:#999;margin-top:2px;">
          <span>buy @<b class="arb-sell" style="color:#ddd;">${o.sell}</b>${PLAT}</span>
          <span style="margin:0 4px;color:#555;">→</span>
          <span>sell @<b class="arb-buy" style="color:#ddd;">${o.buy}</b>${PLAT}</span>
        </div>
      </div>
      <div class="arb-profit" style="text-align:right;color:#42f56c;font-weight:bold;font-size:0.82rem;line-height:1.1;white-space:nowrap;">
        +${o.spread}p<br><span style="font-size:0.62rem;font-weight:normal;opacity:0.85;">${o.pct}%</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
        <button onclick="verifyArbItem('${slug}', this)" title="Verificar en vivo"
          style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:rgba(66,245,108,0.1);border:1px solid rgba(66,245,108,0.25);color:#42f56c;cursor:pointer;">↻</button>
        <a href="https://warframe.market/items/${slug}" target="_blank" title="Warframe Market"
          style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:rgba(155,89,182,0.12);border:1px solid rgba(155,89,182,0.25);color:#c59afc;text-align:center;text-decoration:none;">↗</a>
      </div>
    </div>`;
}

// Presets de un click (lenguaje claro, sin jerga). Definen ganancia/margen mínimos.
const ARB_PRESETS = {
  all:   { icon: "🔍", minSpread: 1,  minPct: 1,  minPrice: 0 },
  small: { icon: "🪙", minSpread: 3,  minPct: 5,  minPrice: 0 },
  good:  { icon: "⭐", minSpread: 10, minPct: 15, minPrice: 0 },
  big:   { icon: "💎", minSpread: 30, minPct: 25, minPrice: 0 },
};
let arbAdvOpen = false;

function activePreset(c) {
  for (const k in ARB_PRESETS) {
    const p = ARB_PRESETS[k];
    if (p.minSpread === c.minSpread && p.minPct === c.minPct && p.minPrice === c.minPrice) return k;
  }
  return null;
}

function slider(id, label, value, max, step, unit) {
  return `<div style="flex:1 1 150px;min-width:150px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.7rem;color:#bbb;margin-bottom:4px;">
      <span>${label}</span>
      <span id="arb-val-${id}" style="color:#c59afc;font-weight:bold;">≥ ${value}${unit}</span>
    </div>
    <input type="range" min="0" max="${max}" step="${step}" value="${Math.min(value, max)}"
      oninput="setArbParam('${id}', this.value, '${unit}')" onchange="buildArbControls()"
      style="width:100%;accent-color:#9b59b6;cursor:pointer;">
  </div>`;
}

function buildArbControls() {
  const box = document.getElementById("arb-controls");
  if (!box) return;
  const t = arbT();
  const c = arbCfg();
  const ap = activePreset(c);

  const presetChip = (k, label) => {
    const p = ARB_PRESETS[k], on = ap === k;
    return `<button onclick="setArbPreset('${k}')" style="flex:1;min-width:72px;padding:8px 6px;cursor:pointer;border-radius:8px;
      border:1px solid ${on ? "rgba(155,89,182,0.7)" : "rgba(155,89,182,0.2)"};
      background:${on ? "rgba(155,89,182,0.3)" : "rgba(0,0,0,0.25)"};color:${on ? "#fff" : "#bbb"};
      font-size:0.72rem;font-weight:${on ? "bold" : "normal"};display:flex;flex-direction:column;align-items:center;gap:3px;transition:all .15s;">
      <span style="font-size:1.1rem;line-height:1;">${p.icon}</span>${escapeHTML(label)}</button>`;
  };

  const sortBtn = (v, lbl) => {
    const on = c.sort === v;
    return `<button onclick="setArbSort('${v}')" style="flex:1;padding:5px 4px;font-size:0.7rem;cursor:pointer;border:none;
      background:${on ? "rgba(155,89,182,0.35)" : "transparent"};color:${on ? "#fff" : "#999"};font-weight:${on ? "bold" : "normal"};">${escapeHTML(lbl)}</button>`;
  };

  box.innerHTML = `
    <div style="width:100%;font-size:0.66rem;color:#888;margin-bottom:6px;">${escapeHTML(t.presetHint || "¿Cuánto beneficio buscas?")}</div>
    <div style="display:flex;gap:6px;width:100%;flex-wrap:wrap;">
      ${presetChip("all", t.presetAll || "Todos")}
      ${presetChip("small", t.presetSmall || "Pequeños")}
      ${presetChip("good", t.presetGood || "Buenos")}
      ${presetChip("big", t.presetBig || "Pelotazos")}
    </div>

    <button onclick="toggleArbAdvanced()" style="width:100%;margin-top:8px;text-align:left;background:none;border:none;color:#c59afc;font-size:0.7rem;cursor:pointer;padding:2px 0;">
      ${arbAdvOpen ? "▾" : "▸"} ${escapeHTML(t.advanced || "Ajustes finos")}
    </button>
    <div style="width:100%;${arbAdvOpen ? "" : "display:none;"}">
      <div style="display:flex;flex-wrap:wrap;gap:14px;width:100%;padding:6px 0;">
        ${slider("minSpread", t.minSpread || "💰 Ganancia por flip", c.minSpread, 150, 1, "p")}
        ${slider("minPct", t.minPct || "📈 Rentabilidad", c.minPct, 100, 1, "%")}
        ${slider("minPrice", t.minPrice || "🏷️ Precio del ítem", c.minPrice, 500, 5, "p")}
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:8px;width:100%;margin-top:8px;">
      <span style="font-size:0.62rem;color:#999;text-transform:uppercase;flex-shrink:0;">${escapeHTML(t.sortBy || "Ordenar")}</span>
      <div style="display:flex;flex:1;border-radius:6px;overflow:hidden;border:1px solid rgba(155,89,182,0.3);">
        ${sortBtn("spread", t.sortSpread || "Ganancia")}${sortBtn("pct", t.sortPct || "Rentab.")}${sortBtn("price", t.sortPrice || "Precio")}
      </div>
    </div>`;
}

function renderArbList() {
  const list = document.getElementById("arb-list");
  const meta = document.getElementById("arb-meta");
  if (!list) return;
  const t = arbT();
  const ops = filteredOps();
  if (meta && lastSnapshot) {
    const when = lastSnapshot.generated ? new Date(lastSnapshot.generated).toLocaleTimeString() : "—";
    const total = lastSnapshot.total || 0;
    const inv = lastSnapshot.scanned || 0;
    meta.textContent = `${t.updated || "Actualizado"}: ${when} · ${t.inventory || "inventario"}: ${inv}/${total} · ${ops.length} ${t.shown || "mostrados"}`;
  }
  if (!ops.length) {
    list.innerHTML = `<div style="text-align:center;color:#888;font-size:0.78rem;padding:14px;font-style:italic;">${escapeHTML(t.empty || "Sin oportunidades con estos filtros.")}</div>`;
    return;
  }
  list.innerHTML = ops.map(arbRowHtml).join("");
}

export function applyArbTexts() {
  const t = arbT();
  const set = (id, txt) => { const el = document.getElementById(id); if (el && txt) el.textContent = txt; };
  set("lbl-arb-title", t.title);
  set("arb-disclaimer", t.disclaimer);
  const r = document.getElementById("lbl-arb-refresh");
  if (r && t.refresh) r.textContent = "↻ " + t.refresh;
  if (document.getElementById("arb-controls")?.children.length) buildArbControls();
}

export async function renderArbitrage() {
  const list = document.getElementById("arb-list");
  if (!list) return;
  const t = arbT();
  buildArbControls();
  list.innerHTML = `<div style="text-align:center;color:#888;font-size:0.8rem;padding:14px;">${escapeHTML(t.loading || "Cargando…")}</div>`;
  try {
    lastSnapshot = await fetchArbitrage();
    renderArbList();
  } catch (e) {
    lastSnapshot = null;
    list.innerHTML = `<div style="text-align:center;color:#ff6666;font-size:0.78rem;padding:14px;">${escapeHTML(t.error || "Error al cargar.")}</div>`;
  }
}

// Slider: actualiza el valor en vivo + re-filtra al instante (sin re-pedir al worker).
export function setArbParam(key, value, unit = "") {
  const cfg = arbCfg();
  cfg[key] = Math.max(0, parseFloat(value) || 0);
  state.arbSettings = cfg;
  saveAppState();
  const lbl = document.getElementById(`arb-val-${key}`);
  if (lbl) lbl.textContent = `≥ ${cfg[key]}${unit}`;
  renderArbList();
}

// Preset de un click: fija ganancia/margen/precio mínimos.
export function setArbPreset(name) {
  const p = ARB_PRESETS[name];
  if (!p) return;
  state.arbSettings = { ...arbCfg(), minSpread: p.minSpread, minPct: p.minPct, minPrice: p.minPrice };
  saveAppState();
  buildArbControls();
  renderArbList();
}

export function setArbSort(v) {
  state.arbSettings = { ...arbCfg(), sort: v };
  saveAppState();
  buildArbControls();
  renderArbList();
}

export function toggleArbAdvanced() {
  arbAdvOpen = !arbAdvOpen;
  buildArbControls();
}

export function toggleArbitrage() {
  const body = document.getElementById("arb-body");
  const icon = document.getElementById("arb-toggle-icon");
  if (!body) return;
  const hidden = body.classList.toggle("hidden");
  if (icon) icon.textContent = hidden ? "▼" : "▲";
  if (!hidden) renderArbitrage();   // lazy: solo pega al endpoint al abrir
}

export async function verifyArbItem(slug, btn) {
  const t = arbT();
  const row = btn.closest(".arb-row");
  if (!row) return;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "…";
  try {
    const d = await fetchLiveOrders(slug);
    const sell = d.sell || 0, buy = d.buy || 0;
    const spread = buy - sell;
    const pct = sell > 0 ? (spread / sell) * 100 : 0;
    row.querySelector(".arb-sell").textContent = sell;
    row.querySelector(".arb-buy").textContent = buy;
    const pEl = row.querySelector(".arb-profit");
    pEl.innerHTML = `${spread >= 0 ? "+" : ""}${spread}p<br><span style="font-size:0.62rem;font-weight:normal;opacity:0.85;">${pct.toFixed(1)}%</span>`;
    pEl.style.color = spread > 0 ? "#42f56c" : "#ff6666";
    const badge = row.querySelector(".arb-age");
    if (badge) { badge.textContent = "● LIVE"; badge.style.cssText = "font-size:0.55rem;color:#42f56c;margin-left:5px;font-weight:bold;"; }
    showToast(t.verified || "Verificado en vivo");
  } catch (e) {
    showToast(t.error || "Error");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

export function refreshArbitrage() {
  const body = document.getElementById("arb-body");
  if (body && !body.classList.contains("hidden")) renderArbitrage();
}

Object.assign(globalThis, {
  toggleArbitrage,
  verifyArbItem,
  refreshArbitrage,
  setArbParam,
  setArbPreset,
  setArbSort,
  toggleArbAdvanced,
  buildArbControls,
});
