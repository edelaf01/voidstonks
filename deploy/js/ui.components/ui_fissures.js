import { state } from "../state.js";
import { TEXTS } from "../config.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;
import {
  fetchBestFissures,
  fetchAllFissures,
  fetchArbitration,
  fetchActiveArbitration,
  getFissurePrefs,
  saveFissurePrefs,
  getObservedMissionTypes,
  DEFAULT_MISSION_TYPES,
  RAILJACK_MISSION_TYPES,
} from "../services/fissures.service.js";
import {
  getAlarmPrefs,
  saveAlarmPrefs,
  addAlarmRule,
  removeAlarmRule,
  startAlarmWatcher,
  sendBrowserNotification,
  ARBY_TIER_ORDER,
} from "../services/alerts.service.js";
import { escapeHTML, showToast } from "./ui_components.js";

let fissureLoadPromise = null;

// Tipos de misión que el usuario puede activar/desactivar, agrupados como los agrupa el juego:
// velocidad (objetivo único), continuas (una reliquia por rotación) y Omnia (Lua/Zariman/Deimos,
// admiten cualquier reliquia clásica). Excluidos a propósito porque DE nunca los rota como
// fisura: Asesinato, Deserción, Salvamento Infestado, Índice y Arena.
// La lista NO es la fuente de verdad: renderFissureFiltersPanel la fusiona con los tipos
// realmente presentes en los datos, así un tipo nuevo sigue siendo filtrable sin tocar código.
const AVAILABLE_MISSION_TYPES = [
  // Velocidad (objetivo único)
  "Capture",
  "Extermination",
  "Rescue",
  "Sabotage",
  "Spy",
  "Mobile Defense",
  "Assault", // solo Fortaleza Kuva
  // Continuas (consumen reliquia por rotación)
  "Survival",
  "Defense",
  "Interception",
  "Excavation",
  "Disruption",
  // Omnia (admiten cualquier reliquia clásica)
  "Void Cascade",
  "Void Flood",
  "Alchemy",
  "Conjunction Survival",
];

// Tipos de misión que rotan en Arbitración (endless). "Dark Sector X" cuenta como X
// en el matcher, así que no hace falta listarlos.
const ARBY_MISSION_TYPES = [
  "Defense",
  "Survival",
  "Interception",
  "Excavation",
  "Disruption",
  "Defection",
  "Infested Salvage",
  "Alchemy",
];

// Localizaciones donde pueden aparecer fisuras (el planeta se extrae del nodo, p.ej.
// "Kiliken (Venus)"). "Veil" es la Proxima del Velo, exclusiva de Railjack.
const FISSURE_PLANETS = [
  "Earth", "Venus", "Mercury", "Mars", "Phobos", "Deimos", "Ceres", "Jupiter",
  "Europa", "Saturn", "Uranus", "Neptune", "Pluto", "Sedna", "Eris",
  "Void", "Lua", "Kuva Fortress", "Zariman", "Veil",
];

const FISSURE_TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];

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
                    <span class="m-type-name">${escapeHTML(translatedType)}</span>
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

// Lista fija + lo que traen los datos ahora mismo: un tipo que DE añada aparece como casilla
// en cuanto sale en una fisura, sin esperar a tocar el código.
function mergeWithObserved(baseList, observed) {
  return [...new Set([...baseList, ...observed])].sort((a, b) => a.localeCompare(b));
}

// Actualiza los textos del shell (header, botón de filtros, contenido del panel de filtros)
// sin reconstruir la estructura estática completa. Se llama en cada refreshing de initFissurePanel
// para que cambios de idioma/tipos observados se reflejen sin causar parpadeo del shell.
function updateFissurePanelTexts() {
  const t = TEXTS[state.currentLang];

  const headerSpan = document.querySelector("#fissure-panel-header span");
  if (headerSpan) {
    headerSpan.textContent = t.lblRecommended || "Fisuras Activas";
  }

  // Solo el texto: el botón lleva además un icono como hermano, y escribir sobre el
  // botón entero (textContent) lo borraba al cambiar de idioma.
  const filtersToggleText = document.querySelector("#fissure-filters-toggle .fissure-filters-text");
  if (filtersToggleText) {
    filtersToggleText.textContent = t.fissurePrefs.toggle;
  }

  const fPanel = document.getElementById("fissure-filters-panel");
  if (fPanel && !fPanel.contains(document.activeElement)) {
    fPanel.innerHTML = renderFissureFiltersPanel(getFissurePrefs());
  }
}



function renderFissureFiltersPanel(prefs) {
  const t = TEXTS[state.currentLang];
  const observed = getObservedMissionTypes();

  const typeCheckboxes = mergeWithObserved(AVAILABLE_MISSION_TYPES, observed.normal).map((type) => {
    const label = t.modes[type.toLowerCase()] || type;
    const checked = prefs.missionTypes.includes(type) ? "checked" : "";
    return `
        <label class="lfg-checkbox-wrapper">
            <input type="checkbox" class="fissure-pref-type" value="${escapeHTML(type)}" ${checked}>
            <span class="lfg-label">${escapeHTML(label)}</span>
        </label>`;
  }).join("");

  const rjTypeCheckboxes = mergeWithObserved(RAILJACK_MISSION_TYPES, observed.railjack).map((type) => {
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
        <div class="fissure-filters-section fissure-alarm-section">
            <span class="fissure-filters-title">🔔 ${escapeHTML(t.fissureAlarms.title)}</span>
            <div class="alarm-builder">
                <select id="fissure-alarm-tier" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.tier)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.anyTier)}</option>
                    ${FISSURE_TIERS.map((tier) => `<option value="${tier}">${tier}</option>`).join("")}
                </select>
                <select id="fissure-alarm-type" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.missionType)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.anyType)}</option>
                    ${[...new Set([...AVAILABLE_MISSION_TYPES, ...RAILJACK_MISSION_TYPES])].map(
                      (type) => `<option value="${escapeHTML(type)}">${escapeHTML(t.modes[type.toLowerCase()] || type)}</option>`,
                    ).join("")}
                </select>
                <select id="fissure-alarm-planet" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.planet)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.anyPlanet)}</option>
                    ${FISSURE_PLANETS.map((p) => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join("")}
                </select>
                <select id="fissure-alarm-source" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.source)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.srcAny)}</option>
                    <option value="normal">${escapeHTML(t.fissureAlarms.srcNormal)}</option>
                    <option value="railjack">${escapeHTML(t.fissureAlarms.srcRailjack)}</option>
                </select>
                <select id="fissure-alarm-sp" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.spLabel)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.spAny)}</option>
                    <option value="sp">${escapeHTML(t.fissureAlarms.spOnly)}</option>
                    <option value="normal">${escapeHTML(t.fissureAlarms.spNo)}</option>
                </select>
                <button type="button" class="dashed-btn alarm-add-btn" id="fissure-alarm-add">+ ${escapeHTML(t.fissureAlarms.addRule)}</button>
            </div>
            <span class="fissure-filters-title">🔔 ${escapeHTML(t.arbyAlarms.title)}</span>
            <div class="alarm-builder">
                <select id="arby-alarm-tier" class="alarm-select" aria-label="${escapeHTML(t.arbyAlarms.minTier)}">
                    <option value="any">${escapeHTML(t.arbyAlarms.anyTier)}</option>
                    ${[...ARBY_TIER_ORDER].reverse().map((tier) => `<option value="${tier}">${escapeHTML(t.arbyAlarms.tierAtLeast)} ${tier}</option>`).join("")}
                </select>
                <select id="arby-alarm-type" class="alarm-select" aria-label="${escapeHTML(t.fissureAlarms.missionType)}">
                    <option value="any">${escapeHTML(t.fissureAlarms.anyType)}</option>
                    ${ARBY_MISSION_TYPES.map(
                      (type) => `<option value="${escapeHTML(type)}">${escapeHTML(t.modes[type.toLowerCase()] || type)}</option>`,
                    ).join("")}
                </select>
                <button type="button" class="dashed-btn alarm-add-btn" id="arby-alarm-add">+ ${escapeHTML(t.fissureAlarms.addRule)}</button>
            </div>
            <div class="alarm-rules-list" id="fissure-alarm-rules">${renderFissureAlarmRules(t)}</div>
        </div>
        <button type="button" class="fissure-filters-reset" id="fissure-filters-reset">${escapeHTML(t.fissurePrefs.reset)}</button>
    `;
}

// Lista de reglas de alarma de fisuras + arbitración (las de bounty viven en Farms).
function renderFissureAlarmRules(t) {
  const rules = getAlarmPrefs().rules.filter((r) => r.kind === "fissure" || r.kind === "arbitration");
  if (rules.length === 0) {
    return `<div class="alarm-no-rules">${escapeHTML(t.fissureAlarms.noRules)}</div>`;
  }
  return rules.map((r) => {
    let parts;
    let dotColor;
    if (r.kind === "arbitration") {
      dotColor = "#ffb86c";
      parts = [
        t.arbyAlarms.tag,
        (r.minTier || "any") === "any" ? t.arbyAlarms.anyTier : `${t.arbyAlarms.tierAtLeast} ${r.minTier}`,
        (r.type || "any") === "any" ? t.fissureAlarms.anyType : (t.modes[r.type.toLowerCase()] || r.type),
      ];
    } else {
      dotColor = "#8be9fd";
      parts = [
        (r.tier || "any") === "any" ? t.fissureAlarms.anyTier : r.tier,
        (r.type || "any") === "any" ? t.fissureAlarms.anyType : (t.modes[r.type.toLowerCase()] || r.type),
        (r.planet || "any") === "any" ? t.fissureAlarms.anyPlanet : r.planet,
      ];
      const source = r.source || "any";
      if (source !== "any") parts.push(source === "railjack" ? "RJ" : t.fissureAlarms.srcNormal);
      const sp = r.sp || "any";
      if (sp !== "any") parts.push(sp === "sp" ? "SP" : t.fissureAlarms.spNo);
    }
    return `
        <div class="alarm-rule" data-rule-id="${escapeHTML(r.id)}">
            <span class="alarm-rule-dot" style="background:${dotColor};"></span>
            <span class="alarm-rule-desc">${escapeHTML(parts.join(" · "))}</span>
            <button type="button" class="alarm-rule-del" title="${escapeHTML(t.fissureAlarms.delete)}">×</button>
        </div>`;
  }).join("");
}

// Toast + notificación nativa cuando saltan alarmas de fisuras. El sonido ya lo
// emite evaluateAlarms según la preferencia global.
function handleFissureAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.slice(0, 4).map(({ item }) => {
    const typeTxt = t.modes[(item.type || "").toLowerCase()] || item.type;
    return `${item.tier} · ${typeTxt} — ${item.node}${item.isStorm ? " (RJ)" : ""}${item.isSP ? " [SP]" : ""}`;
  });
  const more = hits.length > 4 ? ` +${hits.length - 4}` : "";
  sendBrowserNotification(t.fissureAlarms.firedTitle, lines.join("\n") + more);
  showToast(`<b>${escapeHTML(t.fissureAlarms.firedTitle)}</b><br>${lines.map(escapeHTML).join("<br>")}${more}`, {
    tag: "fissure-alarm",
    type: "success",
    duration: 30000,
    html: true, // el mensaje monta <b>/<br> y ya escapa cada dato que interpola
  });
}

function startFissureAlarmWatcher() {
  startAlarmWatcher(() => fetchAllFissures(), handleFissureAlarmHits, "fissure");
}

// Toast + notificación cuando salta una alarma de arbitración.
function handleArbitrationAlarmHits(hits) {
  const t = TEXTS[state.currentLang];
  if (!hits || hits.length === 0) return;
  const lines = hits.map(({ item }) => {
    const typeTxt = t.modes[(item.type || "").toLowerCase()] || item.type;
    return `${item.tier ? `[${item.tier}] ` : ""}${typeTxt} — ${item.node}`;
  });
  sendBrowserNotification(t.arbyAlarms.firedTitle, lines.join("\n"));
  showToast(`<b>${escapeHTML(t.arbyAlarms.firedTitle)}</b><br>${lines.map(escapeHTML).join("<br>")}`, {
    tag: "arby-alarm",
    type: "success",
    duration: 30000,
    html: true, // el mensaje monta <b>/<br> y ya escapa cada dato que interpola
  });
}

function startArbitrationAlarmWatcher() {
  startAlarmWatcher(() => fetchActiveArbitration(), handleArbitrationAlarmHits, "arbitration");
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

// Construye el shell estático del panel (header, toggle, filters bar, contenedores vacíos para datos).
// Se ejecuta solo si #best-missions-container no existe aún o no está completamente construido.
// Marca missionDiv.dataset.shellBuilt = "1" al terminar para evitar reconstrucciones posteriores.
function buildFissurePanelShell(missionDiv) {
  const t = TEXTS[state.currentLang];
  const fissurePrefs = getFissurePrefs();

  if (!missionDiv) {
    missionDiv = document.createElement("div");
    missionDiv.id = "best-missions-container";
    document.body.appendChild(missionDiv);
  }

  // Construir el HTML estático del shell (solo una vez)
  missionDiv.innerHTML = `
      <div id="mission-toggle-btn" class="mission-toggle-btn">
         <img src="assets/fissureicon.webp" class="toggle-img" alt="Fisuras">
      </div>

      <div class="panel-main-header" id="fissure-panel-header" style="cursor:pointer;">
          <svg class="gauss-icon" id="gauss-runner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5,5.5 C18.5,5.5 14,8 12,10 C10,12 5,11 2,12 C5,13 9,14 11,16 C13,18 16,19 18.5,19 C16,17 14,14 14,12 C14,10 16,7 18.5,5.5 Z M22,2 L20,4 C20,4 17,7 17,12 C17,17 20,20 20,20 L22,22" fill="currentColor"/>
          </svg>
          <span>${t.lblRecommended || "Fisuras Activas"}</span>
      </div>

      <div class="fissure-filters-bar">
          <button type="button" class="fissure-filters-toggle" id="fissure-filters-toggle" aria-expanded="false">
            <span class="fissure-filters-icon">⚙</span>
            <span class="fissure-filters-text">${escapeHTML(t.fissurePrefs.toggle)}</span>
          </button>
      </div>
      <div class="fissure-filters-panel collapsed" id="fissure-filters-panel">
          ${renderFissureFiltersPanel(fissurePrefs)}
      </div>

      <div class="fissure-arby-bar" id="fissure-arby-bar" style="display:none;"></div>

      <div class="fissures-scroll-area" id="fissures-list-area">
         <div class="fissure-loading"><div class="spinner"></div><span>${escapeHTML(t.fissurePrefs.loading)}</span></div>
      </div>
    `;

  // Atar listeners al shell (solo una vez)
  const header = document.getElementById("fissure-panel-header");
  const runner = document.getElementById("gauss-runner");
  const toggleBtn = document.getElementById("mission-toggle-btn");

  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = document.getElementById("best-missions-container");
      if (panel) {
        const isOpening = !panel.classList.contains("open");
        panel.classList.toggle("open");
        if (isOpening) {
           // Forzamos refetch al abrir para asegurar que no se quede atascado con una lista vacía
           renderMissionList(true);
           renderArbitrationBar();
        }
      }
    });
  }

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
    header.addEventListener("click", () => initFissurePanel(true));
  }

  const filtersToggleBtn = document.getElementById("fissure-filters-toggle");
  const filtersPanel = document.getElementById("fissure-filters-panel");
  if (filtersToggleBtn && filtersPanel) {
    filtersToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !filtersPanel.classList.toggle("collapsed");
      filtersToggleBtn.classList.toggle("open", open);
      filtersToggleBtn.setAttribute("aria-expanded", String(open));
    });
    // Evita que un click dentro del panel de filtros colapse/re-cargue el panel principal.
    filtersPanel.addEventListener("click", (e) => e.stopPropagation());

    // Alarmas de fisuras: alta y borrado por delegación (la lista se re-renderiza entera,
    // así los handlers sobreviven sin re-bindear).
    filtersPanel.addEventListener("click", (e) => {
      const tt = TEXTS[state.currentLang];
      const rulesBox = document.getElementById("fissure-alarm-rules");

      if (e.target.id === "fissure-alarm-add") {
        const added = addAlarmRule({
          kind: "fissure",
          tier: document.getElementById("fissure-alarm-tier")?.value || "any",
          type: document.getElementById("fissure-alarm-type")?.value || "any",
          planet: document.getElementById("fissure-alarm-planet")?.value || "any",
          source: document.getElementById("fissure-alarm-source")?.value || "any",
          sp: document.getElementById("fissure-alarm-sp")?.value || "any",
        });
        if (!added) {
          showToast(tt.fissureAlarms.dupRule, { tag: "fissure-alarm-dup", duration: 4000 });
          return;
        }
        // Como en bounties: crear la primera regla enciende el master para evitar
        // "configuré la alarma pero no salta".
        const prefs = getAlarmPrefs();
        if (!prefs.enabled) {
          prefs.enabled = true;
          saveAlarmPrefs(prefs);
        }
        startFissureAlarmWatcher();
        if (rulesBox) rulesBox.innerHTML = renderFissureAlarmRules(tt);
        return;
      }

      if (e.target.id === "arby-alarm-add") {
        const added = addAlarmRule({
          kind: "arbitration",
          minTier: document.getElementById("arby-alarm-tier")?.value || "any",
          type: document.getElementById("arby-alarm-type")?.value || "any",
        });
        if (!added) {
          showToast(tt.fissureAlarms.dupRule, { tag: "fissure-alarm-dup", duration: 4000 });
          return;
        }
        const prefs = getAlarmPrefs();
        if (!prefs.enabled) {
          prefs.enabled = true;
          saveAlarmPrefs(prefs);
        }
        startArbitrationAlarmWatcher();
        if (rulesBox) rulesBox.innerHTML = renderFissureAlarmRules(tt);
        return;
      }

      const delBtn = e.target.closest(".alarm-rule-del");
      if (delBtn && delBtn.closest("#fissure-alarm-rules")) {
        const id = delBtn.closest(".alarm-rule")?.dataset.ruleId;
        if (id) removeAlarmRule(id);
        if (rulesBox) rulesBox.innerHTML = renderFissureAlarmRules(tt);
      }
    });
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

  // Armar intervalos globales de actualización (solo una vez)
  if (!globalThis._fissureRefreshInterval) {
    globalThis._fissureRefreshInterval = setInterval(() => {
      const panel = document.getElementById("best-missions-container");
      const hasMissions = document.querySelectorAll(".mission-item").length > 0;
      // Solo refresca si el panel está abierto, o si la lista se vació (para recuperarse de un worldstate lento)
      if (panel?.classList.contains("open") || !hasMissions) {
        console.log("[FISSURES]: Auto-refreshing missions...");
        initFissurePanel(true);
      }
    }, 150 * 1000); // 2.5 min (la cache en memoria de 2 min garantiza datos frescos sin spam)
  }

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
          el.textContent = TEXTS[state.currentLang].fissurePrefs.expired;
          el.classList.add("expired");
          expiredFound = true;
          // Ocultar la fisura para que no se quede atascada mostrando 'Expirado' durante el cooldown
          const row = el.closest(".mission-item");
          if (row) setTimeout(() => row.style.display = "none", 1000);
        } else {
          const totalSecs = Math.floor(diffMs / 1000);
          const hrs = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;

          // Bajo 5 min ya no da tiempo a entrar con margen: se resalta para poder
          // descartarla de un vistazo sin leer el número.
          el.classList.toggle("urgent", diffMs < 300000);

          if (hrs > 0) {
            el.textContent = `${hrs}h ${mins}m ${secs}s`;
          } else if (mins > 0) {
            el.textContent = `${mins}m ${secs}s`;
          } else {
            el.textContent = `${secs}s`;
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
        if (!globalThis._fissureRefreshPending) {
          globalThis._fissureRefreshPending = true;
          console.log("[FISSURES]: Fissure expired, waiting 65s for API cache to clear before refreshing...");
          setTimeout(() => {
            globalThis._fissureRefreshPending = false;
            initFissurePanel(true);
          }, 65000);
        }
      }
    }, 1000);
  }

  // Marcar el shell como construido para evitar reconstrucciones futuras
  missionDiv.dataset.shellBuilt = "1";
  return missionDiv;
}

export async function initFissurePanel(forceRefetch = false) {
  let missionDiv = document.getElementById("best-missions-container");

  // Solo construir el shell si no existe o no está completamente construido (primera vez)
  if (!missionDiv || !missionDiv.dataset.shellBuilt) {
    missionDiv = buildFissurePanelShell(missionDiv);
  }

  // Actualizar datos (siempre, en cada llamada)
  await renderMissionList(forceRefetch);
  renderArbitrationBar();

  // Actualizar textos y contenido dinámico del panel (siempre)
  updateFissurePanelTexts();

  // Reanuda los watchers de alarmas al cargar si el usuario ya tenía reglas.
  const alarmPrefs = getAlarmPrefs();
  if (alarmPrefs.enabled && alarmPrefs.rules.some((r) => r.kind === "fissure")) {
    startFissureAlarmWatcher();
  }
  if (alarmPrefs.enabled && alarmPrefs.rules.some((r) => r.kind === "arbitration")) {
    startArbitrationAlarmWatcher();
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
    const arby = await fetchArbitration(true);
    let cur = arby?.current;
    let upcoming = arby?.upcoming || [];
    const syncedNow = new Date(Date.now() - (globalThis._serverTimeOffset || 0));

    if (cur && new Date(cur.expiry) <= syncedNow) {
      const activeIdx = upcoming.findIndex(m => new Date(m.activation) <= syncedNow && new Date(m.expiry) > syncedNow);
      if (activeIdx !== -1) {
        cur = upcoming[activeIdx];
        upcoming = upcoming.slice(activeIdx + 1);
      } else {
        cur = null;
      }
    }

    if (!cur || new Date(cur.expiry) <= syncedNow) {
      box.style.display = "none";
      return;
    }
    const t = TEXTS[state.currentLang];
    const typeOf = (m) => t.modes[(m.type || "").toLowerCase()] || m.type || "";
    const tierTag = (m, big) => m.tier
      ? `<span class="arby-tier${big ? " big" : ""}" data-tooltip="${escapeHTML(t.arbitration.tierTooltip)}">${escapeHTML(m.tier)}</span>`
      : "";

    // Tiempo relativo hasta una activación: no depende de la zona horaria del cliente.
    const relTo = (activation) => {
      const diffMins = Math.max(0, Math.round((new Date(activation) - (Date.now() - (globalThis._serverTimeOffset || 0))) / 60000));
      return diffMins >= 60
        ? `${Math.floor(diffMins / 60)}h ${String(diffMins % 60).padStart(2, "0")}m`
        : `${diffMins}m`;
    };

    // Próxima rotación tier S dentro de la ventana del parser (~12h). El span usa
    // .arby-next-time[data-starts], así el tick global lo mantiene actualizado solo.
    let nextSLine;
    if ((cur.tier || "").toUpperCase() === "S") {
      nextSLine = `<div class="arby-next-s">⭐ ${escapeHTML(t.arbitration.sActiveNow)}</div>`;
    } else {
      const nextS = upcoming.find((m) => (m.tier || "").toUpperCase() === "S" && new Date(m.activation) > syncedNow);
      nextSLine = nextS
        ? `<div class="arby-next-s">⭐ ${escapeHTML(t.arbitration.nextS)}: ${escapeHTML(typeOf(nextS))} — ${escapeHTML(nextS.node)} · <span class="arby-next-time" data-starts="${nextS.activation}">${escapeHTML(t.arbitration.startsIn)} ${relTo(nextS.activation)}</span></div>`
        : `<div class="arby-next-s arby-next-s-none">${escapeHTML(t.arbitration.noNextS)}</div>`;
    }

    const upcomingRows = upcoming.slice(0, 3).map((m) => {
      const rel = relTo(m.activation);
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
                ${nextSLine}
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
async function renderMissionList(forceRefetch = false) {
  const listArea = document.getElementById("fissures-list-area");
  if (!listArea) return;

  const t = TEXTS[state.currentLang];
  let allMissions = await fetchBestFissures(forceRefetch);
  const syncedNow = Date.now() - (globalThis._serverTimeOffset || 0);

  let validMissions = allMissions.filter(m => !m.expiry || (new Date(m.expiry) - syncedNow) > 0);

  // Si tras filtrar quedan vacías y no habíamos forzado, forzamos para intentar recuperar
  if (validMissions.length === 0 && !forceRefetch) {
      allMissions = await fetchBestFissures(true);
      validMissions = allMissions.filter(m => !m.expiry || (new Date(m.expiry) - syncedNow) > 0);
  }

  allMissions = validMissions;

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
    // is-empty apaga el grupo entero: sin fisuras del tier no hay nada que abrir, y
    // manteniéndolos a plena intensidad la lista parecía llena cuando no lo estaba.
    groupDiv.className = `fissure-group collapsed${efficientMissions.length === 0 ? " is-empty" : ""}`;
    groupDiv.id = `group-${tierName.toLowerCase()}`;
    groupDiv.dataset.tier = tierName.toLowerCase();

    const headerBtn = document.createElement("button");
    headerBtn.className = "tier-header-btn";
    headerBtn.type = "button";
    headerBtn.innerHTML =
      `<span class="tier-name">${tierName}</span>` +
      `<span class="tier-count">${efficientMissions.length}</span>` +
      `<span class="arrow-icon">▼</span>`;
    headerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTierGroup(groupDiv);
    });

    const contentDiv = document.createElement("div");
    contentDiv.className = "tier-content";

    if (efficientMissions.length === 0) {
      contentDiv.innerHTML = `
            <div class="no-fissures-msg">
                <span class="warning-icon">⚠</span> ${escapeHTML(t.fissurePrefs.noneInTier)}
            </div>
        `;
    } else {
      let html = "";
      const normal = efficientMissions.filter((m) => !m.isSP);
      const sp = efficientMissions.filter((m) => m.isSP);

      // El separador solo se pinta si hay ambos grupos: con un único path la etiqueta
      // no distingue nada y solo roba altura en un panel que ya va justo de alto.
      const needSep = normal.length > 0 && sp.length > 0;
      if (normal.length > 0) {
        if (needSep) html += `<div class="path-sep">${escapeHTML(t.fissurePrefs.pathNormal)}</div>`;
        normal.forEach((m) => (html += renderMissionRow(m)));
      }
      if (sp.length > 0) {
        if (needSep) html += `<div class="path-sep is-sp">${escapeHTML(t.fissurePrefs.pathSteel)}</div>`;
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
