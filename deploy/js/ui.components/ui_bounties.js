import { state, saveAppState } from "../state.js";
import { TEXTS, VANIA_NAMES, CHALLENGE_MAP } from "../config.js";
import { fetchActiveBounties } from "../api.js";
import { escapeHTML, showToast } from "./ui_components.js";
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
  ruleChallenges,
  SPECIAL_TIER_VALUE,
} from "../services/alerts.service.js";

let bountyInterval = null;
// El panel de alarmas se re-renderiza junto al tab: recordamos si estaba abierto.
let alarmPanelOpen = false;

const TIER_COLORS = {
  NARMER: "#ffaa00",
  CODA: "#ff4d4d",
  6: "#ff4d4d",
  5: "#ffcc00",
};

const FACTION_CONFIG = {
  "The Holdfasts": { name: "Zariman (Ten Zero)", color: "#d4af37" },
  Cavia: { name: "Sanctum Anatomica (Cavia)", color: "#a545e0" },
  "The Hex": { name: "Höllvania (1999)", color: "#42f56c" },
  Ostrons: { name: "Cetus (Aya Farm)", color: "#d6b07c" },
  "Solaris United": { name: "Fortuna (Solaris)", color: "#00e5ff" },
  Entrati: { name: "Necralisk (Entrati)", color: "#ffaa00" },
};

// ---- Preferencias de vista (chips de sindicato + grupos plegados) ----

const VIEW_KEY = "vs_farms_view_v1";

function getViewPrefs() {
  try {
    const data = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    return {
      hiddenFactions: Array.isArray(data.hiddenFactions) ? data.hiddenFactions : [],
      collapsed: Array.isArray(data.collapsed) ? data.collapsed : [],
    };
  } catch {
    return { hiddenFactions: [], collapsed: [] };
  }
}

function saveViewPrefs(prefs) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(prefs));
}

// ---- Óptimas personalizadas ----
// El usuario puede marcar/desmarcar misiones como óptimas con la estrella.
// La clave es por patrón (facción|tier|tipo), no por rotación: "Cavia T3
// Exterminate" seguirá siendo óptima en rotaciones futuras hasta que la quite.
// added fuerza óptima; removed anula las óptimas de serie (OPTIMAL_FILTERS).

const OPTIMAL_KEY = "vs_farms_optimal_v1";

function getOptimalOverrides() {
  try {
    const data = JSON.parse(localStorage.getItem(OPTIMAL_KEY)) || {};
    return {
      added: Array.isArray(data.added) ? data.added : [],
      removed: Array.isArray(data.removed) ? data.removed : [],
    };
  } catch {
    return { added: [], removed: [] };
  }
}

function saveOptimalOverrides(o) {
  localStorage.setItem(OPTIMAL_KEY, JSON.stringify(o));
}

function optimalKey(m) {
  return `${m.factionKey}|${m.tier}|${m.technicalType}`;
}

function isEffectiveOptimal(m, overrides) {
  const key = optimalKey(m);
  if (overrides.added.includes(key)) return true;
  if (overrides.removed.includes(key)) return false;
  return !!m.isOptimal;
}

function toggleOptimalOverride(key, currentlyOptimal) {
  const o = getOptimalOverrides();
  if (currentlyOptimal) {
    // Quitar de óptimas: si era manual se borra de added; si era de serie, va a removed
    const idx = o.added.indexOf(key);
    if (idx !== -1) o.added.splice(idx, 1);
    else if (!o.removed.includes(key)) o.removed.push(key);
  } else {
    const idx = o.removed.indexOf(key);
    if (idx !== -1) o.removed.splice(idx, 1);
    else if (!o.added.includes(key)) o.added.push(key);
  }
  saveOptimalOverrides(o);
}

function getTierColor(tier) {
  return TIER_COLORS[tier] ?? (tier >= 3 ? "#00ccff" : "#888");
}

function getLevelDisplay(m) {
  if (m.isDual) {
    return `
      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82em; margin-top: 4px; flex-wrap: wrap;">
        <span style="color: #aaa;">Lvl ${m.level} <b style="color:#888">(+${m.standing})</b></span>
        <span style="color: #444;">|</span>
        <span style="color: #ff4d4d;">SP ${m.levelSP} <b style="color:#ff4d4d99">(+${m.standingSP})</b></span>
      </div>`;
  }
  const tag = m.isSP ? "STEEL PATH" : "NORMAL PATH";
  const lvlColor = m.isSP ? "#ff4d4d" : "#aaa";
  return `
      <div style="color: ${lvlColor}; font-weight: bold; font-size: 0.85em; margin-top: 4px;">
        ${tag} (Lvl ${m.level}) <span style="color: #888; font-weight: normal;">(+${m.standing})</span>
      </div>`;
}

function getRewardsContent(m) {
  if (!m.detailedRewards) {
    const rewardListHtml = m.rewards.map((r) => `<li class="drop-item">${r}</li>`).join("");
    return `<ul class="drop-list">${rewardListHtml}</ul>`;
  }
  return m.detailedRewards.map((stage) => {
    const rows = stage.drops.map((d) => {
      const ayaClass = d.name.includes("Aya") ? "aya" : "";
      return `<div class="drop-row"><span class="drop-name ${ayaClass}">${escapeHTML(d.name)}</span><span class="drop-chance">${d.chance.toFixed(2)}%</span></div>`;
    }).join("");
    return `<div class="stage-container"><div class="stage-header">STAGE ${stage.stage}</div><div class="stage-content">${rows}</div></div>`;
  }).join("");
}

function getTierBadgeHtml(m, tierColor) {
  if (m.hideTier) return "";
  const tierLabel = m.tier;
  const hasBg = m.tier === 6 || m.tier === "NARMER";
  const bg = hasBg ? "rgba(255,170,0,0.1)" : "transparent";
  const label = typeof tierLabel === "string" ? tierLabel : `TIER ${tierLabel}`;
  return `<span style="color: ${tierColor}; border: 1px solid ${tierColor}44; padding: 1px 6px; font-size: 0.7em; border-radius: 3px; font-weight: 900; background: ${bg}">${label}</span>`;
}

function getBountyMissionHtml(m, index, key, color, isOpt, t) {
  const uniqueId = `drops-${key}-${index}`.replaceAll(/\s+/g, "");
  const opacity = isOpt ? "1" : "0.7";
  const tierColor = getTierColor(m.tier);
  const levelDisplay = getLevelDisplay(m);
  const rewardsContent = getRewardsContent(m);
  const tierBadgeHtml = getTierBadgeHtml(m, tierColor);
  const spClass = m.isSP || m.isDual ? "is-sp" : "";
  const optimalClass = isOpt ? "optimal-farm" : "";
  const starTip = isOpt ? t.optimalPicker.unmarkTip : t.optimalPicker.markTip;
  const starHtml = `
      <button type="button" class="optimal-star ${isOpt ? "on" : ""}"
        data-optkey="${escapeHTML(optimalKey(m))}" data-opt="${isOpt ? "1" : "0"}"
        title="${escapeHTML(starTip)}" aria-label="${escapeHTML(starTip)}">${isOpt ? "★" : "☆"}</button>`;
  const conditionHtml = m.condition
    ? `<div style="background: rgba(255,255,255,0.05); border-left: 3px solid #666; padding: 6px 12px; margin-top: 10px; font-size: 0.85em; color: #ccc; white-space: normal;">CHALLENGE: ${m.condition}</div>`
    : "";

  return `
    <div class="bounty-wrapper ${spClass} ${optimalClass}" style="opacity:${opacity};">
        <div class="bounty-header-row">
            <div class="bounty-info">
               <div class="bounty-type" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span style="color:var(--wf-blue); font-weight:900; font-size:0.75em; text-transform:uppercase; border-right:1px solid #444; padding-right:8px;">
                    ${m.factionKey === "The Hex" ? (VANIA_NAMES[m.technicalType] || m.technicalType) : m.technicalType}
                  </span>
                  ${tierBadgeHtml}
                  <span style="color: #fff; font-weight: 600; flex: 1;">${m.type}</span>
                </div>
                ${levelDisplay}
                ${conditionHtml}
            </div>
            <div class="bounty-side-actions">
                ${starHtml}
                <button class="bounty-rewards-btn" style="color: ${color};" onclick="document.getElementById('${uniqueId}').classList.toggle('open')">
                    VIEW REWARDS
                </button>
            </div>
        </div>
        <div id="${uniqueId}" class="bounty-drops-drawer">${rewardsContent}</div>
    </div>`;
}

// ---- Panel de alarmas ----

// Valores posibles de technicalType en bounties.service (getTechType + NODE_TO_TYPE)
const ALARM_MISSION_TYPES = [
  "Exterminate",
  "Capture",
  "Defense",
  "Mobile Defense",
  "Survival",
  "Assassination",
  "Void Cascade",
  "Void Armageddon",
  "Void Flood",
  "Alchemy",
  "Mirror Defense",
];

// Opciones válidas por sindicato: tipos de misión que realmente aparecen en sus
// rotaciones y qué tier especial les aplica (NARMER en Cetus/Fortuna, CODA en
// Höllvania). Mantiene los selects del builder acotados a lo que puede saltar.
const FACTION_ALARM_OPTIONS = {
  any: { types: ALARM_MISSION_TYPES, special: null }, // special null = etiqueta genérica
  Ostrons: { types: ["Exterminate", "Capture", "Defense", "Mobile Defense"], special: "NARMER" },
  "Solaris United": { types: ["Exterminate", "Capture", "Defense", "Mobile Defense"], special: "NARMER" },
  Entrati: { types: ["Exterminate", "Capture", "Defense", "Mobile Defense"], special: false },
  "The Holdfasts": { types: ["Void Cascade", "Void Armageddon", "Void Flood", "Exterminate", "Mobile Defense"], special: false },
  Cavia: { types: ["Exterminate", "Survival", "Assassination", "Alchemy", "Mirror Defense"], special: false },
  "The Hex": { types: ["Exterminate", "Capture", "Defense", "Survival", "Assassination", "Alchemy", "Mobile Defense"], special: "CODA" },
};

function buildTierOptionsHtml(factionKey, t, selected) {
  const opts = FACTION_ALARM_OPTIONS[factionKey] || FACTION_ALARM_OPTIONS.any;
  let html = [1, 2, 3, 4, 5].map(
    (n) => `<option value="${n}" ${n === (selected ?? 4) ? "selected" : ""}>T${n}+</option>`,
  ).join("");
  if (opts.special !== false) {
    const label = opts.special || t.farmAlarms.tierSpecial;
    html += `<option value="${SPECIAL_TIER_VALUE}" ${selected === SPECIAL_TIER_VALUE ? "selected" : ""}>${escapeHTML(label)}</option>`;
  }
  return html;
}

// Etiqueta visible de un tipo técnico: en Höllvania se usan los nombres
// propios de 1999 (Alchemy → Legacyte Harvest, Survival → Hell-Scrub...).
function typeLabel(factionKey, type, t) {
  if (factionKey === "The Hex" && VANIA_NAMES[type]) return VANIA_NAMES[type];
  return t.modes?.[type.toLowerCase()] || type;
}

function buildTypeOptionsHtml(factionKey, t, selected) {
  const opts = FACTION_ALARM_OPTIONS[factionKey] || FACTION_ALARM_OPTIONS.any;
  return [`<option value="any">${escapeHTML(t.farmAlarms.anyType)}</option>`]
    .concat(opts.types.map((type) => {
      const label = typeLabel(factionKey, type, t);
      return `<option value="${escapeHTML(type)}" ${type === selected ? "selected" : ""}>${escapeHTML(label)}</option>`;
    })).join("");
}

// Desafíos de CHALLENGE_MAP acotados por sindicato (prefijo del uniqueName).
// El valor de la opción es la etiqueta (lo que acaba en m.condition), con
// dedupe: varias claves (Easy/Hard/VeryHard) comparten descripción.
const CHALLENGE_PREFIXES = {
  "The Holdfasts": ["Zariman"],
  Cavia: ["EntratiLab"],
  "The Hex": ["Vania", "LichVania"],
};

function challengesForFaction(factionKey) {
  const entries = Object.entries(CHALLENGE_MAP);
  let filtered;
  if (factionKey === "any") {
    filtered = entries;
  } else {
    const prefixes = CHALLENGE_PREFIXES[factionKey];
    if (!prefixes) return [];
    filtered = entries.filter(([k]) => prefixes.some((p) => k.startsWith(p)));
  }
  return [...new Set(filtered.map(([, label]) => label.trim()))].sort();
}

// Caja multiselección de desafíos (checkboxes). Vacío = cualquier desafío.
function buildChallengeBoxHtml(factionKey, t, selected = []) {
  const labels = challengesForFaction(factionKey);
  if (labels.length === 0) return "";
  const checkboxes = labels.map((label) => `
      <label class="lfg-checkbox-wrapper">
          <input type="checkbox" class="farm-alarm-chal" value="${escapeHTML(label)}" ${selected.includes(label) ? "checked" : ""}>
          <span class="lfg-label">${escapeHTML(label)}</span>
      </label>`).join("");
  return `
      <div class="alarm-challenge-title">${escapeHTML(t.farmAlarms.challenges)}</div>
      <div class="alarm-challenge-list">${checkboxes}</div>`;
}

function tierRuleLabel(minTier, t, factionKey) {
  if (minTier < SPECIAL_TIER_VALUE) return `T${minTier}+`;
  const special = FACTION_ALARM_OPTIONS[factionKey]?.special;
  return special || t.farmAlarms.tierSpecial;
}

function renderAlarmPanel(t) {
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
    browserRow = `<button type="button" class="dashed-btn alarm-notif-btn" id="farm-alarm-notif-btn">${escapeHTML(t.farmAlarms.browserBtn)}</button>`;
  }

  const factionOptions = [`<option value="any">${escapeHTML(t.farmAlarms.anyFaction)}</option>`]
    .concat(Object.entries(FACTION_CONFIG).map(
      ([key, cfg]) => `<option value="${escapeHTML(key)}">${escapeHTML(cfg.name)}</option>`,
    )).join("");

  const tierOptions = buildTierOptionsHtml("any", t);
  const typeOptions = buildTypeOptionsHtml("any", t);
  const challengeBox = buildChallengeBoxHtml("any", t);

  // Solo reglas de bounty: las de fisuras se gestionan en el panel de fisuras.
  const bountyRules = prefs.rules.filter((r) => (r.kind || "bounty") === "bounty");
  const rulesHtml = bountyRules.length === 0
    ? `<div class="alarm-no-rules">${escapeHTML(t.farmAlarms.noRules)}</div>`
    : bountyRules.map((r) => {
      const facName = r.faction === "any"
        ? t.farmAlarms.anyFaction
        : (FACTION_CONFIG[r.faction]?.name || r.faction);
      const color = FACTION_CONFIG[r.faction]?.color || "#888";
      const ruleType = r.type || "any";
      const typeTxt = ruleType === "any"
        ? ""
        : ` · ${typeLabel(r.faction, ruleType, t)}`;
      const chals = ruleChallenges(r);
      let chalTxt = "";
      if (chals.length > 0) {
        const shown = chals.slice(0, 2).join(", ");
        chalTxt = ` · ${shown}${chals.length > 2 ? ` +${chals.length - 2}` : ""}`;
      }
      return `
          <div class="alarm-rule" data-rule-id="${escapeHTML(r.id)}">
              <span class="alarm-rule-dot" style="background:${color};"></span>
              <span class="alarm-rule-desc">${escapeHTML(facName)} · ${escapeHTML(tierRuleLabel(r.minTier, t, r.faction))}${escapeHTML(typeTxt)}${escapeHTML(chalTxt)}</span>
              <button type="button" class="alarm-rule-del" title="${escapeHTML(t.farmAlarms.delete)}">×</button>
          </div>`;
    }).join("");

  return `
      <div class="alarm-panel-title">${escapeHTML(t.farmAlarms.title)}</div>
      <div class="alarm-toggles">
          <label class="lfg-checkbox-wrapper">
              <input type="checkbox" id="farm-alarm-enable" ${prefs.enabled ? "checked" : ""}>
              <span class="lfg-label">${escapeHTML(t.farmAlarms.enable)}</span>
          </label>
          <label class="lfg-checkbox-wrapper">
              <input type="checkbox" id="farm-alarm-sound" ${prefs.sound ? "checked" : ""}>
              <span class="lfg-label">${escapeHTML(t.farmAlarms.sound)}</span>
          </label>
          ${browserRow}
      </div>
      <div class="alarm-builder">
          <select id="farm-alarm-faction" class="alarm-select" aria-label="${escapeHTML(t.farmAlarms.faction)}">${factionOptions}</select>
          <select id="farm-alarm-tier" class="alarm-select" aria-label="${escapeHTML(t.farmAlarms.minTier)}">${tierOptions}</select>
          <select id="farm-alarm-type" class="alarm-select" aria-label="${escapeHTML(t.farmAlarms.missionType)}">${typeOptions}</select>
          <button type="button" class="dashed-btn alarm-add-btn" id="farm-alarm-add">+ ${escapeHTML(t.farmAlarms.addRule)}</button>
      </div>
      <div class="alarm-challenge-box" id="farm-alarm-challenge-box" ${challengeBox ? "" : 'style="display:none;"'}>
          ${challengeBox}
      </div>
      <div class="alarm-rules-list">${rulesHtml}</div>
      <div class="alarm-future-note">${escapeHTML(t.farmAlarms.futureNote)}</div>
  `;
}

function handleAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.slice(0, 4).map(({ item }) => {
    const facName = FACTION_CONFIG[item.factionKey]?.name || item.factionKey;
    const tierTxt = typeof item.tier === "string" ? item.tier : `T${item.tier}`;
    return `${facName}: ${item.type} (${tierTxt})`;
  });
  const more = hits.length > 4 ? ` +${hits.length - 4}` : "";
  const body = lines.join("\n") + more;
  sendBrowserNotification(`${t.farmAlarms.firedTitle}`, body);
  showToast(`<b>${escapeHTML(t.farmAlarms.firedTitle)}</b><br>${lines.map(escapeHTML).join("<br>")}${more}`, {
    tag: "farm-alarm",
    type: "success",
    duration: 30000,
  });
}

function bindAlarmPanel(container, t) {
  const panel = container.querySelector("#farm-alarm-panel");
  if (!panel) return;

  const refreshPanel = () => {
    panel.innerHTML = renderAlarmPanel(t);
    bindPanelControls();
    // Refresca el contador del botón sin re-render completo del tab
    const btn = container.querySelector("#farm-alarms-btn");
    const prefs = getAlarmPrefs();
    const nBounty = prefs.rules.filter((r) => (r.kind || "bounty") === "bounty").length;
    if (btn) {
      btn.classList.toggle("active-filter", prefs.enabled && nBounty > 0);
      const count = btn.querySelector(".alarm-count");
      if (count) count.textContent = nBounty > 0 ? String(nBounty) : "";
    }
  };

  function bindPanelControls() {
    panel.querySelector("#farm-alarm-enable")?.addEventListener("change", (e) => {
      const prefs = getAlarmPrefs();
      prefs.enabled = e.target.checked;
      saveAlarmPrefs(prefs);
      if (prefs.enabled) startAlarmWatcher(fetchActiveBounties, handleAlarmHits);
      refreshPanel();
    });

    panel.querySelector("#farm-alarm-sound")?.addEventListener("change", (e) => {
      const prefs = getAlarmPrefs();
      prefs.sound = e.target.checked;
      saveAlarmPrefs(prefs);
    });

    panel.querySelector("#farm-alarm-notif-btn")?.addEventListener("click", async () => {
      await requestNotifyPermission();
      refreshPanel();
    });

    // Al cambiar de sindicato, los selects de tier y tipo se acotan a lo que
    // ese sindicato puede ofrecer, conservando la selección si sigue siendo válida.
    panel.querySelector("#farm-alarm-faction")?.addEventListener("change", (e) => {
      const facKey = e.target.value;
      const tierSel = panel.querySelector("#farm-alarm-tier");
      const typeSel = panel.querySelector("#farm-alarm-type");
      if (tierSel) {
        const prevTier = Number(tierSel.value) || 4;
        tierSel.innerHTML = buildTierOptionsHtml(facKey, t, prevTier);
      }
      if (typeSel) {
        const prevType = typeSel.value;
        typeSel.innerHTML = buildTypeOptionsHtml(facKey, t, prevType);
      }
      const chalBox = panel.querySelector("#farm-alarm-challenge-box");
      if (chalBox) {
        // Sindicatos sin challenges mapeados (Cetus/Fortuna/Necralisk): se oculta.
        // Se conservan los marcados que sigan existiendo en el nuevo sindicato.
        const prevChecked = Array.from(chalBox.querySelectorAll(".farm-alarm-chal:checked")).map((el) => el.value);
        const html = buildChallengeBoxHtml(facKey, t, prevChecked);
        chalBox.innerHTML = html;
        chalBox.style.display = html ? "" : "none";
      }
    });

    panel.querySelector("#farm-alarm-add")?.addEventListener("click", () => {
      const faction = panel.querySelector("#farm-alarm-faction")?.value || "any";
      const minTier = Number(panel.querySelector("#farm-alarm-tier")?.value) || 1;
      const type = panel.querySelector("#farm-alarm-type")?.value || "any";
      const chalBox = panel.querySelector("#farm-alarm-challenge-box");
      const challenges = chalBox && chalBox.style.display !== "none"
        ? Array.from(chalBox.querySelectorAll(".farm-alarm-chal:checked")).map((el) => el.value)
        : [];
      const added = addAlarmRule({ kind: "bounty", faction, minTier, type, challenges });
      if (!added) {
        showToast(t.farmAlarms.dupRule, { tag: "farm-alarm-dup", duration: 4000 });
        return;
      }
      // Al crear la primera regla, activamos el sistema para evitar el caso
      // "configuré la alarma pero no salta" por dejar el master apagado.
      const prefs = getAlarmPrefs();
      if (!prefs.enabled) {
        prefs.enabled = true;
        saveAlarmPrefs(prefs);
      }
      startAlarmWatcher(fetchActiveBounties, handleAlarmHits);
      refreshPanel();
    });

    panel.querySelectorAll(".alarm-rule-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest(".alarm-rule")?.dataset.ruleId;
        if (id) removeAlarmRule(id);
        refreshPanel();
      });
    });
  }

  bindPanelControls();

  container.querySelector("#farm-alarms-btn")?.addEventListener("click", () => {
    alarmPanelOpen = !alarmPanelOpen;
    panel.classList.toggle("collapsed", !alarmPanelOpen);
  });
}

// ---- Render principal del tab ----

function buildHeaderHtml(t) {
  const alarmPrefs = getAlarmPrefs();
  const nBounty = alarmPrefs.rules.filter((r) => (r.kind || "bounty") === "bounty").length;
  const toggleText = state.showAllFarms
    ? (state.currentLang === "en" ? "SHOWING ALL" : "MOSTRANDO TODO")
    : (state.currentLang === "en" ? "OPTIMAL ONLY" : "SOLO ÓPTIMAS");
  const alarmActive = alarmPrefs.enabled && nBounty > 0;

  return `
      <div class="farms-header">
          <div class="panel-main-header farms-title">
            <span id="lbl-fast-farms-title">${t.lblFastFarms || "Active Farms"}</span>
            <span class="info-icon" id="bounties-guide-icon" data-tooltip="${t.fastFarmGuide}">ℹ️</span>
          </div>
          <div class="farms-actions">
              <button type="button" id="farm-alarms-btn" class="dashed-btn farm-action-btn ${alarmActive ? "active-filter" : ""}">
                🔔 ${escapeHTML(t.farmAlarms.toggle)}
                <span class="alarm-count">${nBounty > 0 ? nBounty : ""}</span>
              </button>
              <button type="button" id="farm-filter-btn" class="dashed-btn farm-action-btn ${state.showAllFarms ? "active-filter" : ""}">
                ${toggleText}
              </button>
          </div>
      </div>
      <div id="farm-alarm-panel" class="farm-alarm-panel ${alarmPanelOpen ? "" : "collapsed"}">
          ${renderAlarmPanel(t)}
      </div>
  `;
}

function buildChipbarHtml(groups, viewPrefs) {
  const chips = Object.keys(groups).map((key) => {
    const cfg = FACTION_CONFIG[key] || { name: key, color: "#fff" };
    const hidden = viewPrefs.hiddenFactions.includes(key);
    return `
        <button type="button" class="farm-chip ${hidden ? "off" : ""}" data-faction="${escapeHTML(key)}" style="--chip-color:${cfg.color};">
            ${escapeHTML(cfg.name)} <span class="chip-count">${groups[key].length}</span>
        </button>`;
  }).join("");
  return chips ? `<div class="farm-chipbar">${chips}</div>` : "";
}

export async function renderBountiesTab() {
  const container = document.getElementById("bounties-list-container");
  if (!container) return;

  if (bountyInterval) clearInterval(bountyInterval);

  const t = TEXTS[state.currentLang];
  const headerHTML = buildHeaderHtml(t);

  container.innerHTML = `
      ${headerHTML}
      <div style="display:flex; flex-direction:column; align-items:center; padding:40px; color:#888;">
         <div class="spinner"></div>
         <div style="margin-top:10px">...</div>
      </div>`;
  bindAlarmPanel(container, t);

  const allBounties = await fetchActiveBounties();

  // Evalúa las alarmas sobre TODA la rotación (no solo lo visible) y arranca
  // el watcher en segundo plano para las rotaciones siguientes.
  handleAlarmHits(evaluateAlarms("bounty", allBounties));
  if (getAlarmPrefs().enabled) startAlarmWatcher(fetchActiveBounties, handleAlarmHits);

  const optOverrides = getOptimalOverrides();
  const visibleBounties = state.showAllFarms
    ? allBounties
    : allBounties.filter((b) => isEffectiveOptimal(b, optOverrides));

  if (!visibleBounties || visibleBounties.length === 0) {
    // Vista de óptimas vacía pero con rotación cargada: explicar cómo marcar
    // misiones propias con la estrella desde la vista completa.
    const emptyPickerHtml = !state.showAllFarms && allBounties.length > 0
      ? `
          <div class="optimal-empty">
            <div class="optimal-empty-title">${escapeHTML(t.optimalPicker.emptyTitle)}</div>
            <div class="optimal-empty-desc">${escapeHTML(t.optimalPicker.emptyDesc)}</div>
            <button type="button" class="dashed-btn optimal-empty-btn" id="farm-goto-all">${escapeHTML(t.optimalPicker.btnShowAll)}</button>
          </div>`
      : `
          <div class="no-fissures-msg">
            <span class="warning-icon">⚠</span>
            <div>
              <strong>${t.msgNoBountiesTitle || "No optimal missions active."}</strong><br>
              <small>No data found.</small>
            </div>
          </div>`;

    container.innerHTML = `${headerHTML}${emptyPickerHtml}`;
    bindAlarmPanel(container, t);
    bindHeaderButtons(container);
    container.querySelector("#farm-goto-all")?.addEventListener("click", () => {
      state.showAllFarms = true;
      saveAppState();
      renderBountiesTab();
    });
    return;
  }

  const viewPrefs = getViewPrefs();

  const groups = {};
  visibleBounties.forEach((b) => {
    if (!groups[b.factionKey]) groups[b.factionKey] = [];
    groups[b.factionKey].push(b);
  });

  const expiryTimes = [];
  let html = headerHTML + buildChipbarHtml(groups, viewPrefs);

  for (const [key, missions] of Object.entries(groups)) {
    if (viewPrefs.hiddenFactions.includes(key)) continue;
    const config = FACTION_CONFIG[key] || { name: key, color: "#fff" };
    missions.sort((a, b) => {
      if (b.standing !== a.standing) return b.standing - a.standing;
      if (typeof b.tier === "number" && typeof a.tier === "number")
        return b.tier - a.tier;
      return 0;
    });

    const expiryId = `timer-${key.replaceAll(/\s+/g, "")}`;
    if (missions[0]?.expiry) {
      expiryTimes.push({ id: expiryId, date: new Date(missions[0].expiry) });
    }

    const isCollapsed = viewPrefs.collapsed.includes(key);
    const topStanding = missions[0]?.standing || 0;

    html += `
        <div class="faction-group ${isCollapsed ? "collapsed" : ""}" data-faction="${escapeHTML(key)}">
            <div class="faction-header faction-header-btn" style="border-left-color: ${config.color};" role="button" tabindex="0">
                <span class="faction-name" style="color: ${config.color};">${config.name}
                  <span class="faction-count">${missions.length}</span>
                  <span class="faction-top-standing">+${topStanding}</span>
                </span>
                <span class="faction-header-right">
                  <span id="${expiryId}" class="faction-timer">--:--:--</span>
                  <span class="arrow-icon">▼</span>
                </span>
            </div>
            <div class="faction-body">`;

    if (key === "Ostrons") {
      html += `
        <div style="border: 1px solid var(--wf-gold-text); background: rgba(197, 168, 86, 0.1); padding: 12px; margin-bottom: 15px; border-radius: 6px; color: #ddd; font-size: 0.85rem; line-height: 1.4;">
          <strong style="color: var(--wf-gold-text);">ℹ AYA STRATEGY (TEAM):</strong>
          Start T5 Bounty (Lvl 40-60, NON-SP). Enter Plains, FAIL mission immediately.
          Check Tent console for Capture/Rescue. Accept there.
        </div>
      `;
    }
    missions.forEach((m, index) => {
      html += getBountyMissionHtml(m, index, key, config.color, isEffectiveOptimal(m, optOverrides), t);
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;
  bindAlarmPanel(container, t);
  bindHeaderButtons(container);

  // Estrellas de óptimas: marcar/desmarcar y re-render (la vista de óptimas
  // refleja el cambio al instante; en "todo" solo cambia la estrella y el brillo)
  container.querySelectorAll(".optimal-star").forEach((star) => {
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleOptimalOverride(star.dataset.optkey, star.dataset.opt === "1");
      renderBountiesTab();
    });
  });

  // Chips de sindicato: ocultar/mostrar grupos (persistido)
  container.querySelectorAll(".farm-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.faction;
      const prefs = getViewPrefs();
      const idx = prefs.hiddenFactions.indexOf(key);
      if (idx === -1) prefs.hiddenFactions.push(key);
      else prefs.hiddenFactions.splice(idx, 1);
      saveViewPrefs(prefs);
      renderBountiesTab();
    });
  });

  // Cabeceras de grupo plegables (persistido)
  container.querySelectorAll(".faction-header-btn").forEach((header) => {
    const toggle = () => {
      const group = header.closest(".faction-group");
      const key = group?.dataset.faction;
      if (!group || !key) return;
      group.classList.toggle("collapsed");
      const prefs = getViewPrefs();
      const idx = prefs.collapsed.indexOf(key);
      if (group.classList.contains("collapsed") && idx === -1) prefs.collapsed.push(key);
      else if (!group.classList.contains("collapsed") && idx !== -1) prefs.collapsed.splice(idx, 1);
      saveViewPrefs(prefs);
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });

  const updateTimers = () => {
    const now = new Date();
    expiryTimes.forEach((item) => {
      const el = document.getElementById(item.id);
      if (!el) return;
      const diff = item.date - now;
      if (diff <= 0) {
        el.innerText = "ROTATING...";
        el.style.color = "#f44";
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      el.innerText = `${t.lblEndsIn || "Ends:"} ${h}h ${m}m ${s}s`;
    });
  };

  updateTimers();
  bountyInterval = setInterval(updateTimers, 1000);
}

function bindHeaderButtons(container) {
  container.querySelector("#farm-filter-btn")?.addEventListener("click", () => {
    state.showAllFarms = !state.showAllFarms;
    saveAppState();
    renderBountiesTab();
  });
}

Object.assign(globalThis, {
  toggleFarmsFilter: () => {
    state.showAllFarms = !state.showAllFarms;
    saveAppState();
    renderBountiesTab();
  },
});

// Arranque del watcher aunque el usuario no abra el tab Farms: si hay alarmas
// activas guardadas, empezamos a vigilar rotaciones a los pocos segundos de
// cargar la app (fetch cacheado por expiry, coste mínimo).
setTimeout(() => {
  const prefs = getAlarmPrefs();
  if (prefs.enabled && prefs.rules.length > 0) {
    startAlarmWatcher(fetchActiveBounties, handleAlarmHits);
  }
}, 8000);
