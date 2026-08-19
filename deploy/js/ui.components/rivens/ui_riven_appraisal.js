import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { normalizeStatName } from "../../utils/rivens/riven_naming.js";
import {
  calculateRivenGrade,
  getRivenStatRange,
  calculateAdvancedPredictivePrice,
  calculateHybridTiers,
  gradeWeaponStats,
  STAT_TIER_TOP,
  STAT_TIER_MID,
} from "../../utils/rivens/riven_logic.js";
import { getMetaStats } from "../../services/rivens/riven_market.service.js?v=1.9";
import { computeDesirabilityMultiplier } from "../../services/rivens/riven_appraisal.service.js";

// La tarjeta de tasación: qué vale este roll, por qué, y contra qué se compara.
//
// Se pinta desde el tasador y desde el escáner, y no comparte estado con ninguno de los dos:
// entra un roll parseado, sale HTML. Por eso pudo salir entera de ui_rivens.js.

// Avisos de la tarjeta de tasación. Los largos van plegados en <details> (una línea plegada,
// texto completo a un tap) para que la tasación quepa sin scroll; los cortos quedan en línea.
export function buildAppraisalWarningsHtml({ appraisal, weaponData, desirabilityMultiplier, stats, priceCalculated, isEs }) {
  let warningHtml = "";
  if (appraisal.comboName) {
    const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
    if (dispo < 0.8) {
      const title = isEs
        ? `SINERGIA ELEMENTAL GODROLL (Dispo Baja: ${dispo.toFixed(2)})`
        : `ELEMENTAL SYNERGY GODROLL (Low Dispo: ${dispo.toFixed(2)})`;
      const desc = isEs
        ? `El combo <b>${appraisal.comboName}</b> ahorra valiosos slots de modulación. En armas con disposición reducida, este combo sustituye mods obligatorios y se tasa al nivel de un <b>Godroll</b>.`
        : `The <b>${appraisal.comboName}</b> combo saves valuable mod slots. For weapons with reduced disposition, this combo replaces mandatory mods and values near a <b>Godroll</b>.`;
      warningHtml = `<details class="gsc-flag cyan"><summary>${title}</summary><div>${desc}</div></details>`;
    } else {
      const title = isEs
        ? `SINERGIA ELEMENTAL (${appraisal.comboName})`
        : `ELEMENTAL SYNERGY (${appraisal.comboName})`;
      const desc = isEs
        ? `La combinación de elementos aumenta el valor comercial al liberar espacio de modulación.`
        : `The element combination increases market value by freeing up mod space.`;
      warningHtml = `<details class="gsc-flag green"><summary>${title}</summary><div>${desc}</div></details>`;
    }
  } else if (desirabilityMultiplier < 0.5) {
    // Distinguir la causa: si los stats son buenos pero NO hay negativa, la bajada es por
    // tener stats más débiles (sin curse), NO por stats "no deseados". Mensaje preciso.
    const _sinNeg = !stats.some(s => s.value < 0);
    warningHtml = _sinNeg
      ? `<div class="gsc-flag-line amber">${isEs ? "Sin negativa: stats más débiles (no godroll)" : "No negative: weaker stats (not a godroll)"}</div>`
      : `<div class="gsc-flag-line red">${isEs ? "Penalización por Stats no deseados" : "Heavy Penalty: Unpopular Stats"}</div>`;
  } else if (desirabilityMultiplier > 0.8) {
    warningHtml = `<div class="gsc-flag-line green">${isEs ? "Coincide con Stats Meta" : "Meta Stats Match"}</div>`;
  }

  // Risk warning for highly volatile trades exceeding 8,000p (fraudulent transfers / fake platinum risk)
  if (priceCalculated >= 8000) {
    const riskTitle = isEs
      ? "RIESGO DE PLATINO ILÍCITO / FRAUDULENTO"
      : "ILLEGAL / BOGUS PLATINUM RISK";
    const riskDesc = isEs
      ? "Las transacciones de Mods Agrietados que rozan o superan los 10,000p conllevan un riesgo extremo in-game. Ventas récord tan elevadas a menudo reflejan traspasos fraudulentos o lavado de platino. El comercio en este rango se realiza bajo tu propio riesgo debido a la alta probabilidad de recibir Platinum 'sucio/falso' que resulte en suspensión de cuenta."
      : "Riven trades approaching or exceeding 10,000p carry extreme in-game risks. Record prices in this range often reflect fraudulent transfers or platinum laundering. Trading in this high tier is done strictly at your own risk due to a high likelihood of receiving 'fake/dirty' platinum leading to account suspension.";
    warningHtml += `<details class="gsc-flag red"><summary>${riskTitle}</summary><div>${riskDesc}</div></details>`;
  }
  return warningHtml;
}

// Markup ÚNICO de la tarjeta de tasación (la usa la ruta single y la comparativa; antes eran
// dos copias que debían mantenerse en sync). Jerarquía: precio y grade co-dominantes arriba,
// métricas secundarias como chips, avisos plegados. Los ganchos [data-*] son el contrato del
// parcheo async del ML: data-fair-price / data-fair-range / data-ml-line / data-market-line /
// data-stat-score / data-roll-score deben existir SIEMPRE en este markup.
export function buildAppraisalCardHTML({ tier, tierColor, priceCalculated, minPrice, maxPrice, finalScore, popPct, basePrice, warningHtml, isEs, withSimilarButton, histLoading }) {
  // Mientras llega el historial semanal: la primera pasada tasa sin él y se recalcula al llegar.
  // Punto pulsante (sin emoji), tooltip explica el estado.
  const histHint = histLoading
    ? `<span class="gsc-hist-loading" title="${isEs ? "Actualizando con historial de precios…" : "Updating with price history…"}"></span>`
    : "";
  const similarHtml = withSimilarButton ? `
    <button id="btn-search-similar-rivens" class="btn btn-secondary" style="margin-top: 10px; width: 100%; font-size: 11px; padding: 6px 12px; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(155, 89, 182, 0.2); border: 1px solid rgba(155, 89, 182, 0.4); color: #dcb3ff; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(155, 89, 182, 0.4)'" onmouseout="this.style.background='rgba(155, 89, 182, 0.2)'">
      <img src="assets/dmg/DmgVoidSmall64.webp" style="width:14px; height:14px; object-fit:contain;"> ${isEs ? "Buscar Rivens Similares" : "Search Similar Rivens"}
    </button>
    <div id="similar-rivens-container" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; display: none;"></div>
  ` : "";

  return `
    <div class="gsc-hero">
      <div class="gsc-price">
        <span class="gsc-price-label">${isEs ? "Valor Estimado" : "Estimated Value"}${histHint}</span>
        <span class="gsc-price-value">
          <span data-fair-price>~${priceCalculated}p</span>
          <img src="assets/relic_contents/platinum.webp" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle;">
        </span>
        <span class="gsc-price-range" title="${isEs ? "Del precio de venta rápida (abajo) al techo si esperas al comprador adecuado (arriba)." : "From quick-sale price (low) to the ceiling if you wait for the right buyer (high)."}" style="cursor:help;">${isEs ? "Rango" : "Range"}: <span data-fair-range>${minPrice}p - ${maxPrice}p</span></span>
      </div>
      <div class="gsc-grade">
        <div class="grade-badge-large ${tierColor} gsc-badge">${tier}</div>
        <span class="gsc-grade-score">Score <b>${finalScore}%</b></span>
      </div>
      <div class="grade-track gsc-score-track"><div class="grade-fill ${tier[0]}" style="width:${Math.max(0, Math.min(100, finalScore))}%"></div></div>
    </div>

    <div class="gsc-chips">
      <span class="gsc-chip" data-stat-score title="${isEs ? "¿Son estos los stats que los compradores buscan en esta arma? S = combo muy buscado · F = stats que nadie quiere. Solo mira QUÉ stats son, no sus números." : "Are these the stats buyers want on this weapon? S = highly wanted combo · F = stats nobody wants. Only looks at WHICH stats, not their numbers."}" style="cursor:help;">${isEs ? "Stats buscados" : "Wanted stats"}: <b style="opacity:.5;">…</b></span>
      <span class="gsc-chip" data-roll-score title="${isEs ? "¿Cómo de altos salieron los números dentro de lo posible para cada stat? S = casi perfectos · F = por los mínimos. No mira si los stats son buenos, solo cuánto rolaron." : "How high did the numbers land within what's possible for each stat? S = near perfect · F = rock bottom. Ignores whether the stats are good, only how well they rolled."}" style="cursor:help;">${isEs ? "Nivel del roll" : "Roll strength"}: <b style="opacity:.5;">…</b></span>
      <span class="gsc-chip" data-tooltip="${isEs ? "Cuánto se está comerciando esta arma ahora mismo: 0 = nadie la busca, 100 = de las más demandadas. Con demanda alta venderás antes y a mejor precio." : "How actively this weapon is being traded right now: 0 = nobody wants it, 100 = among the most in-demand. High demand means faster sales at better prices."}" style="cursor: help;">${isEs ? "Demanda" : "Demand"}: <b>${Math.round(popPct)}/100</b> <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-tooltip="${isEs ? "Lo que se paga de verdad por un riven cualquiera de esta arma: la mediana de las ventas reales del juego, sin timos ni gangas. Es el punto de partida antes de valorar tus stats." : "What people actually pay for any riven of this weapon: the median of real in-game sales, excluding scams and fire sales. The starting point before your stats are valued."}" style="cursor: help;">${isEs ? "Precio típico" : "Typical price"}: <b>${basePrice}p</b> <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-ml-line style="display:none;"></span>
      <span class="gsc-chip" data-market-line style="display:none;"></span>
      <span class="gsc-chip" data-comp-line style="display:none;"></span>
    </div>

    <div class="gsc-flags">${warningHtml}</div>
    ${similarHtml}
  `;
}

// Desglose de stats como TABLA compacta (stat | valor | ideal | grade): máxima densidad,
// una fila por stat. La usan la ruta single y la comparativa del modal.
export function buildStatsTable(stats, weaponData, buffCount, hasNeg, isEs) {
  const table = document.createElement("div");
  table.className = "stats-table";
  const head = document.createElement("div");
  head.className = "st-row st-head";
  head.innerHTML = `<span>Stat</span><span>${isEs ? "Valor" : "Value"}</span><span>Ideal</span><span>G</span>`;
  table.appendChild(head);
  stats.forEach((stat) => {
    const internalName = normalizeStatName(stat.name, weaponData?.t);
    const res = calculateRivenGrade(weaponData, internalName, stat.projected, stat.value < 0, buffCount, hasNeg);
    let color = "grade-f";
    if (["SSS", "S+", "S"].includes(res.grade)) color = "grade-s";
    else if (["A+", "A"].includes(res.grade)) color = "grade-a";
    else if (["B+", "B"].includes(res.grade)) color = "grade-b";
    else if (["C+", "C"].includes(res.grade)) color = "grade-c";
    const isNegStat = stat.value < 0;
    const row = document.createElement("div");
    row.className = `st-row${isNegStat ? " neg" : ""}`;
    row.innerHTML = `
      <span class="st-name" title="${escapeHTML(stat.name)}">${escapeHTML(stat.name)}</span>
      <span class="st-val">${isNegStat ? "−" : "+"}${Math.abs(stat.value)}%</span>
      <span class="st-ideal">${escapeHTML(String(res.range))}</span>
      <span class="st-grade ${color}">${escapeHTML(String(res.grade))}</span>`;
    table.appendChild(row);
  });
  return table;
}

// Techo del rango CONSCIENTE DEL ROLL. p95 es el techo godroll del ARMA entera: usarlo plano
// inflaba el rango de rolls mediocres (ej. Cedo Prime con stats C -> "hasta 938p" irreal).
// Un combo de stats poco buscado nunca cobra precio de godroll por mucho que haya rolado alto,
// así que el techo se elige por la calidad de los STATS (qué combo es), no por la magnitud.
export function computeFairHigh(appraisal, bandQ, fair) {
  const statQ = Number.isFinite(appraisal?.statScore?.score) ? appraisal.statScore.score
    : (Number.isFinite(appraisal?.adjustedScore) ? appraisal.adjustedScore : null);
  let cap;
  if (statQ == null || statQ >= 75) cap = bandQ.p95;          // combo top: techo godroll real
  else if (statQ >= 55) cap = bandQ.p90;                       // combo bueno
  else if (statQ >= 35) cap = bandQ.p80;                       // combo mediocre
  else cap = Math.round((bandQ.p50 || fair) * 1.5);            // combo no deseado: poco sobre el justo
  const rawHigh = Math.max(bandQ.p95 || 0, appraisal.suggestedMax || 0, fair);
  return Math.max(fair, Math.min(rawHigh, Math.max(cap, Math.round(fair * 1.3))));
}

// Chip de la IA en lenguaje llano: nada de MAPE/p25/p95 — "confianza X, se desvía ±N%",
// y la banda de cuantiles traducida a venta rápida / precio justo / buen roll / godroll.
export function renderMlChip(estCard, prec, bandQ, isEs) {
  const el = estCard.querySelector("[data-ml-line]");
  if (!el) return;
  const colores = { alta: "#4ade80", high: "#4ade80", media: "#fbbf24", medium: "#fbbf24", baja: "#f87171", low: "#f87171" };
  const warn = bandQ.confianza === "baja" ? ` <b style="color:#f87171;">!</b>` : "";
  let precTxt;
  if (prec && Number.isFinite(prec.mape)) {
    const nivel = prec.mape < 35 ? (isEs ? "alta" : "high") : prec.mape < 70 ? (isEs ? "media" : "medium") : (isEs ? "baja" : "low");
    precTxt = `<b style="color:${colores[nivel] || "#cbd5e1"};">${isEs ? "confianza " + nivel : nivel + " confidence"}</b> <span style="opacity:.6;">(±${prec.mape}%)</span>`;
  } else {
    precTxt = `<span style="opacity:.6;">${bandQ.confianza === "baja" ? (isEs ? "confianza baja" : "low confidence") : (isEs ? "sin historial suficiente" : "not enough history")}</span>`;
  }
  el.style.display = "inline-flex";
  el.title = (isEs
    ? `Cuánto suele desviarse la predicción del precio real en esta arma (medido con ventas que la IA no vio al entrenar). `
      + `Según la IA: venta rápida ~${bandQ.p25}p · precio justo ~${bandQ.p50}p · buen roll ~${bandQ.p80}p · godroll ~${bandQ.p95}p`
    : `How far the prediction typically lands from the real price on this weapon (measured on sales the AI never saw). `
      + `Per the AI: quick sale ~${bandQ.p25}p · fair price ~${bandQ.p50}p · good roll ~${bandQ.p80}p · godroll ~${bandQ.p95}p`)
    + (bandQ.aviso ? ` · ${bandQ.aviso}` : "");
  el.innerHTML = `${isEs ? "IA" : "AI"}: ${precTxt}${warn}`;
}

// Chip de mercado en lenguaje llano: "42 anuncios/día" y "piden 3× su valor típico".
export function renderMarketChip(estCard, mk, isEs) {
  const el = estCard.querySelector("[data-market-line]");
  if (!el || !mk) return;
  const col = { meta: "#4ade80", bubble: "#f87171", illiquid: "#60a5fa", mid: "#cbd5e1", nodata: "#9ca3af" }[mk.flag] || "#cbd5e1";
  el.style.display = "inline-flex"; el.style.color = col;
  el.title = mk.advice;
  const extras = [
    mk.vol ? `${mk.vol} ${isEs ? "anuncios/día" : "listings/day"}` : null,
    // El ratio solo se muestra si su denominador son ventas reales de rivens rolados; si no, el
    // número existe pero no significa lo que parece (ver refFiable en classifyWeaponMarket).
    (mk.refFiable && mk.ratio >= 2)
      ? (isEs ? `piden ${mk.ratio}× lo que se paga` : `asking ${mk.ratio}× what gets paid`) : null,
  ].filter(Boolean).join(" · ");
  el.innerHTML = `<span class="gsc-dot" style="background:${col}; box-shadow:0 0 6px ${col};"></span> <b>${mk.label}</b>${extras ? ` <span style="opacity:.6;">· ${extras}</span>` : ""}`;
}

export function generateRollResultsDOM(roll, weaponData, weaponName, currentRank, scaleFactor) {
  const stats = roll.stats.map(s => ({
    name: s.name,
    value: s.value,
    projected: s.value * scaleFactor
  }));
  const buffCount = stats.filter((s) => s.value > 0).length;
  const hasNeg = stats.some((s) => s.value < 0);

  const statsCol = document.createElement("div");
  statsCol.className = "results-stats-col";
  statsCol.appendChild(buildStatsTable(stats, weaponData, buffCount, hasNeg, state.currentLang === "es"));

  // Desirability Weighting
  const meta = getMetaStats(weaponData?.name || weaponName, weaponData?.t);
  const desirabilityMultiplier = computeDesirabilityMultiplier(stats, meta, weaponData);

  // Price Estimator
  const avgText = document.getElementById("riven-avg-value")?.innerText;
  let basePrice = 50;
  if (meta) {
    if (meta.official_median !== undefined && meta.official_median !== null && meta.official_median > 0) {
      basePrice = meta.official_median;
    } else if (meta.official_avg_price) {
      basePrice = meta.official_avg_price;
    } else {
      basePrice = Number.parseInt(avgText) || 50;
    }
  } else {
    basePrice = Number.parseInt(avgText) || 50;
  }
  if (basePrice < 50) basePrice = 50;

  const popPct = meta && meta.popularity_pct ? (meta.popularity_pct / 10.0) : 0.5;
  const tiersObj = calculateHybridTiers(meta || { name: weaponName, wfm_avg_price: basePrice, official_median: basePrice }, state.currentWeaponHistory);

  const itemAttributes = stats.map(stat => {
    const internalName = normalizeStatName(stat.name, weaponData?.t);
    const rangeInfo = getRivenStatRange(weaponData, internalName, stat.value < 0, buffCount, hasNeg) || { min: 0, max: 0 };
    return {
      isPositive: stat.value > 0,
      name: internalName,
      value: Math.abs(stat.projected),
      minIdeal: Math.abs(rangeInfo.min),
      maxIdeal: Math.abs(rangeInfo.max)
    };
  });

  const appraisal = calculateAdvancedPredictivePrice(meta || { name: weaponName, wfm_avg_price: basePrice, official_median: basePrice }, itemAttributes, tiersObj, desirabilityMultiplier, weaponData, state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);

  // EXPERIMENTAL (no destructivo): modelo XGBoost slim (lazy-load), ANCLADO a la banda robusta
  // (mediana histórica DE + techo acotado) para no fiarse de outliers de un día.
  {
    const _w = meta || { name: weaponName, official_median: basePrice, wfm_avg: basePrice };
    import("../../utils/rivens/riven_ml.js")
      .then(async (M) => {
        const bandQ = await M.predictRivenMLBand(_w, itemAttributes, weaponData, null, appraisal.adjustedScore);
        const mk = await M.getWeaponMarket(weaponName, _w);
        appraisal.mlEstimate = bandQ.p50;
        appraisal.mlBand = bandQ;
        // DOS SCORES: calidad por stats (meta) y calidad del roll (magnitud)
        try {
          const sc = await M.rivenScores(weaponName, itemAttributes);
          appraisal.statScore = sc.stat; appraisal.rollScore = sc.roll;
          // Mini badge con la misma paleta que la pestaña de grading (.grade-badge-large)
          const _gBadge = (g) => `<span class="gsc-mini-badge grade-${String(g || "f").toLowerCase()}">${g}</span>`;
          const _ss = estCard.querySelector("[data-stat-score] b");
          const _rs = estCard.querySelector("[data-roll-score] b");
          if (_ss) { _ss.innerHTML = `${sc.stat.score}% ${_gBadge(sc.stat.grade)}`; _ss.style.opacity = 1; }
          if (_rs) { _rs.innerHTML = `${sc.roll.score}% ${_gBadge(sc.roll.grade)}`; _rs.style.opacity = 1; }
        } catch (_e) { /* scores opcionales */ }
        // FUSIÓN PONDERADA POR FIABILIDAD: la heurística COMPLEMENTA al ML. Si el ML es preciso en
        // esta arma (MAPE bajo) pesa más el ML; si es impreciso / baja confianza, manda la heurística.
        const _prec = (typeof M.weaponPrecision === "function") ? await M.weaponPrecision(weaponName) : null;
        const _h = appraisal.estimatedValue || 0, _m = bandQ.p50 || 0;
        let _wMl = (_prec && Number.isFinite(_prec.mape))
          ? (_prec.mape < 30 ? 0.75 : _prec.mape < 60 ? 0.60 : _prec.mape < 100 ? 0.42 : 0.28)
          : 0.35;   // sin dato de precisión -> apóyate en la heurística
        if (bandQ.confianza === "baja") _wMl = Math.min(_wMl, 0.30);
        let _fair = (_h > 0 && _m > 0)
          ? Math.round(Math.exp(_wMl * Math.log(_m) + (1 - _wMl) * Math.log(_h)))
          : Math.round(_m || _h);
        // CLAMP DE MERCADO: salvo godroll real (score GLOBAL >=85, combo Y magnitudes altas), el fair
        // no puede dispararse muy por encima de la mediana real de ventas (typical/basePrice). Ataca
        // el sobreprecio del modelo en rolls medios (un 66% no vale 3× el típico). Un combo S con
        // magnitudes B baja el score global y por eso SÍ se clampa aquí (no basta con buen combo).
        {
          const _ovr = Number.isFinite(appraisal.adjustedScore) ? appraisal.adjustedScore : (appraisal?.statScore?.score || 0);
          const _typical = basePrice || _m || _fair;
          if (_typical > 0 && _ovr < 85) {
            const _capMul = _ovr >= 70 ? 2.2 : _ovr >= 55 ? 1.6 : _ovr >= 40 ? 1.3 : 1.15;
            _fair = Math.min(_fair, Math.round(_typical * _capMul));
          }
        }
        const _low = Math.max(1, Math.min(bandQ.p25, appraisal.suggestedMin || bandQ.p25, _fair));
        const _high = computeFairHigh(appraisal, bandQ, _fair);
        appraisal.fairPrice = _fair; appraisal.fairLow = _low; appraisal.fairHigh = _high;
        const _fp = estCard.querySelector("[data-fair-price]"), _fr = estCard.querySelector("[data-fair-range]");
        if (_fp) _fp.textContent = `~${_fair}p`;
        if (_fr) _fr.textContent = `${_low}p – ${_high}p`;
        console.log(`[ML fusion] ${weaponName}: heur=${_h} ml=${_m} wMl=${_wMl.toFixed(2)} -> fair=${_fair} [${_low}-${_high}]`);
        renderMlChip(estCard, _prec, bandQ, isEs);
        renderMarketChip(estCard, mk, isEs);
      })
      .catch(e => console.warn("[ML] error:", e));
  }

  let priceCalculated = appraisal.estimatedValue;
  let minPrice = appraisal.suggestedMin;
  let maxPrice = appraisal.suggestedMax;
  const finalScore = appraisal.adjustedScore;

  let tier = "F";
  let tierColor = "grade-f";
  if (finalScore >= 98) {
    tier = "SSS";
    tierColor = "grade-s";
  } else if (finalScore >= 90) {
    tier = "S+";
    tierColor = "grade-s";
  } else if (finalScore >= 80) {
    tier = "S";
    tierColor = "grade-s";
  } else if (finalScore >= 60) {
    tier = "A";
    tierColor = "grade-a";
  } else if (finalScore >= 40) {
    tier = "B";
    tierColor = "grade-b";
  } else if (finalScore > 0) {
    tier = "C";
    tierColor = "grade-c";
  }

  const estCard = document.createElement("div");
  estCard.className = "grade-summary-card gsc";

  const isEs = state.currentLang === "es";

  const warningHtml = buildAppraisalWarningsHtml({ appraisal, weaponData, desirabilityMultiplier, stats, priceCalculated, isEs });
  estCard.innerHTML = buildAppraisalCardHTML({
    tier, tierColor, priceCalculated, minPrice, maxPrice, finalScore, popPct, basePrice,
    warningHtml, isEs, withSimilarButton: false,
    histLoading: !!(state.currentWeaponHistory?.weaponName === weaponName && state.currentWeaponHistory.loading)
  });

  const wrapper = document.createElement("div");
  wrapper.style = "display: flex; flex-direction: column; gap: 12px; width: 100%;";
  // Hero primero: la tasación (precio + grade) arriba, el desglose de stats debajo.
  wrapper.appendChild(estCard);
  wrapper.appendChild(statsCol);

  return wrapper;
}
