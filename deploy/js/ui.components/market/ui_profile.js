import { state, saveAppState } from "../../state.js";
import { TEXTS } from "../../config.js";
// not using this class at all, but it works so it wastes your bandwidth

export function renderProfileStats(mr, focus, standingObj, isCalc = false) {
  const container = document.getElementById("profile-data");
  if (!container) return;
  const t = TEXTS[state.currentLang];
  const tracesCap = 100 + 50 * mr;
  let standingHtml = "";
  if (standingObj) {
    for (const [faction, amount] of Object.entries(standingObj)) {
      if (typeof amount === "number" && amount >= 0) {
        standingHtml += `<div class="standing-item"><div style="font-size:0.8em;color:#aaa">${faction}</div><div class="standing-val">${amount.toLocaleString()}</div></div>`;
      }
    }
  }
  container.innerHTML = `
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div class="profile-stat-box" style="flex:1"><div class="profile-stat-title">Mastery Rank</div><div class="profile-stat-val" style="color:#gold">${mr}</div></div>
            <div class="profile-stat-box" style="flex:1"><div class="profile-stat-title">${t.lblTraces
    }</div><div class="profile-stat-val">${tracesCap}</div></div>
        </div>
        <div class="profile-stat-box"><div class="profile-stat-title">${t.lblDailyFocus
    } ${isCalc ? "(Max)" : "(Remaining)"
    }</div><div class="profile-stat-val" style="color:var(--wf-riven)">${focus.toLocaleString()}</div></div>
        <div style="margin-top:15px; font-weight:bold; color:var(--wf-blue); text-align:center;">${t.lblStanding
    }</div>
        <div class="standing-grid">${standingHtml}</div>
    `;
}
export function calculateCaps() {
  const inputEl = document.getElementById("mrInput");
  if (!inputEl) return;
  const mr = Number.parseInt(inputEl.value) || 0;
  const focusCap = 250000 + 5000 * mr;
  const standingCap = 16000 + 500 * mr;
  const mockStanding = {
    Ostron: standingCap,
    Solaris: standingCap,
    Entrati: standingCap,
    Cavia: standingCap,
  };
  renderProfileStats(mr, focusCap, mockStanding, true);
  saveAppState();
}
