import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { fetchBestFissures } from "../services/fissures.service.js";
import { escapeHTML } from "./ui_components.js";

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
                    ${escapeHTML(translatedType)}
                    ${omniaTag}
                    ${spTag}
                </span>
                <span class="m-node">${escapeHTML(m.node)}</span>
            </div>
            <div class="m-timer-box">
                <span class="m-eta" data-expiry="${m.expiry}">${escapeHTML(m.eta)}</span>
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
    document.body.appendChild(missionDiv);
  }

  // Update static part of the HTML
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
      // Solo refresca si el panel está abierto: evita quemar llamadas al worker cuando nadie mira.
      if (panel?.classList.contains("open")) {
        console.log("[FISSURES]: Auto-refreshing missions...");
        initFissurePanel();
      }
    }, 150 * 1000); // 2.5 min (la cache en memoria de 2 min garantiza datos frescos sin spam)
  }

  let allMissions = await fetchBestFissures();

  // No renderizar fisuras YA expiradas: el fetch puede venir del caché (2 min) o la API tardar
  // en retirarlas, y pintarlas con data-expiry en el pasado hacía que el countdown disparara
  // "expired → refresh" en bucle cada segundo (el refresh recibía la misma lista con la fisura
  // caducada dentro).
  allMissions = allMissions.filter(m => !m.expiry || (new Date(m.expiry) - Date.now()) > 0);

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
  // Active client-side countdown timer to update dynamically and refresh on expiration
  if (!globalThis._fissureCountdownInterval) {
    globalThis._fissureCountdownInterval = setInterval(() => {
      let expiredFound = false;
      document.querySelectorAll(".m-eta[data-expiry]").forEach((el) => {
        const expiryStr = el.getAttribute("data-expiry");
        if (!expiryStr) return;
        const expiry = new Date(expiryStr);
        const now = new Date();
        const diffMs = expiry - now;
        if (diffMs <= 0) {
          el.innerText = state.currentLang === "es" ? "Expirado" : "Expired";
          expiredFound = true;
        } else {
          const totalSecs = Math.floor(diffMs / 1000);
          const hrs = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;

          if (hrs > 0) {
            el.innerText = `${hrs}h ${mins}m ${secs}s`;
          } else if (mins > 0) {
            el.innerText = `${mins}m ${secs}s`;
          } else {
            el.innerText = `${secs}s`;
          }
        }
      });
      if (expiredFound) {
        // Cooldown de 60s: si el refresh devuelve datos cacheados que aún contienen la fisura
        // expirada, sin este guard se re-disparaba el ciclo expired→refresh cada segundo.
        const now = Date.now();
        if (!globalThis._fissureLastExpiryRefresh || now - globalThis._fissureLastExpiryRefresh > 60000) {
          globalThis._fissureLastExpiryRefresh = now;
          console.log("[FISSURES]: Fissure expired, refreshing list...");
          if (globalThis._fissureCountdownInterval) {
            clearInterval(globalThis._fissureCountdownInterval);
            globalThis._fissureCountdownInterval = null;
          }
          initFissurePanel();
        }
      }
    }, 1000);
  }
}
