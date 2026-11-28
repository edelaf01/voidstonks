import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./ui_components.js";
import { momentoSets, ventaUrgente } from "../services/inventory/inventory.service.js";
import { serverNow } from "../services/server_clock.service.js";
import { getFreshnessInfo } from "./ui_data_freshness.js";

const STORAGE_KEY = "voidstonks_hoy_collapsed";
const MAX_LINES = 5;
const REFRESH_MS = 60 * 1000;

let initialized = false;
let loadGen = 0;
let lastData = { sets: [], urgentes: [], traders: null, loaded: false };

function isCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCollapsed(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    return;
  }
}

function hasPrimeInventory() {
  return Object.values(state.primeInventory || {}).some((qty) => Number(qty) > 0);
}

function formatRestante(iso) {
  const ms = Date.parse(iso) - serverNow();
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMin = Math.max(1, Math.floor(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

async function cargaTraders() {
  const fn = globalThis.resumenTraders || (await import("./farms/ui_traders.js")).resumenTraders;
  return fn ? fn() : null;
}

function buildLines(data, t) {
  const lines = [];
  if (hasPrimeInventory()) {
    const sellSeen = new Set();
    for (const f of data.sets || []) {
      if (f.estado === "vender" && f.propio) {
        sellSeen.add(f.nombre.toLowerCase());
        const conf = t.conf?.[f.confianza] || f.confianza || "";
        lines.push({ text: t.sell.replace("{n}", f.nombre).replace("{c}", conf), tab: "set" });
      }
    }
    for (const u of data.urgentes || []) {
      if (u.motivo !== "resurgenciaProxima" && u.motivo !== "bajando") continue;
      const base = u.name.replace(/\s+Set$/i, "").toLowerCase();
      if (sellSeen.has(base)) continue;
      sellSeen.add(base);
      const confKey = u.motivo === "resurgenciaProxima" ? "alta" : "media";
      const conf = t.conf?.[confKey] || confKey;
      lines.push({ text: t.sell.replace("{n}", u.name).replace("{c}", conf), tab: "set" });
    }
    for (const f of data.sets || []) {
      if (f.estado === "comprar" && (f.propio || f.confianza === "alta")) {
        const text = Number.isFinite(f.pct)
          ? t.buy.replace("{n}", f.nombre).replace("{pct}", String(f.pct))
          : t.buyShort.replace("{n}", f.nombre);
        lines.push({ text, tab: "set" });
      }
    }
  }
  const baro = data.traders?.baro;
  if (baro?.activo && baro.fin) {
    lines.push({ text: t.baro.replace("{t}", formatRestante(baro.fin)), tab: "bounties" });
  }
  const varzia = data.traders?.varzia;
  if (varzia?.activo && varzia.fin) {
    lines.push({ text: t.varzia.replace("{t}", formatRestante(varzia.fin)), tab: "bounties" });
  }
  return lines.slice(0, MAX_LINES);
}

function renderHoy() {
  const card = document.getElementById("hoy-card");
  if (!card) return;
  const t = TEXTS[state.currentLang]?.hoy || TEXTS.es.hoy;
  const collapsed = isCollapsed();
  const lines = lastData.loaded ? buildLines(lastData, t) : [];
  const fresh = getFreshnessInfo();

  let bodyInner;
  if (!lastData.loaded) {
    bodyInner = `<div class="hoy-empty">${escapeHTML(t.loading)}</div>`;
  } else if (!lines.length) {
    bodyInner = `<div class="hoy-empty">${escapeHTML(t.empty)}</div>`;
  } else {
    bodyInner = `<ul class="hoy-list">${lines
      .map(
        (l) =>
          `<li class="hoy-row"><span class="hoy-text">${escapeHTML(l.text)}</span><button type="button" class="hoy-link" data-tab="${escapeHTML(l.tab)}">${escapeHTML(t.view)}</button></li>`,
      )
      .join("")}</ul>`;
  }

  const footHtml = fresh
    ? `<div class="hoy-foot${fresh.warn ? " hoy-foot--warn" : ""}">${escapeHTML(fresh.text)}</div>`
    : "";

  const keepFocus =
    card.contains(document.activeElement) && document.activeElement.classList.contains("hoy-head");
  card.classList.toggle("is-collapsed", collapsed);
  card.innerHTML = `<button type="button" class="hoy-head" aria-expanded="${String(!collapsed)}" aria-controls="hoy-body"><span class="hoy-title">${escapeHTML(t.title)}</span><span class="hoy-chev" aria-hidden="true"></span></button><div id="hoy-body" class="hoy-body${collapsed ? " hidden" : ""}">${bodyInner}${footHtml}</div>`;
  if (keepFocus) card.querySelector(".hoy-head")?.focus();
}

async function refreshHoy() {
  const gen = ++loadGen;
  const inv = hasPrimeInventory();
  const [sets, urgentes, traders] = await Promise.all([
    momentoSets().catch(() => []),
    inv ? ventaUrgente().catch(() => []) : Promise.resolve([]),
    cargaTraders().catch(() => null),
  ]);
  if (gen !== loadGen) return;
  lastData = { sets, urgentes, traders, loaded: true };
  renderHoy();
}

export function initHoy() {
  if (initialized) return;
  const card = document.getElementById("hoy-card");
  if (!card) return;
  initialized = true;

  card.addEventListener("click", (e) => {
    const head = e.target.closest(".hoy-head");
    if (head) {
      setCollapsed(!isCollapsed());
      renderHoy();
      card.querySelector(".hoy-head")?.focus();
      return;
    }
    const link = e.target.closest(".hoy-link[data-tab]");
    if (link) globalThis.switchTab?.(link.dataset.tab);
  });

  renderHoy();
  state.subscribe("currentLang", renderHoy);
  state.subscribe("setsDatabase", () => queueMicrotask(refreshHoy));
  state.subscribe("primeInventory", () => queueMicrotask(refreshHoy));
  refreshHoy();
  setInterval(refreshHoy, REFRESH_MS);
}
