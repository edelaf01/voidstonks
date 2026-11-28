import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../ui_components.js";
import { serverNow } from "../../services/server_clock.service.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import { getItemIcon, progresoSets } from "../../utils/ui_utils.js";
import { farmLinkHtml } from "../../utils/farm_links.js";
import { applyIcon } from "../../utils/wfm_assets.js";
import { getPriceValue } from "../../services/market/prices.service.js";
import { getSlug } from "../../utils/slugs.utils.js";

const API = "https://api.warframestat.us/pc";
const CACHE_MS = 5 * 60 * 1000;

let cache = null;
let cacheAt = 0;
let tickInterval = null;
let reloadTimer = null;
let renderGen = 0;
let expiredRetries = 0;
let lastSig = null;
const MAX_EXPIRED_RETRIES = 6;

async function fetchJson(path) {
  const res = await fetch(`${API}/${path}?language=en`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let inflight = null;

async function loadTraders(force) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const [vault, baro, names] = await Promise.all([
      fetchJson("vaultTrader").catch(() => null),
      fetchJson("voidTrader").catch(() => null),
      loadNames(),
    ]);
    if (!vault && !baro) throw new Error("traders unavailable");
    resolvedNames = names;
    cache = { vault, baro };
    cacheAt = Date.now();
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

let resolvedNames = {};
let namesPromise = null;

function loadNames() {
  namesPromise ??= fetch("assets/json/eventos_prime.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((e) => e?._nombres || {})
    .catch(() => {
      namesPromise = null;
      return {};
    });
  return namesPromise;
}

function splitCamel(s) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
}

const RELIC_ERAS = { 1: "Lith", 2: "Meso", 3: "Neo", 4: "Axi" };
const RELIC_RE = /^T([1-4])VoidProjection(.+?)Vault([A-Z])/;
const PACK_RE = /^MPV.+(Single|Dual|Triple)Pack$/;

function lastSegment(entry) {
  return String(entry?.uniqueName || "").split("/").pop() || "";
}

function packBase(last) {
  return splitCamel(last.slice(3).replace(/(Single|Dual|Triple)?Pack$/, ""));
}

function packFrames(entry) {
  const last = lastSegment(entry);
  if (!/^MPV/.test(last)) return [];
  const m = packBase(last).match(/^(.+) Prime$/);
  if (!m) return [];
  const parts = m[1].split(" ");
  return /(Dual|Triple)Pack$/.test(last) ? parts.map((p) => `${p} Prime`) : [`${m[1]} Prime`];
}

export function prettyTraderItem(entry) {
  const resolved = resolvedNames[lastSegment(entry)];
  if (resolved) return resolved;
  const last = lastSegment(entry);
  const relic = last.match(RELIC_RE);
  if (relic) return `${RELIC_ERAS[relic[1]]} · ${splitCamel(relic[2]).split(" ").join(" & ")} · ${relic[3]}`;
  if (/^MPV/.test(last)) {
    const base = packBase(last);
    const frames = packFrames(entry);
    if (frames.length < 2) return base;
    const parts = frames.map((f) => f.replace(/ Prime$/, ""));
    return `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]} Prime`;
  }
  const candidates = [entry?.item, splitCamel(last)].filter(Boolean).map(genericName);
  const names = catalogueNames();
  for (const c of candidates) {
    const hit = names.get(nameKey(c));
    if (hit) return hit;
  }
  return candidates[0] || "";
}

function genericName(raw) {
  return String(raw)
    .trim()
    .replace(/\s+(Weapon|Item)$/, "")
    .replace(/^Prime\s+(.+)$/, "$1 Prime");
}

function nameKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RELIC_REF_RE = /\s*(?:\((?:intact|exceptional|flawless|radiant)\)|\b(?:relic|intact|exceptional|flawless|radiant)\b)/gi;

function relicKey(raw) {
  return nameKey(String(raw || "").replace(RELIC_REF_RE, ""));
}

function ownedRelics() {
  const map = new Map();
  const inv = state.inventory;
  if (Array.isArray(inv)) {
    for (const item of inv) {
      const isStr = typeof item === "string";
      const raw = isStr ? item : item?.name;
      const count = isStr ? 1 : Number(item?.count);
      if (!raw || !Number.isFinite(count) || count <= 0) continue;
      const k = relicKey(raw);
      if (k) map.set(k, (map.get(k) || 0) + count);
    }
  }
  return map;
}

let catalogueRefs = [];
let catalogueMap = new Map();

function catalogueNames() {
  const sources = [state.primeManifest, state.primeWeaponsManifest, state.setDePieza];
  if (sources.every((src, i) => src === catalogueRefs[i])) return catalogueMap;
  const map = new Map();
  const add = (n) => {
    if (typeof n === "string" && n) map.set(nameKey(n), n);
  };
  for (const list of sources.slice(0, 2)) if (Array.isArray(list)) list.forEach((e) => add(e?.name));
  if (state.setDePieza && typeof state.setDePieza === "object") Object.values(state.setDePieza).forEach((n) => add(String(n).replace(/\s+Set$/, "")));
  catalogueRefs = sources;
  catalogueMap = map;
  return map;
}

function formatCountdown(ms) {
  if (ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso) {
  const locale = state.currentLang === "es" ? "es-ES" : "en-GB";
  return new Date(iso).toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function nextVaultRotation(vault, now) {
  const schedule = Array.isArray(vault?.schedule) ? vault.schedule : [];
  const idx = schedule.findIndex((s) => Date.parse(s.expiry) > now);
  if (idx < 0) return null;
  const current = schedule[idx];
  const next = schedule[idx + 1];
  if (!next) return null;
  return { item: next, start: current.expiry };
}

function countdownHtml(target) {
  return `<span class="tr-countdown" data-target="${Date.parse(target)}">${formatCountdown(Date.parse(target) - serverNow())}</span>`;
}

function iconsHtml(names) {
  const imgs = names
    .map((n) => getItemIcon(n))
    .filter(Boolean)
    .map((src) => `<img src="${escapeHTML(src)}" class="tr-icon" alt="" loading="lazy" onerror="this.remove()">`)
    .join("");
  return imgs ? `<span class="tr-icons">${imgs}</span>` : "";
}

function relicTierHtml(entry) {
  const era = lastSegment(entry).match(RELIC_RE);
  return era ? `<span class="tr-icons"><span class="relic-era-icon tr-era ${RELIC_ERAS[era[1]].toLowerCase()}"></span></span>` : "";
}

function modIconHtml(entry) {
  return `<span class="tr-icons"><img class="tr-icon" data-icon-name="${escapeHTML(prettyTraderItem(entry))}" alt="" loading="lazy"></span>`;
}

function hydrateModIcons(root) {
  root.querySelectorAll("img[data-icon-name]").forEach((img) => applyIcon(img, img.dataset.iconName));
}

function hydrateBaroPrices(root, gen, t) {
  const unit = t?.platPerDucat || "p/d";
  root.querySelectorAll(".tr-item-cost[data-price-name]").forEach((el) => {
    const name = el.dataset.priceName;
    const slug = getSlug(name);
    if (!slug) return;
    const ducats = Number(el.dataset.ducats);
    getPriceValue(name, slug)
      .then((plat) => {
        if (gen !== renderGen || !el.isConnected) return;
        const price = Number(plat);
        if (!Number.isFinite(price) || price <= 0) return;
        const span = document.createElement("span");
        span.className = "tr-plat";
        const ratio = ducats > 0 ? ` · ${(price / ducats).toFixed(2)} ${escapeHTML(unit)}` : "";
        span.innerHTML = `${escapeHTML(String(Math.round(price)))}<span class="plat-icon-inline tr-coin"></span>${ratio}`;
        el.appendChild(span);
      })
      .catch(() => {});
  });
}

function selfIcon(entry) {
  return [prettyTraderItem(entry)];
}

function itemListHtml(items, costLabel, withCredits, opts = {}) {
  if (!items.length) return "";
  const cls = opts.tiles ? "tr-items tr-items--tiles" : "tr-items";
  const itemCls = opts.itemClass ? `tr-item ${opts.itemClass}` : "tr-item";
  const t = opts.t || TEXTS[state.currentLang]?.traders || {};
  const rows = items.map((it) => {
    const sets = opts.sets ? opts.sets(it) : [];
    const prog = sets.length ? progresoSets(sets) : null;
    const rank = !prog?.total ? 3 : prog.sets > 0 ? 0 : prog.tengo > 0 ? 1 : 2;
    return { it, sets, prog, rank };
  });
  if (opts.sets) rows.sort((a, b) => a.rank - b.rank);
  const relicsOwned = opts.linkKind === "relic" ? ownedRelics() : null;
  return `<ul class="${cls}">${rows
    .map(({ it, sets, prog }) => {
      const costs = [];
      if (it.ducats != null) costs.push(`${escapeHTML(String(it.ducats))}<span class="${opts.coin === "regal-aya" ? "regal-aya-icon-inline" : opts.coin === "aya" ? "aya-icon-inline" : "ducat-icon-inline"} tr-coin" title="${escapeHTML(costLabel)}"></span>`);
      if (withCredits && it.credits != null)
        costs.push(`${escapeHTML(Number(it.credits).toLocaleString())}<span class="credit-icon-inline tr-coin" title="cr"></span>`);
      const icons = opts.iconsHtml ? opts.iconsHtml(it) : opts.icons ? iconsHtml(opts.icons(it)) : "";
      const name = prettyTraderItem(it);
      const rotTag = opts.rotating?.has(name) ? `<span class="tr-rot-tag">${escapeHTML(t.inRotation || "in rotation")}</span>` : "";
      if (prog?.total) return setItemHtml(name, icons, costs, sets, prog, t, rotTag, opts.linkKind);
      const nameHtml = opts.linkKind ? farmLinkHtml(name, opts.linkKind) : escapeHTML(name);
      const ownCount = relicsOwned ? relicsOwned.get(relicKey(name)) || 0 : 0;
      const ownTag = ownCount > 0 ? `<span class="tr-own">${escapeHTML((t.owned || "You own x{n}").replace("{n}", String(ownCount)))}</span>` : "";
      const tags = `${rotTag}${ownTag}`;
      const label = tags
        ? `<span class="tr-name-wrap"><span class="tr-item-name">${nameHtml}</span>${tags}</span>`
        : `<span class="tr-item-name">${nameHtml}</span>`;
      const priceAttrs =
        (!opts.coin || opts.coin === "ducats") && it.ducats != null
          ? ` data-price-name="${escapeHTML(name)}" data-ducats="${escapeHTML(String(it.ducats))}"`
          : "";
      return `<li class="${itemCls}">${icons || `<span class="tr-icons"></span>`}${label}<span class="tr-item-cost"${priceAttrs}>${costs.join(" · ")}</span></li>`;
    })
    .join("")}</ul>`;
}

function setItemHtml(name, icons, costs, sets, prog, t = TEXTS[state.currentLang]?.traders || {}, rotTag = "", linkKind = null) {
  const varios = sets.length > 1;
  const full = prog.sets || 0;
  const have = prog.tengo || 0;
  const status = full > 0 ? "done" : have > 0 ? "part" : "none";
  const pct = full > 0 ? 100 : Math.min(100, Math.round((have / prog.total) * 100));
  const badge = full === 1 ? `✓ ${t.complete || "Complete"}` : full > 1 ? `✓ ×${full}` : `${have}/${prog.total}`;
  const cuerpo = sets
    .map((set) => {
      const piezas = prog.piezas.filter((p) => p.set === set);
      if (!piezas.length) return "";
      const setHave = piezas.reduce((s, p) => s + Math.min(p.qty, p.req), 0);
      const setTotal = piezas.reduce((s, p) => s + p.req, 0);
      const cab = varios
        ? `<li class="tr-set-sub"><span class="tr-set-sub-name">${escapeHTML(set)}</span><span class="tr-set-sub-count">${escapeHTML(`${setHave}/${setTotal}`)}</span></li>`
        : "";
      return (
        cab +
        piezas
          .map((p) => {
            const extra = p.qty - p.req;
            const cls = extra > 0 ? " ok dup" : p.qty >= p.req ? " ok" : p.qty === 0 ? " empty" : "";
            const icon = getItemIcon(p.name);
            const img = icon
              ? `<img class="item-icon-mini tr-part-icon" src="${escapeHTML(icon)}" alt="" loading="lazy" onerror="this.remove()">`
              : "";
            const label = p.name.startsWith(`${set} `) ? p.name.slice(set.length + 1) : p.name;
            const dupTag = extra > 0 ? `<span class="tr-part-dup" title="${escapeHTML((t.extraPart || "+{n} extra").replace("{n}", String(extra)))}">+${extra}</span>` : "";
            return `<li class="tr-set-part${cls}">${img}<span class="tr-part-name">${escapeHTML(label)}</span><span class="tr-part-count">${escapeHTML(`${p.qty}/${p.req}`)}</span>${dupTag}</li>`;
          })
          .join("")
      );
    })
    .join("");
  const nameHtml = linkKind ? farmLinkHtml(name, linkKind) : escapeHTML(name);
  const title = rotTag
    ? `<span class="tr-name-wrap"><span class="tr-item-name">${nameHtml}</span>${rotTag}</span>`
    : `<span class="tr-item-name">${nameHtml}</span>`;
  return `<li class="tr-item tr-set tr-set--${status}"><details><summary class="tr-set-head">${icons || `<span class="tr-icons"><span class="tr-icon"></span></span>`}${title}<span class="tr-set-badge ${status}">${escapeHTML(badge)}</span><span class="tr-item-cost">${costs.join(" · ")}</span><span class="tr-set-bar"><i style="width:${pct}%"></i></span></summary><ul class="tr-set-parts">${cuerpo}</ul></details></li>`;
}

function groupHtml(label, items, costLabel, withCredits, opts) {
  const list = itemListHtml(items, costLabel, withCredits, opts);
  return list ? `<section class="tr-group"><div class="tr-section-label">${escapeHTML(label)}<span class="tr-count">${items.length}</span></div>${list}</section>` : "";
}

export function isPrimedMod(entry) {
  const u = String(entry?.uniqueName || "");
  return /\/Upgrades\/Mods\//.test(u) && (/Expert$/.test(lastSegment(entry)) || /^Primed /.test(String(entry?.item || "")));
}

export function isTraderStance(entry) {
  return /\/MeleeTrees\//.test(String(entry?.uniqueName || ""));
}

export function isTraderWeapon(entry) {
  return /^\/Lotus\/(StoreItems\/)?Weapons\//.test(String(entry?.uniqueName || "")) && !isTraderStance(entry);
}

function isTraderFrame(entry) {
  return /^\/Lotus\/(StoreItems\/)?Powersuits\//.test(String(entry?.uniqueName || ""));
}

function varziaHtml(vault, t) {
  if (!vault) return `<div class="tr-card"><div class="tr-empty">${escapeHTML(t.unavailable)}</div></div>`;
  const now = serverNow();
  const inv = Array.isArray(vault.inventory) ? vault.inventory : [];
  const packs = inv.filter((it) => PACK_RE.test(lastSegment(it)));
  const rotating = new Set(packs.flatMap(packFrames));
  const relics = inv
    .filter((it) => RELIC_RE.test(lastSegment(it)))
    .map((it) => ({ ...it, ducats: it.ducats ?? it.credits }));
  const groups =
    groupHtml(t.rotation, packs, t.regalAya, false, { coin: "regal-aya", icons: packFrames, tiles: true, itemClass: "tr-pack" }) +
    groupHtml(t.yourWarframes, inv.filter(isTraderFrame), t.regalAya, false, { coin: "regal-aya", icons: selfIcon, sets: selfIcon, rotating, t }) +
    groupHtml(t.yourWeapons, inv.filter(isTraderWeapon), t.regalAya, false, { coin: "regal-aya", icons: selfIcon, sets: selfIcon, rotating, t, linkKind: "weapon" }) +
    groupHtml(t.relics, relics, t.aya, false, { coin: "aya", iconsHtml: relicTierHtml, linkKind: "relic" });
  const next = nextVaultRotation(vault, now);
  const nextHtml = next
    ? `<div class="tr-next">
        <div class="tr-next-label">${escapeHTML(t.nextRotation)}</div>
        <div class="tr-next-row">${iconsHtml(packFrames(next.item))}<div class="tr-next-name">${escapeHTML(prettyTraderItem(next.item))}</div></div>
        <div class="tr-meta">${escapeHTML(t.startsAt)} ${escapeHTML(formatDate(next.start))} · ${countdownHtml(next.start)}</div>
      </div>`
    : "";
  return `<div class="tr-card">
      <div class="tr-card-head">
        <div>
          <div class="tr-name">${escapeHTML(vault.character || "Varzia")}</div>
          <div class="tr-meta">${escapeHTML(vault.location || "")}</div>
        </div>
        <div class="tr-timer">
          <div class="tr-timer-label">${escapeHTML(t.until)} ${escapeHTML(formatDate(vault.expiry))}</div>
          ${countdownHtml(vault.expiry)}
        </div>
      </div>
      ${groups ? `<div class="tr-groups">${groups}</div>` : `<div class="tr-empty">${escapeHTML(t.noItems)}</div>`}
      ${nextHtml}
    </div>`;
}

function baroHtml(baro, t) {
  if (!baro) return `<div class="tr-card"><div class="tr-empty">${escapeHTML(t.unavailable)}</div></div>`;
  const now = serverNow();
  const active = Date.parse(baro.activation) <= now && now < Date.parse(baro.expiry);
  const inv = Array.isArray(baro.inventory) ? baro.inventory : [];
  const timer = active
    ? `<div class="tr-timer-label">${escapeHTML(t.leavesIn)}</div>${countdownHtml(baro.expiry)}`
    : `<div class="tr-timer-label">${escapeHTML(t.arrivesIn)}</div>${countdownHtml(baro.activation)}`;
  const groups =
    groupHtml(t.primedMods, inv.filter(isPrimedMod), t.ducats, true, { iconsHtml: modIconHtml }) +
    groupHtml(t.stances, inv.filter(isTraderStance), t.ducats, true, { iconsHtml: modIconHtml }) +
    groupHtml(t.weapons, inv.filter(isTraderWeapon), t.ducats, true, { icons: selfIcon, linkKind: "weapon" });
  const body = active
    ? groups || `<div class="tr-empty">${escapeHTML(t.noItems)}</div>`
    : `<div class="tr-meta">${escapeHTML(t.arrives)} ${escapeHTML(formatDate(baro.activation))} · ${escapeHTML(t.leaves)} ${escapeHTML(formatDate(baro.expiry))}</div>`;
  return `<div class="tr-card">
      <div class="tr-card-head">
        <div>
          <div class="tr-name">${escapeHTML(baro.character || "Baro Ki'Teer")}</div>
          <div class="tr-meta">${escapeHTML(baro.location || "")}</div>
        </div>
        <div class="tr-timer">${timer}</div>
      </div>
      ${body}
    </div>`;
}

function tradersSig(data) {
  const v = data.vault;
  const b = data.baro;
  return JSON.stringify([v?.expiry, (v?.schedule || []).map((s) => s.expiry), b?.activation, b?.expiry]);
}

function startTicker() {
  stopTradersTimers();
  tickInterval = setInterval(() => {
    const now = serverNow();
    let expired = false;
    document.querySelectorAll("#traders-container .tr-countdown").forEach((el) => {
      const left = Number(el.dataset.target) - now;
      el.textContent = formatCountdown(left);
      if (left <= 0) expired = true;
    });
    if (expired && !reloadTimer && expiredRetries < MAX_EXPIRED_RETRIES) {
      expiredRetries++;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        renderTradersTab(true, true);
      }, 5000);
    }
  }, 1000);
}

export async function renderTradersTab(force = false, auto = false) {
  const container = document.getElementById("traders-container");
  if (!container) return;
  const t = TEXTS[state.currentLang].traders;
  const gen = ++renderGen;
  if (!auto) expiredRetries = 0;
  if (!cache || force) {
    container.innerHTML = `<div class="tr-loading"><div class="spinner"></div>${escapeHTML(t.loading)}</div>`;
  }
  try {
    const data = await loadTraders(force);
    if (gen !== renderGen) return;
    const sig = tradersSig(data);
    if (sig !== lastSig) {
      lastSig = sig;
      expiredRetries = 0;
    }
    container.innerHTML = `<div class="lw-header">
        <div class="lw-title">${escapeHTML(t.title)}</div>
        <div class="lw-subtitle">${escapeHTML(t.subtitle)}</div>
      </div>
      <div class="tr-grid">
        <section class="tr-col"><div class="tr-col-title">${escapeHTML(t.varzia)}</div>${varziaHtml(data.vault, t)}</section>
        <section class="tr-col"><div class="tr-col-title">${escapeHTML(t.baro)}</div>${baroHtml(data.baro, t)}</section>
      </div>`;
    hydrateModIcons(container);
    hydrateBaroPrices(container, gen, t);
    startTicker();
  } catch {
    if (gen !== renderGen) return;
    stopTradersTimers();
    container.innerHTML = `<div class="tr-error">
        <div>${escapeHTML(t.error)}</div>
        <button type="button" class="tr-retry" onclick="globalThis.retryTraders()">${escapeHTML(t.retry)}</button>
      </div>`;
  }
}

export function stopTradersTimers() {
  renderGen++;
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
}

export async function resumenTraders() {
  const { baro, vault } = await loadTraders(false);
  const now = serverNow();
  const baroIni = Date.parse(baro?.activation || "");
  const baroFin = Date.parse(baro?.expiry || "");
  const baroActivo = Number.isFinite(baroIni) && Number.isFinite(baroFin) && baroIni <= now && now < baroFin;
  const varziaIni = Date.parse(vault?.activation || "");
  const varziaFin = Date.parse(vault?.expiry || "");
  const varziaActivo = Number.isFinite(varziaFin) && now < varziaFin && (!Number.isFinite(varziaIni) || varziaIni <= now);
  return {
    baro: { activo: baroActivo, fin: baroActivo ? baro.expiry : null },
    varzia: { activo: varziaActivo, fin: varziaActivo ? vault.expiry : null },
  };
}

async function varziaExpiry() {
  try {
    return (await loadTraders(false))?.vault?.expiry || null;
  } catch {
    return null;
  }
}

exposeGlobals({ retryTraders: () => renderTradersTab(true), varziaExpiry, resumenTraders }, "ui.components/farms/ui_traders.js");
