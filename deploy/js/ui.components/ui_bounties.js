import { state, saveAppState } from "../state.js";
import { TEXTS } from "../config.js";
import { fetchActiveBounties } from "../api.js";

let bountyInterval = null;

function getBountyMissionHtml(m, index, key, color) {
  const uniqueId = `drops-${key}-${index}`.replaceAll(/\s+/g, "");
  const opacity = m.isOptimal ? "1" : "0.7";
  let tierColor = "#888";
  let tierLabel = m.tier;

  if (m.tier === "NARMER") {
    tierColor = "#ffaa00";
  } else if (m.tier === 6) {
    tierColor = "#ff4d4d";
  } else if (m.tier === 5) {
    tierColor = "#ffcc00";
  } else if (m.tier >= 3) {
    tierColor = "#00ccff";
  }

  let levelDisplay = "";
  if (m.isDual) {
    levelDisplay = `
      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82em; margin-top: 4px; flex-wrap: wrap;">
        <span style="color: #aaa;">Lvl ${m.level} <b style="color:#888">(+${m.standing})</b></span>
        <span style="color: #444;">|</span>
        <span style="color: #ff4d4d;">SP ${m.levelSP} <b style="color:#ff4d4d99">(+${m.standingSP})</b></span>
      </div>`;
  } else {
    const tag = m.isSP ? "STEEL PATH" : "NORMAL PATH";
    const lvlColor = m.isSP ? "#ff4d4d" : "#aaa";
    levelDisplay = `
      <div style="color: ${lvlColor}; font-weight: bold; font-size: 0.85em; margin-top: 4px;">
        ${tag} (Lvl ${m.level}) <span style="color: #888; font-weight: normal;">(+${m.standing})</span>
      </div>`;
  }

  const rewardsContent = m.detailedRewards
    ? m.detailedRewards
      .map((stage) => {
        const rows = stage.drops
          .map(
            (d) =>
              `<div class="drop-row"><span class="drop-name ${d.name.includes("Aya") ? "aya" : ""}">${d.name}</span><span class="drop-chance">${d.chance.toFixed(2)}%</span></div>`,
          )
          .join("");
        return `<div class="stage-container"><div class="stage-header">STAGE ${stage.stage}</div><div class="stage-content">${rows}</div></div>`;
      })
      .join("")
    : `<ul class="drop-list">${m.rewards.map((r) => `<li class="drop-item">${r}</li>`).join("")}</ul>`;

  return `
    <div class="bounty-wrapper ${m.isSP || m.isDual ? "is-sp" : ""} ${m.isOptimal ? "optimal-farm" : ""}" style="opacity:${opacity};">
        <div class="bounty-header-row">
            <div class="bounty-info">
               <div class="bounty-type" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span style="color:var(--wf-blue); font-weight:900; font-size:0.75em; text-transform:uppercase; border-right:1px solid #444; padding-right:8px;">
                    ${m.technicalType}
                  </span>
                  ${m.hideTier ? "" : `
                  <span style="color: ${tierColor}; border: 1px solid ${tierColor}44; padding: 1px 6px; font-size: 0.7em; border-radius: 3px; font-weight: 900; background: ${m.tier === 6 || m.tier === "NARMER" ? "rgba(255,170,0,0.1)" : "transparent"}">
                    ${tierLabel === "NARMER" ? "" : "TIER "}${tierLabel}
                  </span>`
    }
                  <span style="color: #fff; font-weight: 600; flex: 1;">${m.type}</span>
                </div>
                ${levelDisplay}
                ${m.condition ? `<div style="background: rgba(255,255,255,0.05); border-left: 3px solid #666; padding: 6px 12px; margin-top: 10px; font-size: 0.85em; color: #ccc; white-space: normal;">CHALLENGE: ${m.condition}</div>` : ""}
            </div>
            <button class="bounty-rewards-btn" style="color: ${color};" onclick="document.getElementById('${uniqueId}').classList.toggle('open')">
                VIEW REWARDS
            </button>
        </div>
        <div id="${uniqueId}" class="bounty-drops-drawer">${rewardsContent}</div>
    </div>`;
}

export async function renderBountiesTab() {
  const container = document.getElementById("bounties-list-container");
  if (!container) return;

  if (bountyInterval) clearInterval(bountyInterval);

  const t = TEXTS[state.currentLang];
  let toggleText = "";
  if (state.showAllFarms) {
    toggleText = state.currentLang === "en" ? "SHOWING ALL" : "MOSTRANDO TODO";
  } else {
    toggleText = state.currentLang === "en" ? "OPTIMAL ONLY" : "SOLO ÓPTIMAS";
  }

  const headerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding:0 5px;">
          <div class="panel-main-header" style="margin:0; border-radius:4px; flex-grow:1; margin-right:10px;">
            <span id="lbl-fast-farms-title">${t.lblFastFarms || "Active Farms"}</span>
            <span class="info-icon" id="bounties-guide-icon" data-tooltip="${t.fastFarmGuide}">ℹ️</span>
          </div>
          
          <button 
            class="dashed-btn ${state.showAllFarms ? "active-filter" : ""}" 
            style="
              font-weight:800; 
              font-size:0.75em; 
              height:46px; 
              border:1px solid #444; 
              color:${state.showAllFarms ? "#fff" : "#888"}; 
              background:${state.showAllFarms ? "var(--wf-blue)" : "transparent"};
              cursor: pointer;
            "
            onclick="globalThis.toggleFarmsFilter()"
          >
            ${toggleText}
          </button>
      </div>
  `;

  container.innerHTML = `
      ${headerHTML}
      <div style="display:flex; flex-direction:column; align-items:center; padding:40px; color:#888;">
         <div class="spinner"></div>
         <div style="margin-top:10px">...</div>
      </div>`;

  const allBounties = await fetchActiveBounties();

  let visibleBounties = state.showAllFarms
    ? allBounties
    : allBounties.filter((b) => b.isOptimal);

  if (!visibleBounties || visibleBounties.length === 0) {
    container.innerHTML = `
          ${headerHTML}
          <div class="no-fissures-msg">
            <span class="warning-icon">⚠</span> 
            <div>
              <strong>${t.msgNoBountiesTitle || "No optimal missions active."}</strong><br>
              <small>${state.showAllFarms ? "No data found." : t.msgNoBountiesDesc || "Try switching to 'SHOW ALL'."}</small>
            </div>
          </div>`;
    return;
  }

  const factionConfig = {
    "The Holdfasts": { name: "Zariman (Ten Zero)", color: "#d4af37" },
    Cavia: { name: "Sanctum Anatomica (Cavia)", color: "#a545e0" },
    "The Hex": { name: "Höllvania (1999)", color: "#42f56c" },
    Ostrons: { name: "Cetus (Aya Farm)", color: "#d6b07c" },
    "Solaris United": { name: "Fortuna (Solaris)", color: "#00e5ff" },
    Entrati: { name: "Necralisk (Entrati)", color: "#ffaa00" },
  };

  const groups = {};
  visibleBounties.forEach((b) => {
    if (!groups[b.factionKey]) groups[b.factionKey] = [];
    groups[b.factionKey].push(b);
  });

  const expiryTimes = [];
  let html = headerHTML;

  for (const [key, missions] of Object.entries(groups)) {
    const config = factionConfig[key] || { name: key, color: "#fff" };
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

    html += `
        <div style="margin-bottom: 20px;">
            <div class="faction-header" style="border-left-color: ${config.color};">
                <span class="faction-name" style="color: ${config.color};">${config.name}</span>
                <span id="${expiryId}" style="font-size:0.9em; color:#fff; font-family:monospace; background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px;">
                    --:--:--
                </span>
            </div>`;

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
      html += getBountyMissionHtml(m, index, key, config.color);
    });
    html += `</div>`;
  }

  container.innerHTML = html;

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

Object.assign(globalThis, {
  toggleFarmsFilter: () => {
    state.showAllFarms = !state.showAllFarms;
    saveAppState();
    renderBountiesTab();
  },
});
