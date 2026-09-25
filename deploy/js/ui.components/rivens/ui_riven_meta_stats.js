import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getRivenTooltip, getRivenMetricName } from "../../utils/rivens/riven_tooltips.js";
import { getLocalizedStatName, CANT_BE_NEGATIVE } from "../../utils/rivens/riven_stat_display.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";
import { nivelVolatilidad, etiquetaVolatilidad, textoExtraPorCiclar } from "../../utils/rivens/riven_metrics.js";
import { tablaCicloHtml } from "./ui_riven_cycling.js";
import {
  calculateHybridTiers,
  gradeWeaponStats,
  STAT_TIER_TOP,
  STAT_TIER_MID,
} from "../../utils/rivens/riven_logic.js";
import { getMetaStats } from "../../services/rivens/riven_market.service.js?v=1.9";
import {
  metaConPesosDeFamilia,
  pesosFinosDeArma,
  statsSinDatoPropio,
  isStatAllowedForWeaponType,
} from "../../services/rivens/riven_weights.service.js";
import { renderCuriosidadesArma } from "./ui_riven_curiosidades.js";

export function renderMetaStats(weaponName, weaponType, targetId = "meta-stats-container") {
  const container = document.getElementById(targetId);
  if (!container) return;

  const metaRaw = getMetaStats(weaponName, weaponType);
  if (!metaRaw) {
    container.style.display = "none";
    return;
  }
  const meta = metaConPesosDeFamilia(metaRaw, weaponName);
  renderCuriosidadesArma(weaponName);

  const _typeStr = String(weaponType || meta.t || "").toLowerCase();
  const _isMeleeType = _typeStr.includes("melee") || _typeStr.includes("zaw") || _typeStr.includes("glaive");
  const _grado = gradeWeaponStats(meta,
    state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);
  if (_grado && _grado.best.length) {
    meta.pos = _grado.best;
    meta.midPos = _grado.mid;
    meta._genericRecs = _grado.fuente !== "arma";
  } else if (!(meta.pos && meta.pos.length) && !(meta.midPos && meta.midPos.length)) {
    meta.pos = _isMeleeType
      ? ["Critical Damage", "Critical Chance", "Fire Rate / Attack Speed",
        "Base Damage / Melee Damage", "Range"]
      : ["Critical Damage", "Multishot", "Critical Chance", "Base Damage / Melee Damage"];
    meta.midPos = _isMeleeType
      ? ["Electric Damage"]
      : ["Toxin Damage", "Fire Rate / Attack Speed"];
    meta._genericRecs = true;
  }
  if (!(meta.neg && meta.neg.length)) {
    meta.neg = _isMeleeType
      ? ["Finisher Damage", "Heavy Attack Efficiency", "Combo Duration"]
      : ["Zoom", "Recoil", "Ammo Maximum"];
    meta._genericRecs = true;
  }

  const _finos = state.rivenStatWeights ? "f" : "nf";
  const _fam = extractFamilyName(String(weaponName || "")) || weaponName;
  const cacheKey = `${_fam}_${weaponType}_${state.currentLang}_${meta._genericRecs ? "gen" : "real"}_${_finos}`;
  if (container.dataset.lastRenderedKey === cacheKey) return;

  const isEs = state.currentLang === "es";

  const getWeightText = (stat, fallbackVal) => {
    if (meta.dynamic_weights && meta.dynamic_weights[stat] !== undefined) {
      return ` (${Number(meta.dynamic_weights[stat]).toFixed(2)})`;
    }
    return fallbackVal !== undefined ? ` (${fallbackVal.toFixed(2)})` : "";
  };

  const _sinDato = statsSinDatoPropio(weaponName);
  const _tipoOk = (s) => isStatAllowedForWeaponType(s, weaponType);
  const _bestConDato = (meta.pos || []).filter(s => _tipoOk(s) && !_sinDato.has(String(s).toLowerCase()));
  const _ocultarSinDato = _bestConDato.length > 0;
  const allow = (s) => _tipoOk(s)
    && !(_ocultarSinDato && _sinDato.has(String(s).toLowerCase()));
  const _sinDatoNeg = statsSinDatoPropio(weaponName, "neg");
  const _ocultarSinDatoNeg = _sinDatoNeg.size > 0
    && (meta.neg || []).some(s => _tipoOk(s) && !_sinDatoNeg.has(String(s).toLowerCase()));
  const allowNeg = (s) => _tipoOk(s)
    && !(_ocultarSinDatoNeg && _sinDatoNeg.has(String(s).toLowerCase()));

  const _pesosPos = pesosFinosDeArma(weaponName, "pos") || meta.dynamic_weights || {};
  const _pesosNeg = pesosFinosDeArma(weaponName, "neg") || {};
  const _destacar = (lista, pesos, filtro = allow) => {
    const conPeso = (lista || []).filter(filtro)
      .map(s => [s, parseFloat(pesos[s])])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    if (conPeso.length < 2) return new Set();
    const max = conPeso[0][1];
    const cerca = conPeso.filter(([, v]) => v >= max * 0.95);
    if (cerca.length > 2 || cerca.length === conPeso.length) return new Set();
    return new Set(cerca.map(([s]) => s));
  };
  const _mejores = _destacar(meta.pos, _pesosPos);
  const _tipTop = isEs
    ? "El stat con más peso de esta arma: es el que decide el precio, más que los otros del grupo."
    : "This weapon's highest-weighted stat: it drives the price more than the others in the group.";
  const _tipTopNeg = isEs
    ? "La maldición menos dañina de esta arma: es la que menos resta al precio de todo el grupo."
    : "This weapon's least harmful curse: it costs less value than any other in the group.";

  const bestPosHtml = (meta.pos || []).filter(allow).map(s => `
    <span ${_mejores.has(s) ? `data-tooltip="${_tipTop}" style="cursor:help; ` : "style=\""}background: rgba(0, 255, 120, ${_mejores.has(s) ? "0.28" : "0.15"}); border: 1px solid rgba(0, 255, 120, ${_mejores.has(s) ? "0.85" : "0.45"}); color: #00ff78; text-shadow: 0 0 6px rgba(0, 255, 120, 0.5); box-shadow: 0 0 ${_mejores.has(s) ? "12px rgba(0,255,120,0.4)" : "8px rgba(0, 255, 120, 0.15)"}; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: bold;">
      <span style="font-size: 9px; background: #00ff78; color: #000; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 900; text-transform: uppercase;">${_mejores.has(s) ? "TOP" : "BEST"}</span>+ ${getLocalizedStatName(s)}
    </span>
  `).join("");

  const midPos = (meta.midPos || []).filter(allow);
  const midPosHtml = midPos.length > 0 ? midPos.map(s => `
    <span style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.18); color: #eab308; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      <span style="font-size: 9px; background: rgba(234, 179, 8, 0.18); color: #eab308; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 700; text-transform: uppercase;">MID</span>+ ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  const worstPos = (meta.pos_tier?.trash || meta.pos?.worst || meta.rawPos?.worst || []).filter(allow);
  const worstPosHtml = worstPos.length > 0 ? worstPos.map(s => `
    <span style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.18); color: #94a3b8; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      + ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  const HARMLESS_NEG_CANDIDATES = ["Zoom", "Recoil", "Impact Damage", "Puncture Damage",
    "Ammo Maximum", "Magazine Capacity", "Reload Speed", "Projectile Speed", "Slash Damage",
    "Finisher Damage", "Heavy Attack Efficiency"];
  const _dw = meta.dynamic_weights || {};
  const _dataWantedNames = Object.keys(_dw).filter(k => parseFloat(_dw[k]) >= 0.5);
  const _dataWorst = Object.keys(_dw).filter(k => parseFloat(_dw[k]) >= STAT_TIER_TOP);
  const _dataMid = Object.keys(_dw).filter(k => {
    const v = parseFloat(_dw[k]); return v >= STAT_TIER_MID && v < STAT_TIER_TOP;
  });
  const _worstSet = new Set([...(meta.pos || []), ..._dataWorst].map(x => String(x).toLowerCase()));
  const _wantedSet = new Set([...(meta.pos || []), ...(meta.midPos || []), ..._dataWantedNames].map(x => String(x).toLowerCase()));
  const _curatedNeg = new Set((meta.neg || []).map(x => String(x).toLowerCase()));
  const harmlessAll = [...new Set([...(meta.neg || []), ...HARMLESS_NEG_CANDIDATES])]
    .filter(allowNeg)
    .filter(s => !_wantedSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const harmlessSet = new Set(harmlessAll.map(x => String(x).toLowerCase()));
  const _mejoresNeg = _destacar(harmlessAll, _pesosNeg, allowNeg);
  const bestNegHtml = harmlessAll.map(s => {
    const isTop = _mejoresNeg.has(s);
    const isCurated = _curatedNeg.has(String(s).toLowerCase());
    const fuerte = isTop || isCurated;
    const badge = fuerte
      ? `<span style="font-size: 9px; background: #00e5ff; color: #000; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 900; text-transform: uppercase;">${isTop ? "TOP" : "BEST"}</span>`
      : "";
    const tip = isTop ? ` data-tooltip="${_tipTopNeg}"` : "";
    return `<span${tip} style="${isTop ? "cursor:help; " : ""}background: rgba(0, 229, 255, ${isTop ? "0.28" : isCurated ? "0.15" : "0.07"}); border: 1px solid rgba(0, 229, 255, ${isTop ? "0.85" : isCurated ? "0.45" : "0.22"}); color: #00e5ff; ${fuerte ? `text-shadow: 0 0 6px rgba(0,229,255,0.5); box-shadow: 0 0 ${isTop ? "12px rgba(0,229,255,0.4)" : "8px rgba(0,229,255,0.15)"}; font-weight: bold;` : "font-weight: 500;"} padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${badge}- ${getLocalizedStatName(s)}</span>`;
  }).join("");

  // faction negatives go to MID, not harmless: their measured ratio falls short
  const FACTION_NEGS = ["Damage Vs Infested", "Damage Vs Corpus", "Damage Vs Grineer"];
  const midNeg = [...new Set([...(meta.midNeg || []), ...FACTION_NEGS, ...(meta.midPos || []), ..._dataMid])]
    .filter(allowNeg)
    .filter(s => !_worstSet.has(String(s).toLowerCase()) && !harmlessSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const midNegHtml = midNeg.length > 0 ? midNeg.map(s => `
    <span style="background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.18); color: #eab308; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      <span style="font-size: 9px; background: rgba(234, 179, 8, 0.18); color: #eab308; padding: 1px 4px; border-radius: 3px; margin-right: 5px; font-weight: 700; text-transform: uppercase;">MID</span>- ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  const goodNegSet = new Set([...(meta.neg || []), ...midNeg, ...harmlessAll].map(x => String(x).toLowerCase()));
  const worstNeg = [...new Set([
    ...(meta.pos || []), ..._dataWorst,
    ...(meta.negWorst || []), ...(meta.neg_tier?.curse || []), ...(meta.rawNeg?.worst || [])
  ])]
    .filter(allow)
    .filter(s => !goodNegSet.has(String(s).toLowerCase()) && !harmlessSet.has(String(s).toLowerCase()) && !CANT_BE_NEGATIVE.test(s));
  const worstNegHtml = worstNeg.length > 0 ? worstNeg.map(s => `
    <span style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.18); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px; display: inline-block; margin-bottom: 4px; font-weight: 500;">
      - ${getLocalizedStatName(s)}
    </span>
  `).join("") : "";

  let extraHtml = "";
  const hasOfficial = (meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0) ||
    (meta.official_avg_price !== undefined && meta.official_avg_price !== null && meta.official_avg_price > 0);

  const wfmAvgVal = meta.wfm_avg_price || meta.wfm_avg || 0;
  if (hasOfficial || wfmAvgVal || meta.popularity_pct) {
    const basePrice = meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0
      ? meta.official_median
      : (meta.official_avg_price || 0);

    const officialPrice = hasOfficial ? `${basePrice}p` : "N/A";
    const wfmPrice = wfmAvgVal ? `${wfmAvgVal}p` : "N/A";
    const pop = meta.popularity_pct != null ? `${Math.round(meta.popularity_pct)}/100` : (isEs ? "sin datos" : "no data");
    const sample = meta.wfm_market_sample
      ? `${meta.wfm_market_sample} ${isEs ? "ofertas" : "listings"}`
      : "N/A";

    const stddevVal = meta.official_stddev || 0;
    const nivelVol = nivelVolatilidad(meta);
    const etiquetaVol = etiquetaVolatilidad(nivelVol, isEs);

    const trendTooltip = getRivenTooltip("trend", isEs);

    const baseTooltip = !hasOfficial
      ? (isEs
        ? "No hay transacciones registradas oficialmente por Digital Extremes para este arma esta semana debido a su bajo volumen de comercio en el juego."
        : "No official transactions recorded by Digital Extremes for this weapon this week due to low in-game trading volume.")
      : getRivenTooltip("unrolled", isEs);

    const premiumTooltip = getRivenTooltip("wfm", isEs);

    const webMinVal = meta.web_min !== undefined ? meta.web_min : Math.round(wfmAvgVal * 0.25);
    const webMaxVal = meta.web_max !== undefined ? meta.web_max : 0;
    const rangeText = (webMinVal > 0 || webMaxVal > 0) ? `${webMinVal}–${webMaxVal}p` : "";

    const liqVal = meta.liquidity_score != null ? `${meta.liquidity_score}/100` : (isEs ? "sin datos" : "no data");

    const plat = `<img src="assets/relic_contents/platinum.webp" style="width:11px;height:11px;object-fit:contain;vertical-align:-1px;">`;
    const info = `<span class="info-icon" style="font-size:0.6rem;opacity:0.7;">ℹ</span>`;
    // kind changes color: an ask and a real sale differ ~13x (DE sale gold, WFM ask blue)
    const row = (label, value, tip, kind = "") => {
      const valStyle = kind === "ask"
        ? "color:#8fa3bf; font-weight:600; font-style:italic; white-space:nowrap;"
        : "color:var(--wf-gold-text); font-weight:700; white-space:nowrap;";
      return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:3px 0; ${tip ? "cursor:help;" : ""}" ${tip ? `data-tooltip="${tip}"` : ""}>
         <span style="color:#8a8a93;">${label} ${tip ? info : ""}</span>
         <span style="${valStyle}">${value}</span>
       </div>`;
    };
    const groupHeader = (txt) =>
      `<div style="font-size:10.5px; color:#8b93a1; text-transform:uppercase; font-weight:800; letter-spacing:0.06em; margin:10px 0 4px;">${txt}</div>`;

    const priceRows =
      row(isEs ? "Venta real · sin ciclar" : "Real sale · unrolled", officialPrice, baseTooltip, "real") +
      row(isEs ? "Piden en WFM" : "Asking on WFM", `${wfmPrice}${sample !== "N/A" ? ` · ${sample}` : ""}`, premiumTooltip, "ask") +
      (rangeText ? row(isEs ? "Rango de lo que piden" : "Asking range", rangeText, premiumTooltip, "ask") : "") +
      (hasOfficial ? row(getRivenMetricName("risk", isEs), `<span style="color:${etiquetaVol.color}">${etiquetaVol.riesgo}</span>${nivelVol ? ` <span style="color:#666;font-weight:400;">σ${stddevVal}p</span>` : ""}`, etiquetaVol.tooltip) : "");

    const demandRows =
      row(getRivenMetricName("trend", isEs), pop, trendTooltip) +
      row(getRivenMetricName("liquidity", isEs), liqVal, getRivenTooltip("liquidity", isEs));

    const rerollRows =
      row(getRivenMetricName("reroll", isEs), textoExtraPorCiclar(meta.rerolled_premium_ratio, isEs), getRivenTooltip("reroll", isEs));

    extraHtml = `
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.1); font-size:12.5px; line-height:1.5;">
        ${groupHeader(isEs ? "PRECIOS DEL ARMA (plat)" : "WEAPON PRICES (plat)")}
        ${priceRows}
        ${groupHeader(isEs ? "¿SE VENDE FÁCIL?" : "DOES IT SELL?")}
        ${demandRows}
        ${groupHeader(isEs ? "¿MERECE LA PENA ROLARLO?" : "WORTH ROLLING?")}
        ${rerollRows}
      </div>
    `;

    let tierEstimatesHtml = "";
    const wfmAvgValForTiers = meta.wfm_avg_price || meta.wfm_avg || 0;
    if (basePrice > 0 || wfmAvgValForTiers > 0) {
      const tiers = calculateHybridTiers(meta, state.currentWeaponHistory);
      const tierTip = isEs
        ? "Valor estimado en platino según la calidad del roll: Basura (sin tocar/malo), Buen reroll (estadísticas decentes) y Godroll (combinación ideal)."
        : "Estimated platinum value by roll quality: Trash (unrolled/bad), Good reroll (decent stats) and Godroll (ideal combo).";

      const tierCard = (label, value, color, bg) =>
        `<div style="background:${bg}; border:1px solid ${color}22; border-radius:4px; padding:6px; text-align:center;">
           <div style="font-size:9px; color:${color}; text-transform:uppercase; font-weight:bold;">${label}</div>
           <div style="display:inline-flex; align-items:center; gap:3px; justify-content:center; font-size:15px; color:${color}; font-weight:bold; margin-top:2px;">
             <span>${value}</span>${plat}
           </div>
         </div>`;

      tierEstimatesHtml = `
        <div style="margin-top:12px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.15);">
          <div style="font-size:10px; color:#888; margin-bottom:6px; text-transform:uppercase; font-weight:800; letter-spacing:0.05em; cursor:help;" data-tooltip="${tierTip}">${isEs ? "VALOR ESTIMADO (plat)" : "ESTIMATED VALUE (plat)"} ${info}</div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;">
            ${tierCard(isEs ? "BASURA" : "TRASH", tiers.trash, "#f2f2f7", "rgba(255,255,255,0.03)")}
            ${tierCard(isEs ? "BUEN REROLL" : "GOOD REROLL", tiers.goodReroll, "#00e5ff", "rgba(0,229,255,0.03)")}
            ${tierCard("GODROLL", tiers.godroll, "#ffd700", "rgba(255,215,0,0.03)")}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; box-shadow: inset 0 0 15px rgba(0,0,0,0.2);">
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 6px;">
            ${isEs ? "Guía de Atributos del Arma" : "Weapon Attributes Guide"}
            ${meta._genericRecs ? `<span style="color:#eab308; font-weight:700; margin-left:6px;" title="${isEs ? "Recomendación genérica por tipo de arma; no hay datos meta específicos para este arma." : "Generic recommendation by weapon type; no curated meta data for this weapon."}">${isEs ? "· estimado" : "· estimated"}</span>` : ""}
          </div>
          
          <!-- Positives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00ff78; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00ff78;"></span>
              ${isEs ? "MEJORES POSITIVOS (BUSCADOS)" : "BEST POSITIVES (WANTED)"}
            </div>
            <div>${bestPosHtml}</div>
            
            ${midPosHtml ? `
              <div style="font-size: 9px; color: #eab308; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #eab308;"></span>
                ${isEs ? "POSITIVOS MEDIOS" : "MID POSITIVES"}
              </div>
              <div>${midPosHtml}</div>
            ` : ""}
            
            ${worstPosHtml ? `
              <details class="guia-plegable">
                <summary><span class="guia-punto" style="background:#94a3b8;"></span>${isEs ? "POSITIVOS MEH (REGULARES)" : "MEH POSITIVES"}<span class="guia-n">${(meta.pos_meh_n || 0) || ""}</span></summary>
                <div>${worstPosHtml}</div>
              </details>
            ` : ""}
          </div>
          
          <!-- Negatives Section -->
          <div style="margin-bottom: 10px;">
            <div style="font-size: 9px; color: #00e5ff; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #00e5ff;"></span>
              ${isEs ? "MEJORES NEGATIVOS (INOFENSIVOS)" : "BEST NEGATIVES (HARMLESS)"}
            </div>
            <div>${bestNegHtml}</div>

            ${midNegHtml ? `
              <details class="guia-plegable">
                <summary><span class="guia-punto" style="background:#eab308;"></span>${isEs ? "NEGATIVOS MEDIOS" : "MID NEGATIVES"}</summary>
                <div>${midNegHtml}</div>
              </details>
            ` : ""}
            
            ${worstNegHtml ? `
              <div style="font-size: 9px; color: #ef4444; font-weight: 700; text-transform: uppercase; margin-top: 6px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span>
                ${isEs ? "PEORES NEGATIVOS (¡EVITAR - PENALIZAN PRECIO!)" : "WORST NEGATIVES (AVOID - RUINS VALUE!)"}
              </div>
              <div>${worstNegHtml}</div>
            ` : ""}
          </div>
          
          ${extraHtml}
          ${tierEstimatesHtml}
          ${tablaCicloHtml({ tipo: weaponType || meta.t, buscados: (meta.pos || []).filter(allow), negOk: harmlessAll, isEs })}
      </div>
    `;
  }
  container.style.display = "block";
  container.dataset.lastRenderedKey = cacheKey;
}

export function refreshCurrentRivenMetaStats() {
  let name = document.getElementById("rivenWeaponInput")?.value.trim();
  if (name && state.weaponMap) {
    const matchedKey = Object.keys(state.weaponMap).find(k => k.toLowerCase() === name.toLowerCase());
    if (matchedKey) {
      name = matchedKey;
      const data = state.weaponMap[name];
      renderMetaStats(name, data.t);
      renderMetaStats(name, data.t, "modal-meta-stats-container");
    }
  }
}
