import { state, saveAppState } from "../../state.js";
import { TEXTS, VANIA_NAMES, CHALLENGE_MAP } from "../../config.js";
import { fetchActiveBounties } from "../../services/farms/bounties.service.js";
import { escapeHTML, showToast } from "../ui_components.js";
import { exposeGlobals } from "../../utils/global_registry.js";
import {
  getViewPrefs,
  saveViewPrefs,
  getOptimalOverrides,
  optimalKey,
  isEffectiveOptimal,
  toggleOptimalOverride,
} from "../../services/farms/farms_prefs.service.js";
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
  ruleChallenges,
  SPECIAL_TIER_VALUE,
} from "../../services/farms/alerts.service.js";

let bountyInterval = null;
// the alarm panel re-renders with the tab: remember whether it was open
let alarmPanelOpen = false;
// module level on purpose: as a local inside renderBountiesTab() it reset on every render and the
// retry looped every ~5 s
let rotationReloadAt = 0;
// render turn: renders are async and have many triggers. One that is no longer the last bails out
// without painting or leaving an interval behind.
let renderToken = 0;

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

function getTierColor(tier) {
  return TIER_COLORS[tier] ?? (tier >= 3 ? "#00ccff" : "#888");
}

function getLevelDisplay(m) {
  if (m.isDual) {
    return `
      <div class="bounty-levels">
        <span class="bounty-lvl">Lvl ${m.level}<b class="bounty-standing">+${m.standing}</b></span>
        <span class="bounty-lvl-sep">|</span>
        <span class="bounty-lvl is-sp">SP ${m.levelSP}<b class="bounty-standing">+${m.standingSP}</b></span>
      </div>`;
  }
  const tag = m.isSP ? "STEEL PATH" : "NORMAL PATH";
  return `
      <div class="bounty-levels">
        <span class="bounty-lvl ${m.isSP ? "is-sp" : ""}">${tag} · Lvl ${m.level}<b class="bounty-standing">+${m.standing}</b></span>
      </div>`;
}

function getRewardsContent(m) {
  if (!m.detailedRewards) {
    // rewardPool comes raw from the worldstate, so it is escaped too
    const rewardListHtml = m.rewards.map((r) => `<li class="drop-item">${escapeHTML(r)}</li>`).join("");
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
  const special = m.tier === 6 || m.tier === "NARMER";
  const label = typeof tierLabel === "string" ? tierLabel : `TIER ${tierLabel}`;
  return `<span class="tier-badge ${special ? "special" : ""}" style="--tier-color:${tierColor};">${escapeHTML(label)}</span>`;
}

function getBountyMissionHtml(m, index, key, color, isOpt, t) {
  const uniqueId = `drops-${key}-${index}`.replaceAll(/\s+/g, "");
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
    ? `<div class="bounty-condition"><span class="bounty-condition-tag">${escapeHTML(t.lblChallenge || "CHALLENGE")}</span>${escapeHTML(m.condition)}</div>`
    : "";
  const techType = m.factionKey === "The Hex"
    ? (VANIA_NAMES[m.technicalType] || m.technicalType)
    : m.technicalType;

  return `
    <div class="bounty-wrapper ${spClass} ${optimalClass}">
        <div class="bounty-header-row">
            <div class="bounty-info">
               <div class="bounty-type">
                  <span class="bounty-tech">${escapeHTML(techType)}</span>
                  ${tierBadgeHtml}
                  <span class="bounty-name">${escapeHTML(m.type)}</span>
                </div>
                ${levelDisplay}
                ${conditionHtml}
            </div>
            <div class="bounty-side-actions">
                ${starHtml}
                <button type="button" class="bounty-rewards-btn" style="--reward-color:${color};" aria-expanded="false" onclick="globalThis.toggleBountyDrawer(this, '${uniqueId}')">
                    ${escapeHTML(t.lblViewRewards || "REWARDS")}
                </button>
            </div>
        </div>
        <div id="${uniqueId}" class="bounty-drops-drawer">${rewardsContent}</div>
    </div>`;
}

export function toggleBountyDrawer(btn, drawerId) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  const open = drawer.classList.toggle("open");
  btn.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", String(open));
}

// technicalType values in bounties.service (getTechType + NODE_TO_TYPE)
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

// mission types and special tier each syndicate can actually roll (NARMER in Cetus/Fortuna, CODA in
// Höllvania)
const FACTION_ALARM_OPTIONS = {
  any: { types: ALARM_MISSION_TYPES, special: null }, // special null = generic label
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

// Höllvania uses the 1999 names (Alchemy -> Legacyte Harvest, Survival -> Hell-Scrub...)
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

// CHALLENGE_MAP challenges by syndicate (uniqueName prefix). The option value is the label (what ends
// in m.condition), deduped: Easy/Hard/VeryHard share a description.
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

// empty = any challenge
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

  // bounty rules only: fissure rules live in the fissure panel
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
    html: true, // the message builds <b>/<br> and already escapes every value
  });
}

function bindAlarmPanel(container, t) {
  const panel = container.querySelector("#farm-alarm-panel");
  if (!panel) return;

  const refreshPanel = () => {
    panel.innerHTML = renderAlarmPanel(t);
    bindPanelControls();
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
        // syndicates without mapped challenges (Cetus/Fortuna/Necralisk) hide the box
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
      // the first rule turns the master switch on, or the alarm never fires
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

function buildHeaderHtml(t) {
  const alarmPrefs = getAlarmPrefs();
  const nBounty = alarmPrefs.rules.filter((r) => (r.kind || "bounty") === "bounty").length;
  const alarmActive = alarmPrefs.enabled && nBounty > 0;

  return `
      <div class="farms-header">
          <div class="farms-title">
            <span id="lbl-fast-farms-title">${escapeHTML(t.lblFastFarms || "Active Farms")}</span>
            <span class="info-icon" id="bounties-guide-icon" data-tooltip="${escapeHTML(t.fastFarmGuide || "")}">ℹ️</span>
          </div>
          <div class="farms-actions">
              <div class="farm-segment" role="group">
                <button type="button" class="farm-seg-btn ${state.showAllFarms ? "" : "active"}"
                  data-showall="0" aria-pressed="${state.showAllFarms ? "false" : "true"}">
                  ${escapeHTML(t.lblOptimalOnly || "Optimal")}
                </button>
                <button type="button" class="farm-seg-btn ${state.showAllFarms ? "active" : ""}"
                  data-showall="1" aria-pressed="${state.showAllFarms ? "true" : "false"}">
                  ${escapeHTML(t.lblShowAll || "All")}
                </button>
              </div>
              <button type="button" id="farm-alarms-btn" class="farm-action-btn ${alarmActive ? "active-filter" : ""}"
                aria-expanded="${alarmPanelOpen ? "true" : "false"}" title="${escapeHTML(t.farmAlarms.toggle)}">
                <span class="farm-btn-label">${escapeHTML(t.farmAlarms.toggle)}</span>
                <span class="alarm-count">${nBounty > 0 ? nBounty : ""}</span>
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

/**
 * Stops the rotation countdown. Called before repainting and when Farms switches to weapons, so it
 * does not tick against hidden nodes.
 */
export function stopBountyTimers() {
  if (bountyInterval) clearInterval(bountyInterval);
  // null too, so an overlapped render does not think it stopped an interval still to be created
  bountyInterval = null;
}

/** @param {boolean} [force] */
export async function renderBountiesTab(force = false) {
  const container = document.getElementById("bounties-list-container");
  if (!container) return;

  const myTurn = ++renderToken;
  stopBountyTimers();

  const t = TEXTS[state.currentLang];
  const headerHTML = buildHeaderHtml(t);

  container.innerHTML = `
      ${headerHTML}
      <div class="farm-loading">
         <div class="spinner"></div>
         <div>${escapeHTML(t.loadingWorldstate || "Loading Worldstate...")}</div>
      </div>`;
  bindAlarmPanel(container, t);

  const allBounties = await fetchActiveBounties(force);
  // another render started while waiting for the network: it owns the tab now
  if (myTurn !== renderToken) return;

  // alarms check the whole rotation, not just what is visible
  handleAlarmHits(evaluateAlarms("bounty", allBounties));
  if (getAlarmPrefs().enabled) startAlarmWatcher(fetchActiveBounties, handleAlarmHits);

  const optOverrides = getOptimalOverrides();
  const visibleBounties = state.showAllFarms
    ? allBounties
    : allBounties.filter((b) => isEffectiveOptimal(b, optOverrides));

  if (!visibleBounties || visibleBounties.length === 0) {
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
      expiryTimes.push({ id: expiryId, at: new Date(missions[0].expiry).getTime() });
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
        <div class="farm-tip">
          <strong class="farm-tip-title">${escapeHTML(t.ayaStrategyTitle || "AYA STRATEGY (TEAM)")}</strong>
          <span>${escapeHTML(t.ayaStrategyBody || "")}</span>
        </div>`;
    }
    missions.forEach((m, index) => {
      html += getBountyMissionHtml(m, index, key, config.color, isEffectiveOptimal(m, optOverrides), t);
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;
  bindAlarmPanel(container, t);
  bindHeaderButtons(container);

  container.querySelectorAll(".optimal-star").forEach((star) => {
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleOptimalOverride(star.dataset.optkey, star.dataset.opt === "1");
      renderBountiesTab();
    });
  });

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

  // at zero it must refetch, not just show ROTATING: the cached data keeps the old expiry. The 5 s
  // margin waits for the worldstate to publish the new rotation.
  const updateTimers = () => {
    // serverNow(), not Date.now(): a system clock a few minutes ahead showed ROTATING early
    const now = serverNow();
    let anyExpired = false;

    // without a synced clock a small negative is not trusted; synced, the margin is 0
    const margin = isClockSynced() ? 0 : 5 * 60 * 1000;

    expiryTimes.forEach((item) => {
      const el = document.getElementById(item.id);
      if (!el) return;
      const diff = item.at - now;
      if (diff <= -margin) {
        anyExpired = true;
        el.textContent = t.lblRotating || "ROTATING...";
        el.classList.add("expired");
        return;
      }
      const safe = Math.max(0, diff);
      const h = Math.floor(safe / (1000 * 60 * 60));
      const m = Math.floor((safe % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((safe % (1000 * 60)) / 1000);
      el.classList.remove("expired");
      el.classList.toggle("urgent", diff < 3600000);
      el.textContent = `${t.lblEndsIn || "Ends:"} ${h}h ${m}m ${s}s`;
    });

    if (!anyExpired) return;
    // at most one retry every 30 s: until the worldstate rotates it returns the same expiry
    const ts = Date.now();
    if (ts < rotationReloadAt) return;
    rotationReloadAt = ts + 30000;
    setTimeout(() => {
      // force: the entry just saved lives 60 s (expiryTime floor), so a cached retry would return the same
      // expired missions
      if (myTurn !== renderToken) return;
      if (state.activeTab === "bounties") renderBountiesTab(true);
    }, 5000);
  };

  updateTimers();
  bountyInterval = setInterval(updateTimers, 1000);
}

function bindHeaderButtons(container) {
  container.querySelectorAll(".farm-seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.showall === "1";
      if (next === state.showAllFarms) return;
      state.showAllFarms = next;
      saveAppState();
      renderBountiesTab();
    });
  });
}

exposeGlobals({
  toggleFarmsFilter: () => {
    state.showAllFarms = !state.showAllFarms;
    saveAppState();
    renderBountiesTab();
  },
  toggleBountyDrawer,
}, "ui.components/farms/ui_bounties.js");

// start the watcher at load when there are saved active alarms, even if Farms is never opened
setTimeout(() => {
  const prefs = getAlarmPrefs();
  if (prefs.enabled && prefs.rules.length > 0) {
    startAlarmWatcher(fetchActiveBounties, handleAlarmHits);
  }
}, 8000);
