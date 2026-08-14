import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { fetchAllFissures } from "../../services/farms/fissures.service.js";
import {
  getFissureSetRecommendations,
  attachSetPrices,
  filterSetRecommendations,
  getSetRecsPrefs,
  saveSetRecsPrefs,
} from "../../services/inventory/set_recommendations.service.js";
import { getPartShortName } from "./ui_set_tracker.js";

// La última tanda pintada, para que los chips de filtro puedan repintar sin volver a pedir
// fisuras ni precios.
let _lastSetRecs = [];
let _setRecsLoaded = false;

const MAX_SET_RECS = 12;

function renderSetRecGuide(t) {
  const guideTitle = t.fissureSetRecs?.guideTitle || "¿Cómo funciona esto?";
  const guideText = t.fissureSetRecs?.guideText ||
    "Cruza las fisuras activas ahora mismo con los sets Prime que te faltan. Por cada pieza que te falta muestra: en qué fisura activa puede caer, los runs promedio esperados para conseguirla (radiante, 4 jugadores), y su precio de compra suelta en el mercado. Si comprarla sale claramente más barato que farmearla, aparece marcada.";

  return `
    <details class="set-rec-guide">
      <summary>${escapeHTML(guideTitle)}</summary>
      <p>${escapeHTML(guideText)}</p>
    </details>`;
}

function renderSetRecFilters(prefs, t) {
  const maxMissingLabel = t.fissureSetRecs?.maxMissing || "Máx. piezas restantes";
  const buyOnlyLabel = t.fissureSetRecs?.buyOnlyFilter || "Solo donde sale a cuenta comprar";
  const anyLabel = t.fissureSetRecs?.anyMissing || "Cualquiera";
  const filtersTitle = t.fissureSetRecs?.filtersTitle || "Filtros";
  const maxMissingHelp = t.fissureSetRecs?.maxMissingHelp ||
    "Muestra solo sets a los que les falten como mucho esas piezas. Útil para centrarte en los que casi tienes terminados.";
  const buyOnlyHelp = t.fissureSetRecs?.buyOnlyHelp ||
    "Deja solo las piezas cuyo precio en el mercado es más barato que el coste estimado de farmearlas.";
  const moreMissionsHint = t.fissureSetRecs?.moreMissionsHint ||
    "¿Faltan misiones? Los tipos de misión que ves aquí dependen de tus filtros de fisuras. Ábrelos en el panel de Fisuras → Filtros para añadir más.";

  return `
    <div class="set-rec-filters">
      <span class="set-rec-filters-title">${escapeHTML(filtersTitle)}</span>

      <div class="set-rec-filter-row">
        <label class="set-rec-filter-label" for="set-rec-filter-missing">${escapeHTML(maxMissingLabel)}</label>
        <select id="set-rec-filter-missing" class="alarm-select" aria-describedby="set-rec-filter-missing-help">
          <option value="0" ${prefs.maxMissing === 0 ? "selected" : ""}>${escapeHTML(anyLabel)}</option>
          <option value="1" ${prefs.maxMissing === 1 ? "selected" : ""}>1</option>
          <option value="2" ${prefs.maxMissing === 2 ? "selected" : ""}>&le; 2</option>
          <option value="3" ${prefs.maxMissing === 3 ? "selected" : ""}>&le; 3</option>
        </select>
        <small class="set-rec-filter-help" id="set-rec-filter-missing-help">${escapeHTML(maxMissingHelp)}</small>
      </div>

      <div class="set-rec-filter-row">
        <label class="lfg-checkbox-wrapper">
          <input type="checkbox" id="set-rec-filter-buy" ${prefs.buyOnly ? "checked" : ""}
                 aria-describedby="set-rec-filter-buy-help">
          <span class="lfg-label">${escapeHTML(buyOnlyLabel)}</span>
        </label>
        <small class="set-rec-filter-help" id="set-rec-filter-buy-help">${escapeHTML(buyOnlyHelp)}</small>
      </div>

      <p class="set-rec-more-missions">${escapeHTML(moreMissionsHint)}</p>
    </div>`;
}

function renderSetRecCards(recs, t) {
  const missingLabel = t.fissureSetRecs?.missing || "faltan";
  const runsLabel = t.fissureSetRecs?.runsShort || "runs";
  const buyBadgeLabel = t.fissureSetRecs?.buyBadge || "Sale más a cuenta comprarla";
  const buyPriceLabel = t.fissureSetRecs?.buyPrice || "Comprar";
  const emptyLabel = t.fissureSetRecs?.emptyFiltered || "Ningún set coincide con estos filtros.";

  if (recs.length === 0) {
    return `<div class="set-rec-empty">${escapeHTML(emptyLabel)}</div>`;
  }

  return recs.map((rec) => {
    const platText = rec.setPricePlat > 0 ? ` · ${Math.round(rec.setPricePlat)}p` : "";
    const partsHtml = rec.matches.map((m) => {
      const shortName = escapeHTML(getPartShortName(m.part, rec.setName));
      const nodesHtml = m.fissures.slice(0, 3).map((f) => {
        const typeLabel = t.modes[f.type.toLowerCase()] || f.type;
        return `<span class="set-rec-node" data-expiry="${f.expiry}">${escapeHTML(f.node)} <em>(${escapeHTML(typeLabel)})</em></span>`;
      }).join("");
      const runsText = Number.isFinite(m.avgRuns) ? `~${m.avgRuns.toFixed(1)} ${runsLabel}` : "";
      const buyText = m.buyPricePlat > 0 ? `${buyPriceLabel}: ${Math.round(m.buyPricePlat)}p` : "";
      const buyBadge = m.betterToBuy ? `<span class="set-rec-buy-badge">${escapeHTML(buyBadgeLabel)}</span>` : "";
      return `
        <div class="set-rec-part">
          <div class="set-rec-part-top">
            <span class="set-rec-part-name">${shortName}</span>
            <span class="set-rec-part-stats">${escapeHTML(runsText)}${buyText ? ` · ${escapeHTML(buyText)}` : ""}</span>
            ${buyBadge}
          </div>
          <div class="set-rec-nodes">${nodesHtml}</div>
        </div>`;
    }).join("");

    return `
      <div class="set-rec-card">
        <div class="set-rec-header">
          <span class="set-rec-name">${escapeHTML(rec.setName)}</span>
          <span class="set-rec-meta">${rec.missingCount}/${rec.totalParts} ${escapeHTML(missingLabel)}${platText}</span>
        </div>
        ${partsHtml}
      </div>`;
  }).join("");
}

function bindSetRecFilterListeners(container, t) {
  const missingSelect = document.getElementById("set-rec-filter-missing");
  const buyCheckbox = document.getElementById("set-rec-filter-buy");
  const cardsArea = document.getElementById("fissure-set-recs-cards");

  const applyAndRerender = () => {
    const prefs = {
      maxMissing: parseInt(missingSelect?.value, 10) || 0,
      buyOnly: !!buyCheckbox?.checked,
    };
    saveSetRecsPrefs(prefs);
    if (cardsArea) {
      cardsArea.innerHTML = renderSetRecCards(filterSetRecommendations(_lastSetRecs, prefs), t);
    }
  };

  missingSelect?.addEventListener("change", applyAndRerender);
  buyCheckbox?.addEventListener("change", applyAndRerender);

  const toggleBtn = document.getElementById("fissure-set-recs-toggle");
  toggleBtn?.addEventListener("click", () => container.classList.toggle("collapsed"));
}

/**
 * Pinta el bloque "Fisuras para tus sets" en la pestaña Set (#fissure-set-recs, ver index.html).
 * Se llama al entrar en la pestaña y tras cada cambio de inventario/reliquias relevante.
 * No repite el fetch de fisuras si ya se cargaron en esta sesión de la pestaña — usa
 * fetchAllFissures (cache en memoria de 2 min de fissures.service.js).
 */
export async function renderFissureSetRecommendations() {
  const container = document.getElementById("fissure-set-recs");
  if (!container) return;
  if (!state.setsDatabase || !state.itemsDatabase) return;

  _setRecsLoaded = true;
  const t = TEXTS[state.currentLang];
  const activeMissions = await fetchAllFissures();

  const recs = getFissureSetRecommendations(activeMissions).slice(0, MAX_SET_RECS);

  if (recs.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    _lastSetRecs = [];
    return;
  }

  await attachSetPrices(recs);
  _lastSetRecs = recs;

  const title = t.fissureSetRecs?.title || "Fisuras para tus sets";
  const prefs = getSetRecsPrefs();
  const filtered = filterSetRecommendations(recs, prefs);

  container.innerHTML = `
    <button type="button" class="tier-header-btn fissure-set-recs-toggle" id="fissure-set-recs-toggle">
      <span>${escapeHTML(title)} (${recs.length})</span> <span class="arrow-icon">▼</span>
    </button>
    <div class="fissure-set-recs-content">
      ${renderSetRecGuide(t)}
      ${renderSetRecFilters(prefs, t)}
      <div id="fissure-set-recs-cards">${renderSetRecCards(filtered, t)}</div>
    </div>
  `;
  container.style.display = "block";

  bindSetRecFilterListeners(container, t);
}
