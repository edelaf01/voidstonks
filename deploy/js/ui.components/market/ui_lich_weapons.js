import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML, showToast } from "../ui_components.js";
import { damageMeta, damageIconHtml } from "../../utils/damage_types.js";
import { fetchLichWeapons } from "../../services/farms/lich_weapons.service.js";
import { serverNow, isClockSynced } from "../../services/server_clock.service.js";
import {
  getAlarmPrefs,
  saveAlarmPrefs,
  addAlarmRule,
  removeAlarmRule,
  notificationState,
  requestNotifyPermission,
  evaluateAlarms,
  sendBrowserNotification,
  startAlarmWatcher,
  VALENCE_MIN,
  VALENCE_MAX,
} from "../../services/farms/alerts.service.js";

let rotationInterval = null;
// Freno del refetch al agotarse la ventana, a nivel de módulo por el mismo motivo que en
// ui_bounties.js: como `let` local, el propio reintento lo reiniciaría y no frenaría nunca.
let rotationReloadAt = 0;
// El panel se repinta con el apartado: recordamos si estaba abierto.
let alarmPanelOpen = false;

// Los siete elementos que puede rodar el bonus de valencia (progenitor).
const VALENCE_ELEMENTS = ["Impact", "Heat", "Cold", "Electricity", "Toxin", "Magnetic", "Radiation"];

// Identidad visual de cada tienda. El color tiñe la cabecera, el borde de las tarjetas y
// la barra del bonus, que es lo que permite distinguir las dos secciones de un vistazo.
const VENDOR_STYLE = {
  eleanor: { color: "#42f56c", icon: "assets/farm.webp" },
  glast: { color: "#00e5ff", icon: "assets/farm.webp" },
};

// El bonus de valencia que genera el juego va de 25% a 60%: la barra mide dentro de ese
// rango, no sobre 100, para que un 30% se vea flojo y un 55% se vea casi máximo.
const BONUS_MIN = 25;
const BONUS_MAX = 60;

/**
 * Ruta del icono del arma. Los 19 nombres existen como .webp en assets/relic_contents,
 * así que basta el slug directo: getItemIcon() está afinado para piezas de reliquia
 * (mapea "grip", "barrel"...) y con nombres de arma podría desviarse a la pieza.
 * @param {string} name
 * @returns {string}
 */
function weaponIconPath(name) {
  const slug = String(name).toLowerCase().trim().replaceAll(/\s+/g, "_").replaceAll(/[^a-z0-9_]/g, "");
  return `assets/relic_contents/${slug}.webp`;
}

/** Porcentaje con un decimal como mucho; 25 se muestra "25", no "25.0". */
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

/** Puntos de disposición (1-5). Es la forma en que el juego la muestra. */
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

/**
 * Fila de stats. Cada entrada se omite si el arma no la tiene: un cuerpo a cuerpo no
 * trae cargador ni recarga y pintar "—" en tres huecos solo añade ruido.
 */
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
  // En cuerpo a cuerpo, fireRate es la velocidad de ataque: misma cifra, otro nombre.
  if (w.fireRate != null) push(w.category === "Melee" ? L.statAttackSpeed : L.statFireRate, pct(w.fireRate));
  if (w.multishot != null && w.multishot > 1) push(L.statMultishot, pct(w.multishot));
  if (w.magazineSize != null) push(L.statMagazine, String(w.magazineSize));
  if (w.reloadTime != null) push(L.statReload, `${pct(w.reloadTime)}s`);

  return cells.length ? `<dl class="lw-stats">${cells.join("")}</dl>` : "";
}

function categoryLabel(w, t) {
  const cat = t.lichWeapons.categories[w.category] || w.category || "";
  // `type` es la subclase ("Shotgun", "Nikana"...): interesa cuando dice algo más que
  // la categoría, que es siempre el caso salvo en cuerpo a cuerpo genérico.
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

  // Solo Eleanor alterna lotes; en Ergo Glast la etiqueta sobra porque el catálogo es fijo.
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

// ---- Recordatorios de rotación ----

/** Armas de todas las tiendas, aplanadas con su tienda y la caducidad de su ventana. */
function flattenForAlarms(vendors) {
  return vendors.flatMap((v) =>
    v.weapons.map((w) => ({ ...w, vendorKey: v.key, expiry: v.end })),
  );
}

/** Catálogo completo (no solo el lote activo) para el selector de arma. */
function catalogueOf(vendors, vendorKey) {
  const pick = vendorKey === "any" ? vendors : vendors.filter((v) => v.key === vendorKey);
  const names = pick.flatMap((v) => (Array.isArray(v.catalogue) ? v.catalogue : v.weapons.map((w) => w.name)));
  return [...new Set(names)].sort();
}

function ruleLabel(rule, t) {
  const L = t.lichWeapons;
  const vendor = rule.vendor === "any"
    ? L.alarms.anyVendor
    : (L.vendors[rule.vendor]?.short || L.vendors[rule.vendor]?.name || rule.vendor);
  const weapon = (rule.weapon || "any") === "any" ? L.alarms.anyWeapon : rule.weapon;
  const element = (rule.element || "any") === "any"
    ? L.alarms.anyElement
    : damageMeta(rule.element, state.currentLang).label;
  return `${vendor} · ${weapon} · ${element} ≥ ${rule.minPercent}%`;
}

function alarmPanelHtml(vendors, t) {
  const L = t.lichWeapons;
  const prefs = getAlarmPrefs();
  const notif = notificationState();

  let browserRow;
  if (notif === "granted") {
    browserRow = `<span class="alarm-notif-status ok">✓ ${escapeHTML(t.farmAlarms.browserOn)}</span>`;
  } else if (notif === "denied") {
    browserRow = `<span class="alarm-notif-status bad">${escapeHTML(t.farmAlarms.browserBlocked)}</span>`;
  } else if (notif === "unsupported") {
    browserRow = `<span class="alarm-notif-status bad">${escapeHTML(t.farmAlarms.browserUnsupported)}</span>`;
  } else {
    browserRow = `<button type="button" class="dashed-btn alarm-notif-btn" id="lw-alarm-notif-btn">${escapeHTML(t.farmAlarms.browserBtn)}</button>`;
  }

  const vendorOptions = [`<option value="any">${escapeHTML(L.alarms.anyVendor)}</option>`]
    .concat(vendors.map((v) => {
      const info = L.vendors[v.key];
      return `<option value="${escapeHTML(v.key)}">${escapeHTML(info?.short || info?.name || v.key)}</option>`;
    }))
    .join("");

  const weaponOptions = [`<option value="any">${escapeHTML(L.alarms.anyWeapon)}</option>`]
    .concat(catalogueOf(vendors, "any").map((n) => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`))
    .join("");

  const elementOptions = [`<option value="any">${escapeHTML(L.alarms.anyElement)}</option>`]
    .concat(VALENCE_ELEMENTS.map((e) => {
      const label = damageMeta(e, state.currentLang).label;
      return `<option value="${escapeHTML(e)}">${escapeHTML(label)}</option>`;
    })).join("");

  // De 5 en 5 dentro del rango que el juego puede rodar: un ≥70% no saltaría jamás.
  const percentOptions = [];
  for (let p = VALENCE_MIN; p <= VALENCE_MAX; p += 5) {
    percentOptions.push(`<option value="${p}" ${p === 45 ? "selected" : ""}>≥ ${p}%</option>`);
  }

  const rules = prefs.rules.filter((r) => r.kind === "weapon");
  const rulesHtml = rules.length === 0
    ? `<div class="alarm-no-rules">${escapeHTML(L.alarms.noRules)}</div>`
    : rules.map((r) => {
      const color = (r.element || "any") === "any"
        ? "#888"
        : damageMeta(r.element, state.currentLang).color;
      return `
          <div class="alarm-rule" data-rule-id="${escapeHTML(r.id)}">
              <span class="alarm-rule-dot" style="background:${color};"></span>
              <span class="alarm-rule-desc">${escapeHTML(ruleLabel(r, t))}</span>
              <button type="button" class="alarm-rule-del" title="${escapeHTML(t.farmAlarms.delete)}">×</button>
          </div>`;
    }).join("");

  return `
      <div class="alarm-panel-title">${escapeHTML(L.alarms.title)}</div>
      <div class="alarm-toggles">
          <label class="lfg-checkbox-wrapper">
              <input type="checkbox" id="lw-alarm-enable" ${prefs.enabled ? "checked" : ""}>
              <span class="lfg-label">${escapeHTML(t.farmAlarms.enable)}</span>
          </label>
          <label class="lfg-checkbox-wrapper">
              <input type="checkbox" id="lw-alarm-sound" ${prefs.sound ? "checked" : ""}>
              <span class="lfg-label">${escapeHTML(t.farmAlarms.sound)}</span>
          </label>
          ${browserRow}
      </div>
      <div class="alarm-builder">
          <select id="lw-alarm-vendor" class="alarm-select" aria-label="${escapeHTML(L.alarms.vendor)}">${vendorOptions}</select>
          <select id="lw-alarm-weapon" class="alarm-select" aria-label="${escapeHTML(L.alarms.weapon)}">${weaponOptions}</select>
          <select id="lw-alarm-element" class="alarm-select" aria-label="${escapeHTML(L.alarms.element)}">${elementOptions}</select>
          <select id="lw-alarm-percent" class="alarm-select" aria-label="${escapeHTML(L.alarms.minPercent)}">${percentOptions.join("")}</select>
          <button type="button" class="dashed-btn alarm-add-btn" id="lw-alarm-add">+ ${escapeHTML(L.alarms.addRule)}</button>
      </div>
      <div class="alarm-rules-list">${rulesHtml}</div>
      <div class="alarm-future-note">${escapeHTML(L.alarms.note)}</div>
  `;
}

function handleAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.slice(0, 4).map(({ item }) => {
    const el = damageMeta(item.bonus.element, state.currentLang).label;
    return `${item.name}: ${el} +${pct(item.bonus.percent)}%`;
  });
  const more = hits.length > 4 ? ` +${hits.length - 4}` : "";
  const title = t.lichWeapons.alarms.firedTitle;
  sendBrowserNotification(title, lines.join("\n") + more);
  showToast(`<b>${escapeHTML(title)}</b><br>${lines.map(escapeHTML).join("<br>")}${more}`, {
    tag: "lw-alarm",
    type: "success",
    duration: 30000,
    html: true, // monta <b>/<br> y escapa cada dato que interpola
  });
}

/** Fetcher del watcher: entrega las armas ya aplanadas, que es lo que espera el matcher. */
async function alarmSource() {
  return flattenForAlarms(await fetchLichWeapons());
}

function bindAlarmPanel(container, vendors, t) {
  const panel = container.querySelector("#lw-alarm-panel");
  if (!panel) return;

  const refresh = () => {
    panel.innerHTML = alarmPanelHtml(vendors, t);
    bindControls();
    const btn = container.querySelector("#lw-alarms-btn");
    const prefs = getAlarmPrefs();
    const n = prefs.rules.filter((r) => r.kind === "weapon").length;
    if (btn) {
      btn.classList.toggle("active-filter", prefs.enabled && n > 0);
      const count = btn.querySelector(".alarm-count");
      if (count) count.textContent = n > 0 ? String(n) : "";
    }
  };

  function bindControls() {
    panel.querySelector("#lw-alarm-enable")?.addEventListener("change", (e) => {
      const prefs = getAlarmPrefs();
      prefs.enabled = e.target.checked;
      saveAlarmPrefs(prefs);
      if (prefs.enabled) startAlarmWatcher(alarmSource, handleAlarmHits, "weapon");
      refresh();
    });

    panel.querySelector("#lw-alarm-sound")?.addEventListener("change", (e) => {
      const prefs = getAlarmPrefs();
      prefs.sound = e.target.checked;
      saveAlarmPrefs(prefs);
    });

    panel.querySelector("#lw-alarm-notif-btn")?.addEventListener("click", async () => {
      await requestNotifyPermission();
      refresh();
    });

    // Al elegir tienda, el selector de arma se acota a su catálogo; si el arma marcada
    // ya no pertenece a esa tienda, vuelve a "cualquiera" en vez de quedar imposible.
    panel.querySelector("#lw-alarm-vendor")?.addEventListener("change", (e) => {
      const sel = panel.querySelector("#lw-alarm-weapon");
      if (!sel) return;
      const prev = sel.value;
      const names = catalogueOf(vendors, e.target.value);
      sel.innerHTML = [`<option value="any">${escapeHTML(t.lichWeapons.alarms.anyWeapon)}</option>`]
        .concat(names.map((n) => `<option value="${escapeHTML(n)}" ${n === prev ? "selected" : ""}>${escapeHTML(n)}</option>`))
        .join("");
    });

    panel.querySelector("#lw-alarm-add")?.addEventListener("click", () => {
      const added = addAlarmRule({
        kind: "weapon",
        vendor: panel.querySelector("#lw-alarm-vendor")?.value || "any",
        weapon: panel.querySelector("#lw-alarm-weapon")?.value || "any",
        element: panel.querySelector("#lw-alarm-element")?.value || "any",
        minPercent: Number(panel.querySelector("#lw-alarm-percent")?.value) || VALENCE_MIN,
      });
      if (!added) {
        showToast(t.farmAlarms.dupRule, { tag: "lw-alarm-dup", duration: 4000 });
        return;
      }
      // Igual que en Farms: crear la primera regla activa el sistema, para evitar el
      // "configuré la alarma y no salta" por dejar el interruptor maestro apagado.
      const prefs = getAlarmPrefs();
      if (!prefs.enabled) {
        prefs.enabled = true;
        saveAlarmPrefs(prefs);
      }
      startAlarmWatcher(alarmSource, handleAlarmHits, "weapon");
      refresh();
    });

    panel.querySelectorAll(".alarm-rule-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest(".alarm-rule")?.dataset.ruleId;
        if (id) removeAlarmRule(id);
        refresh();
      });
    });
  }

  bindControls();

  container.querySelector("#lw-alarms-btn")?.addEventListener("click", () => {
    alarmPanelOpen = !alarmPanelOpen;
    panel.classList.toggle("collapsed", !alarmPanelOpen);
  });
}

/**
 * Pinta el apartado de armas en rotación dentro de Farms.
 * @param {boolean} [force] Salta la caché local. Solo lo usa el refetch al rotar.
 */
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

  const alarmPrefs = getAlarmPrefs();
  const nRules = alarmPrefs.rules.filter((r) => r.kind === "weapon").length;

  container.innerHTML = `
      <div class="lw-header">
          <div class="lw-head-row">
            <div>
              <div class="lw-title">${escapeHTML(L.title)}</div>
              <div class="lw-subtitle">${escapeHTML(L.subtitle)}</div>
            </div>
            <button type="button" id="lw-alarms-btn" class="farm-action-btn ${alarmPrefs.enabled && nRules > 0 ? "active-filter" : ""}"
              aria-expanded="${alarmPanelOpen ? "true" : "false"}" title="${escapeHTML(L.alarms.toggle)}">
              <span class="farm-btn-label">${escapeHTML(L.alarms.toggle)}</span>
              <span class="alarm-count">${nRules > 0 ? nRules : ""}</span>
            </button>
          </div>
      </div>
      <div id="lw-alarm-panel" class="farm-alarm-panel ${alarmPanelOpen ? "" : "collapsed"}">
          ${alarmPanelHtml(vendors, t)}
      </div>
      ${vendors.map((v) => vendorHtml(v, t)).join("")}
      <div class="lw-disclaimer">${escapeHTML(L.bonusSource)}</div>`;

  bindAlarmPanel(container, vendors, t);

  // Se evalúa sobre TODA la rotación y se deja el watcher vigilando las siguientes.
  handleAlarmHits(evaluateAlarms("weapon", flattenForAlarms(vendors)));
  if (getAlarmPrefs().enabled) startAlarmWatcher(alarmSource, handleAlarmHits, "weapon");

  startRotationTimers(vendors, t);
}

/**
 * Contadores hasta la próxima rotación de cada tienda. Usa serverNow(): con el reloj del
 * sistema adelantado, Date.now() daría negativos y marcaría todo como rotando.
 */
function startRotationTimers(vendors, t) {
  const tick = () => {
    const now = serverNow();
    // Sin reloj sincronizado no nos fiamos de un negativo pequeño (mismo criterio que en
    // el contador de bounties): solo se da por rotada la ventana pasada de ese margen.
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
    // Margen de 5s: el lote nuevo se calcula sobre la hora, pero los bonus tardan en
    // aparecer en la wiki, así que no hay prisa por pedir en el segundo exacto.
    setTimeout(() => {
      if (getFarmsSubview() === "weapons") renderLichWeaponsTab(true);
    }, 5000);
  };

  tick();
  rotationInterval = setInterval(tick, 1000);
}

// ---- Subvista activa dentro de Farms ----

const SUBVIEW_KEY = "vs_farms_subview_v1";

/** @returns {"bounties"|"weapons"} */
export function getFarmsSubview() {
  return localStorage.getItem(SUBVIEW_KEY) === "weapons" ? "weapons" : "bounties";
}

/** @param {"bounties"|"weapons"} view */
export function setFarmsSubview(view) {
  localStorage.setItem(SUBVIEW_KEY, view === "weapons" ? "weapons" : "bounties");
}

/** Para el contador al salir del apartado: sin esto sigue latiendo contra nodos ocultos. */
export function stopRotationTimers() {
  if (rotationInterval) clearInterval(rotationInterval);
  rotationInterval = null;
}
