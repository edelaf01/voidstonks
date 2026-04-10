import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { fetchBestFissures } from "../api.js";

let fissureLoadPromise = null;

export async function updateRecommendedMissions(tier) {
  const listArea = document.getElementById("fissures-list-area");

  if (!listArea || listArea.children.length === 0) {
    if (!fissureLoadPromise) {
      fissureLoadPromise = initFissurePanel().then(() => {
        fissureLoadPromise = null;
      });
    }
    await fissureLoadPromise;
  }

  highlightFissureTier(tier);
}

export function renderMissionRow(m) {
  const t = TEXTS[state.currentLang];

  const rawType = m.type.toLowerCase();

  const translatedType =
    t.modes[rawType] || m.type.charAt(0).toUpperCase() + m.type.slice(1);

  const omniaTag = m.isOmnia
    ? `<span class="omnia-tag big" data-tooltip="${t.tooltips.omnia}">OMNIA</span>`
    : "";

  const spTag = m.isSP
    ? `<span class="sp-icon" data-tooltip="${t.tooltips.steelPath}">SP</span>`
    : "";

  return `
        <div class="mission-item ${m.isSP ? "sp-row" : ""}">
            <div class="m-info">
                <span class="m-type">
                    ${translatedType} 
                    ${omniaTag}
                    ${spTag}
                </span>
                <span class="m-node">${m.node}</span>
            </div>
            <div class="m-timer-box">
                <span class="m-eta">${m.eta}</span>
            </div>
        </div>
    `;
}

export function toggleTierGroup(element) {
  if (element) {
    element.classList.toggle("collapsed");
    if (element.classList.contains("collapsed")) {
      element.classList.remove("active");
    }
  }
}

export function highlightFissureTier(tier) {
  if (!tier) return;
  const tierKey = tier.toLowerCase();

  const normalizedTier = tierKey === "vanguard" ? "axi" : tierKey;

  document.querySelectorAll(".fissure-group").forEach((group) => {
    const groupTier = group.dataset.tier;

    if (groupTier === normalizedTier || groupTier === "omnia") {
      group.classList.remove("collapsed");
      group.classList.add("active");

      if (groupTier === normalizedTier) {
        setTimeout(() => {
          group.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    } else {
      group.classList.remove("active");
      group.classList.add("collapsed");
    }
  });
}

export async function initFissurePanel() {

  let missionDiv = document.getElementById("best-missions-container");
  const t = TEXTS[state.currentLang];

  if (!missionDiv) {
    missionDiv = document.createElement("div");
    missionDiv.id = "best-missions-container";
    missionDiv.innerHTML = `
      <div id="mission-toggle-btn" class="mission-toggle-btn" onclick="document.getElementById('best-missions-container').classList.toggle('open')">
         <img src="assets/fissureicon.webp" class="toggle-img" alt="Fisuras">
      </div>
      
      <div class="panel-main-header" id="fissure-panel-header" style="cursor:pointer;" onclick="initFissurePanel()">
          <svg class="gauss-icon" id="gauss-runner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5,5.5 C18.5,5.5 14,8 12,10 C10,12 5,11 2,12 C5,13 9,14 11,16 C13,18 16,19 18.5,19 C16,17 14,14 14,12 C14,10 16,7 18.5,5.5 Z M22,2 L20,4 C20,4 17,7 17,12 C17,17 20,20 20,20 L22,22" fill="currentColor"/>
         </svg>
         <span>${t.lblRecommended || "Fisuras Activas"}</span>
      </div>
      
      <div class="fissures-scroll-area" id="fissures-list-area">
         <div style="padding:10px; text-align:center; color:#666;">Cargando...</div>
      </div>
    `;
    document.body.appendChild(missionDiv);
  }

  const header = document.getElementById("fissure-panel-header");
  const runner = document.getElementById("gauss-runner");
  let runTimeout;
  if (header && runner) {
    header.onmouseenter = () => {
      runTimeout = setTimeout(() => {
        runner.classList.add("is-running");
        setTimeout(() => {
          runner.classList.remove("is-running");
        }, 3000);
      }, 2000);
    };
    header.onmouseleave = () => clearTimeout(runTimeout);
  }


  if (!globalThis._fissureRefreshInterval) {
    globalThis._fissureRefreshInterval = setInterval(() => {
      const panel = document.getElementById("best-missions-container");
      if (panel?.classList.contains("open")) {
        console.log("[FISSURES]: Auto-refreshing missions...");
        initFissurePanel();
      }
    }, 5 * 60 * 1000);
  }

  const allMissions = await fetchBestFissures();

  const tiersOrder = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
  const tiersData = {
    Lith: [],
    Meso: [],
    Neo: [],
    Axi: [],
    Requiem: [],
    Omnia: [],
  };

  allMissions.forEach((m) => {
    let tName = m.tier;
    if (tName === "Vanguard") tName = "Axi";
    if (tiersData[tName]) tiersData[tName].push(m);
  });

  const listArea = document.getElementById("fissures-list-area");
  listArea.innerHTML = "";

  const efficientTypes = new Set([
    "Capture",
    "Extermination",
    "Rescue",
    "Sabotage",
    "Void Cascade",
  ]);

  tiersOrder.forEach((tierName) => {
    const allTierMissions = tiersData[tierName];

    const efficientMissions = allTierMissions.filter(
      (m) => efficientTypes.has(m.type) || m.tier === "Omnia",
    );

    const groupDiv = document.createElement("div");
    groupDiv.className = "fissure-group collapsed";
    groupDiv.id = `group-${tierName.toLowerCase()}`;
    groupDiv.dataset.tier = tierName.toLowerCase();

    const headerBtn = document.createElement("button");
    headerBtn.className = "tier-header-btn";
    headerBtn.innerHTML = `<span>${tierName} (${efficientMissions.length})</span> <span class="arrow-icon">▼</span>`;
    headerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTierGroup(groupDiv);
    });

    const contentDiv = document.createElement("div");
    contentDiv.className = "tier-content";

    if (efficientMissions.length === 0) {
      const noDataMsg =
        state.currentLang === "es"
          ? "No se han detectado fisuras eficientes"
          : "No efficient fissures detected";

      contentDiv.innerHTML = `
            <div class="no-fissures-msg">
                <span class="warning-icon">⚠</span> ${noDataMsg}
            </div>
        `;
    } else {
      let html = "";
      const normal = efficientMissions.filter((m) => !m.isSP);
      const sp = efficientMissions.filter((m) => m.isSP);

      if (normal.length > 0) {
        html += `<div style="padding:4px 8px; font-size:0.75em; color:#666; font-weight:bold;">NORMAL</div>`;
        normal.forEach((m) => (html += renderMissionRow(m)));
      }
      if (sp.length > 0) {
        html += `<div style="padding:4px 8px; font-size:0.75em; color:#a55; font-weight:bold; margin-top:5px;">STEEL PATH</div>`;
        sp.forEach((m) => (html += renderMissionRow(m)));
      }
      contentDiv.innerHTML = html;
    }

    groupDiv.appendChild(headerBtn);
    groupDiv.appendChild(contentDiv);
    listArea.appendChild(groupDiv);
  });

  if (state.selectedRelic) {
    const tier = state.selectedRelic.split(" ")[0];
    highlightFissureTier(tier);
  }
}
