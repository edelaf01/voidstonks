import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./ui_components.js";
import { damageMeta, damageIconHtml } from "../utils/damage_types.js";
import { fetchLichWeapons } from "../services/lich_weapons.service.js";
import { serverNow, isClockSynced } from "../utils/server_clock.js";

let rotationInterval = null;
let rotationReloadAt = 0;

const VENDOR_STYLE = {
  eleanor: { color: "#42f56c", icon: "assets/farm.webp" },
  glast: { color: "#00e5ff", icon: "assets/farm.webp" },
};

// game rolls valence bonus between 25% and 60%: the bar measures inside that range
const BONUS_MIN = 25;
const BONUS_MAX = 60;

function weaponIconPath(name) {
  const slug = String(name).toLowerCase().trim().replaceAll(/\s+/g, "_").replaceAll(/[^a-z0-9_]/g, "");
  return `assets/relic_contents/${slug}.webp`;
}

function pct(value) {
  return `${Math.round(Number(value) * 10) / 10}`;
}

function bonusHtml(bonus, t) {
  if (!bonus) {
    return `<div class="lw-bonus is-missing">${escapeHTML(t.lichWeapons.bonusUnknown)}</div>`;
  }
  const meta = damageMeta(bonus.element, state.currentLang);
  const ratio = (Number(bonus.percent) - BONUS_MIN) / (BONUS_MAX - BONUS_MIN);
  const width = Math.max(0, Math.min(1, ratio)) * 100;
  return `
      <div class="lw-bonus" style="--bonus-color:${meta.color};">
          <div class="lw-bonus-top">
              <span class="lw-bonus-el">${damageIconHtml(bonus.element, 15)}${escapeHTML(meta.label)}</span>
              <span class="lw-bonus-pct">+${escapeHTML(pct(bonus.percent))}%</span>
          </div>
          <div class="lw-bonus-bar"><i style="width:${width.toFixed(1)}%;"></i></div>
      </div>`;
}

function dispositionHtml(w, t) {
  if (!w.disposition) return "";
  const dots = [1, 2, 3, 4, 5]
    .map((n) => `<i class="${n <= w.disposition ? "on" : ""}"></i>`)
    .join("");
  const exact = w.dispositionValue ? ` (×${(Math.round(w.dispositionValue * 100) / 100).toFixed(2)})` : "";
  const tip = `${t.lichWeapons.disposition}: ${w.disposition}/5${exact}`;
  return `<span class="lw-disp" title="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}">${dots}</span>`;
}

function damageBreakdownHtml(w) {
  if (!Array.isArray(w.damage) || w.damage.length === 0) return "";
  const rows = [...w.damage]
    .sort((a, b) => b.value - a.value)
    .map((d) => {
      const meta = damageMeta(d.type, state.currentLang);
      return `<span class="lw-dmg-chip" style="--dmg-color:${meta.color};">${damageIconHtml(d.type, 13)}${escapeHTML(String(Math.round(d.value)))}</span>`;
    })
    .join("");
  return `<div class="lw-dmg-row">${rows}</div>`;
}

function statsHtml(w, t) {
  const L = t.lichWeapons;
  const cells = [];
  const push = (label, value) => cells.push(
    `<div class="lw-stat"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`,
  );

  if (w.totalDamage != null) push(L.statDamage, String(Math.round(w.totalDamage)));
  if (w.criticalChance != null) push(L.statCrit, `${pct(w.criticalChance * 100)}%`);
  if (w.criticalMultiplier != null) push(L.statCritMult, `×${pct(w.criticalMultiplier)}`);
  if (w.procChance != null) push(L.statStatus, `${pct(w.procChance * 100)}%`);
  if (w.fireRate != null) push(w.category === "Melee" ? L.statAttackSpeed : L.statFireRate, pct(w.fireRate));
  if (w.multishot != null && w.multishot > 1) push(L.statMultishot, pct(w.multishot));
  if (w.magazineSize != null) push(L.statMagazine, String(w.magazineSize));
  if (w.reloadTime != null) push(L.statReload, `${pct(w.reloadTime)}s`);

  return cells.length ? `<dl class="lw-stats">${cells.join("")}</dl>` : "";
}

function categoryLabel(w, t) {
  const cat = t.lichWeapons.categories[w.category] || w.category || "";
  const sub = w.type && w.type !== w.category ? ` · ${w.type}` : "";
  return `${cat}${sub}`;
}

function weaponCardHtml(w, t) {
  const wikiLink = w.wikiUrl
    ? `<a class="lw-card-wiki" href="${escapeHTML(w.wikiUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(t.lichWeapons.wiki)}">↗</a>`
    : "";
  const mr = w.masteryReq != null ? `<span class="lw-mr">MR ${escapeHTML(String(w.masteryReq))}</span>` : "";

  return `
      <article class="lw-card">
          <div class="lw-card-head">
              <img class="lw-card-img" src="${escapeHTML(weaponIconPath(w.name))}" alt="" loading="lazy"
                   onerror="this.style.visibility='hidden';">
              <div class="lw-card-id">
                  <span class="lw-card-name">${escapeHTML(w.name)}</span>
                  <span class="lw-card-cat">${escapeHTML(categoryLabel(w, t))}</span>
              </div>
              ${wikiLink}
          </div>
          ${bonusHtml(w.bonus, t)}
          ${damageBreakdownHtml(w)}
          ${statsHtml(w, t)}
          <div class="lw-card-foot">${mr}${dispositionHtml(w, t)}</div>
      </article>`;
}

function vendorHtml(vendor, t) {
  const L = t.lichWeapons;
  const info = L.vendors[vendor.key];
  if (!info) return "";
  const style = VENDOR_STYLE[vendor.key] || { color: "#fff", icon: "assets/farm.webp" };

  const batchHtml = vendor.batch
    ? `<span class="lw-batch">${escapeHTML(L.batch)} ${escapeHTML(vendor.batch)}</span>`
    : "";
  const nextHtml = vendor.nextBatch
    ? `<span class="lw-next">${escapeHTML(L.nextBatch)} ${escapeHTML(vendor.nextBatch)}</span>`
    : `<span class="lw-next">${escapeHTML(L.nextBonuses)}</span>`;

  const price = L.price
    .replace("{n}", String(vendor.price ?? "?"))
    .replace("{currency}", L.currencies[vendor.currency] || vendor.currency || "");

  const cards = vendor.weapons.map((w) => weaponCardHtml(w, t)).join("");

  return `
      <section class="lw-vendor" style="--vendor-color:${style.color};">
          <header class="lw-vendor-head">
              <div class="lw-vendor-id">
                  <span class="lw-vendor-name">${escapeHTML(info.name)}</span>
                  <span class="lw-vendor-sub">${escapeHTML(info.where)} · ${escapeHTML(price)}</span>
              </div>
              <div class="lw-vendor-meta">
                  ${batchHtml}
                  <span class="lw-timer" id="lw-timer-${escapeHTML(vendor.key)}">--:--:--</span>
                  ${nextHtml}
              </div>
          </header>
          <div class="lw-grid">${cards}</div>
      </section>`;
}

export async function renderLichWeaponsTab(force = false) {
  const container = document.getElementById("lich-weapons-container");
  if (!container) return;

  if (rotationInterval) clearInterval(rotationInterval);

  const t = TEXTS[state.currentLang];
  const L = t.lichWeapons;

  container.innerHTML = `
      <div class="farm-loading">
         <div class="spinner"></div>
         <div>${escapeHTML(L.loading)}</div>
      </div>`;

  const vendors = await fetchLichWeapons(force);

  if (vendors.length === 0) {
    container.innerHTML = `
        <div class="no-fissures-msg">
          <span class="warning-icon">⚠</span>
          <div>
            <strong>${escapeHTML(L.emptyTitle)}</strong><br>
            <small>${escapeHTML(L.emptyDesc)}</small>
          </div>
        </div>`;
    return;
  }

  container.innerHTML = `
      <div class="lw-header">
          <div class="lw-title">${escapeHTML(L.title)}</div>
          <div class="lw-subtitle">${escapeHTML(L.subtitle)}</div>
      </div>
      ${vendors.map((v) => vendorHtml(v, t)).join("")}
      <div class="lw-disclaimer">${escapeHTML(L.bonusSource)}</div>`;

  startRotationTimers(vendors, t);
}

function startRotationTimers(vendors, t) {
  const tick = () => {
    const now = serverNow();
    const margin = isClockSynced() ? 0 : 5 * 60 * 1000;
    let anyExpired = false;

    vendors.forEach((v) => {
      const el = document.getElementById(`lw-timer-${v.key}`);
      if (!el) return;
      const diff = Number(v.end) - now;
      if (diff <= -margin) {
        anyExpired = true;
        el.textContent = t.lblRotating || "ROTATING...";
        el.classList.add("expired");
        return;
      }
      const safe = Math.max(0, diff);
      const d = Math.floor(safe / 86400000);
      const h = Math.floor((safe % 86400000) / 3600000);
      const m = Math.floor((safe % 3600000) / 60000);
      const s = Math.floor((safe % 60000) / 1000);
      el.classList.remove("expired");
      el.classList.toggle("urgent", diff < 3600000);
      el.textContent = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
    });

    if (!anyExpired) return;
    const ts = Date.now();
    if (ts < rotationReloadAt) return;
    rotationReloadAt = ts + 30000;
    // 5 s margin: the wiki takes a while to show the new bonuses
    setTimeout(() => {
      if (getFarmsSubview() === "weapons") renderLichWeaponsTab(true);
    }, 5000);
  };

  tick();
  rotationInterval = setInterval(tick, 1000);
}

const SUBVIEW_KEY = "vs_farms_subview_v1";

export function getFarmsSubview() {
  return localStorage.getItem(SUBVIEW_KEY) === "weapons" ? "weapons" : "bounties";
}

export function setFarmsSubview(view) {
  localStorage.setItem(SUBVIEW_KEY, view === "weapons" ? "weapons" : "bounties");
}

export function stopRotationTimers() {
  if (rotationInterval) clearInterval(rotationInterval);
  rotationInterval = null;
}
