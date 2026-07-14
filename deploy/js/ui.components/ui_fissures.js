import { state } from "../state.js";
import { TEXTS } from "../config.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;
import {
  fetchBestFissures,
  fetchArbitration,
  getFissurePrefs,
  saveFissurePrefs,
  DEFAULT_MISSION_TYPES,
  RAILJACK_MISSION_TYPES,
} from "../services/fissures.service.js";
import { escapeHTML } from "./ui_components.js";

let fissureLoadPromise = null;

// Tipos de misión que el usuario puede activar/desactivar (subconjunto de t.modes disponible
// en ambos idiomas). Railjack y Omnia se controlan aparte porque no son "tipos" normales.
const AVAILABLE_MISSION_TYPES = [
  "Capture",
  "Extermination",
  "Rescue",
  "Sabotage",
  "Void Cascade",
  "Disruption",
  "Survival",
  "Defense",
  "Mobile Defense",
  "Spy",
];

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

  const rjTag = m.isStorm
    ? `<span class="rj-tag" data-tooltip="${t.tooltips.railjack}">RJ</span>`
    : "";

  return `
        <div class="mission-item ${m.isSP ? "sp-row" : ""}">
            <div class="m-info">
                <span class="m-type">
                    ${escapeHTML(translatedType)}
                    ${omniaTag}
                    ${spTag}
                    ${rjTag}
                </span>
                <span class="m-node">${escapeHTML(m.node)}</span>
            </div>
            <div class="m-timer-box">
                <span class="m-eta" data-expiry="${m.expiry}">${escapeHTML(m.eta)}</span>
            </div>
        </div>
    `;
}

function renderFissureFiltersPanel(prefs) {
  const t = TEXTS[state.currentLang];

  const typeCheckboxes = AVAILABLE_MISSION_TYPES.map((type) => {
    const label = t.modes[type.toLowerCase()] || type;
    const checked = prefs.missionTypes.includes(type) ? "checked" : "";
    return `
        <label class="lfg-checkbox-wrapper">
            <input type="checkbox" class="fissure-pref-type" value="${escapeHTML(type)}" ${checked}>
            <span class="lfg-label">${escapeHTML(label)}</span>
        </label>`;
  }).join("");

  const rjTypeCheckboxes = RAILJACK_MISSION_TYPES.map((type) => {
    const label = t.modes[type.toLowerCase()] || type;
    const checked = prefs.railjackTypes.includes(type) ? "checked" : "";
    return `
        <label class="lfg-checkbox-wrapper">
            <input type="checkbox" class="fissure-pref-rjtype" value="${escapeHTML(type)}" ${checked}>
            <span class="lfg-label">${escapeHTML(label)}</span>
        </label>`;
  }).join("");

  return `
        <div class="fissure-filters-section">
            <span class="fissure-filters-title">${escapeHTML(t.fissurePrefs.missionTypes)}</span>
            <div class="fissure-filters-grid">${typeCheckboxes}</div>
        </div>
        <div class="fissure-filters-section">
            <label class="lfg-checkbox-wrapper">
                <input type="checkbox" id="fissure-pref-omnia" ${prefs.includeOmnia ? "checked" : ""}>
                <span class="lfg-label">${escapeHTML(t.fissurePrefs.omnia)}</span>
            </label>
            <label class="lfg-checkbox-wrapper">
                <input type="checkbox" id="fissure-pref-railjack" ${prefs.includeRailjack ? "checked" : ""}>
                <span class="lfg-label">${escapeHTML(t.fissurePrefs.railjack)}</span>
            </label>
        </div>
        <div class="fissure-filters-section" id="fissure-rj-types-section" ${prefs.includeRailjack ? "" : 'style="display:none;"'}>
            <span class="fissure-filters-title">${escapeHTML(t.fissurePrefs.railjackTypes)}</span>
            <div class="fissure-filters-grid">${rjTypeCheckboxes}</div>
        </div>
        <button type="button" class="fissure-filters-reset" id="fissure-filters-reset">${escapeHTML(t.fissurePrefs.reset)}</button>
    `;
}

// Lee el estado de los checkboxes del panel de filtros y guarda las preferencias resultantes.
function readAndSaveFissurePrefsFromPanel(filtersPanel) {
  const selectedTypes = Array.from(
    filtersPanel.querySelectorAll(".fissure-pref-type:checked"),
  ).map((el) => el.value);

  const selectedRjTypes = Array.from(
    filtersPanel.querySelectorAll(".fissure-pref-rjtype:checked"),
  ).map((el) => el.value);

  const newPrefs = {
    missionTypes: selectedTypes,
    includeOmnia: document.getElementById("fissure-pref-omnia")?.checked ?? true,
    includeRailjack: document.getElementById("fissure-pref-railjack")?.checked ?? false,
    railjackTypes: selectedRjTypes,
  };

  saveFissurePrefs(newPrefs);
  return newPrefs;
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

    // La categoría de Arbitration no participa en el resaltado por tier de reliquia.
    if (groupTier === "arbitration") return;

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

  const fissurePrefs = getFissurePrefs();

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

      <div class="fissure-filters-bar">
          <button type="button" class="fissure-filters-toggle" id="fissure-filters-toggle">${escapeHTML(t.fissurePrefs.toggle)}</button>
      </div>
      <div class="fissure-filters-panel collapsed" id="fissure-filters-panel">
          ${renderFissureFiltersPanel(fissurePrefs)}
      </div>

      <div class="fissure-arby-bar" id="fissure-arby-bar" style="display:none;"></div>

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

  const filtersToggleBtn = document.getElementById("fissure-filters-toggle");
  const filtersPanel = document.getElementById("fissure-filters-panel");
  if (filtersToggleBtn && filtersPanel) {
    filtersToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      filtersPanel.classList.toggle("collapsed");
    });
    // Evita que un click dentro del panel de filtros colapse/re-cargue el panel principal.
    filtersPanel.addEventListener("click", (e) => e.stopPropagation());
    filtersPanel.addEventListener("change", (e) => {
      if (!e.target.matches("input[type=checkbox]")) return;
      // El subfiltro de tipos de Railjack solo tiene sentido con el toggle activo.
      if (e.target.id === "fissure-pref-railjack") {
        const rjSection = document.getElementById("fissure-rj-types-section");
        if (rjSection) rjSection.style.display = e.target.checked ? "" : "none";
      }
      readAndSaveFissurePrefsFromPanel(filtersPanel);
      // Re-filtra sobre la cache en memoria (sin refetch): respeta el TTL de 2 min.
      renderMissionList();
    });

    const resetBtn = document.getElementById("fissure-filters-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        saveFissurePrefs({
          missionTypes: [...DEFAULT_MISSION_TYPES],
          includeOmnia: true,
          includeRailjack: false,
          railjackTypes: [...RAILJACK_MISSION_TYPES],
        });
        initFissurePanel();
      });
    }
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

  await renderMissionList();
  renderArbitrationBar();

  // Active client-side countdown timer to update dynamically and refresh on expiration
  if (!globalThis._fissureCountdownInterval) {
    globalThis._fissureCountdownInterval = setInterval(() => {
      let expiredFound = false;
      const syncedNow = Date.now() - (globalThis._serverTimeOffset || 0);
      document.querySelectorAll(".m-eta[data-expiry]").forEach((el) => {
        const expiryStr = el.getAttribute("data-expiry");
        if (!expiryStr) return;
        const expiry = new Date(expiryStr);
        const now = new Date(syncedNow);
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
      // Upcoming rotations de Arbitration: mismo tick, solo se recalculan los minutos
      // desde data-starts (sin refetch). Al llegar a 0 la rotación actual expira a la vez
      // y el refresh del panel ya trae la lista nueva.
      const startsIn = TEXTS[state.currentLang]?.arbitration?.startsIn || "en";
      document.querySelectorAll(".arby-next-time[data-starts]").forEach((el) => {
        const diffMins = Math.max(0, Math.round((new Date(el.getAttribute("data-starts")) - syncedNow) / 60000));
        const rel = diffMins >= 60
          ? `${Math.floor(diffMins / 60)}h ${String(diffMins % 60).padStart(2, "0")}m`
          : `${diffMins}m`;
        el.textContent = `${startsIn} ${rel}`;
      });

      if (expiredFound) {
        // Cooldown de 60s: si el refresh devuelve datos cacheados que aún contienen la fisura
        // expirada, sin este guard se re-disparaba el ciclo expired→refresh cada segundo.
        const now = syncedNow;
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

/**
 * Pinta la Arbitration como una categoría propia (grupo colapsable, igual que los tiers):
 * misión actual con tipo traducido, facción, tier comunitario y cuenta atrás, más las
 * siguientes rotaciones y una nota de cómo se determina el tier. Si el parser falla, el
 * bloque no se muestra. El countdown lo lleva el intervalo global vía .m-eta[data-expiry],
 * y al expirar el refresh del panel trae la rotación nueva.
 */
async function renderArbitrationBar() {
  const box = document.getElementById("fissure-arby-bar");
  if (!box) return;
  try {
    const arby = await fetchArbitration();
    const cur = arby?.current;
    if (!cur) {
      box.style.display = "none";
      return;
    }
    const t = TEXTS[state.currentLang];
    const typeOf = (m) => t.modes[(m.type || "").toLowerCase()] || m.type || "";
    const tierTag = (m, big) => m.tier
      ? `<span class="arby-tier${big ? " big" : ""}" data-tooltip="${escapeHTML(t.arbitration.tierTooltip)}">${escapeHTML(m.tier)}</span>`
      : "";

    const upcomingRows = (arby.upcoming || []).slice(0, 3).map((m) => {
      // Tiempo relativo hasta la rotación: no depende de la zona horaria del cliente.
      const diffMins = Math.max(0, Math.round((new Date(m.activation) - (Date.now() - (globalThis._serverTimeOffset || 0))) / 60000));
      const rel = diffMins >= 60
        ? `${Math.floor(diffMins / 60)}h ${String(diffMins % 60).padStart(2, "0")}m`
        : `${diffMins}m`;
      const tier = m.tier
        ? tierTag(m)
        : `<span class="arby-tier arby-tier-empty">–</span>`;
      return `
          <div class="arby-next-row">
              <span class="arby-next-time" data-starts="${m.activation}">${escapeHTML(t.arbitration.startsIn)} ${rel}</span>
              <span class="arby-next-info">${escapeHTML(typeOf(m))} — ${escapeHTML(m.node)}</span>
              ${tier}
          </div>`;
    }).join("");

    box.style.display = "";
    box.innerHTML = `
        <div class="fissure-group arby-group" data-tier="arbitration">
            <button class="tier-header-btn" type="button">
                <span>${escapeHTML(t.arbitration.title)}</span> <span class="arrow-icon">▼</span>
            </button>
            <div class="tier-content">
                <div class="mission-item arby-current">
                    <div class="m-info">
                        <span class="m-type">${escapeHTML(typeOf(cur))} ${tierTag(cur, true)}</span>
                        <span class="m-node">${escapeHTML(cur.node)} · ${escapeHTML(cur.enemy)}</span>
                    </div>
                    <div class="m-timer-box">
                        <span class="m-eta" data-expiry="${cur.expiry}"></span>
                    </div>
                </div>
                ${upcomingRows ? `<div class="arby-next-title">${escapeHTML(t.arbitration.next)}</div>${upcomingRows}` : ""}
                <div class="arby-note">${escapeHTML(t.arbitration.tierNote)}</div>
            </div>
        </div>`;

    const group = box.querySelector(".arby-group");
    box.querySelector(".tier-header-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTierGroup(group);
    });
  } catch {
    box.style.display = "none";
  }
}

/**
 * Renders el listado de fisuras (grupos por tier) dentro de #fissures-list-area, usando las
 * fisuras ya filtradas por preferencias del usuario. No toca el header ni el panel de filtros,
 * así que se puede llamar tras un cambio de preferencias sin reconstruir todo el panel.
 */
async function renderMissionList() {
  const listArea = document.getElementById("fissures-list-area");
  if (!listArea) return;

  let allMissions = await fetchBestFissures();

  // No renderizar fisuras YA expiradas: el fetch puede venir del caché (2 min) o la API tardar
  // en retirarlas, y pintarlas con data-expiry en el pasado hacía que el countdown disparara
  // "expired → refresh" en bucle cada segundo (el refresh recibía la misma lista con la fisura
  // caducada dentro).
  allMissions = allMissions.filter(m => !m.expiry || (new Date(m.expiry) - (Date.now() - (globalThis._serverTimeOffset || 0))) > 0);

  // Las misiones de Railjack (isStorm) traen tier real (Lith/Meso/Neo/Axi): se agrupan en su
  // tier como las demás, distinguidas con la etiqueta "RJ" en la fila.
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

  listArea.innerHTML = "";

  tiersOrder.forEach((tierName) => {
    // fetchBestFissures ya aplica las preferencias del usuario (tipos, Omnia, Railjack):
    // aquí solo se agrupa por tier, sin volver a filtrar.
    const efficientMissions = tiersData[tierName];

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
