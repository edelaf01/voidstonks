import { state } from "../../state.js";
import { RIVEN_STATS } from "../../config.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getRivenSlug } from "../../utils/slugs.utils.js";
import { onTap } from "../../utils/tap.js";
import { normalizeStatName } from "../../utils/rivens/riven_naming.js";
import {
  getRivenStatRange,
  calculateAdvancedPredictivePrice,
  calculateHybridTiers,
  gradeWeaponStats,
} from "../../utils/rivens/riven_logic.js";
import { getLocalizedStatName, valorDelStat } from "../../utils/rivens/riven_stat_display.js";
import { tipoDeArma, esFusionado } from "../../utils/rivens/riven_cycling.js";
import {
  posicionTirada,
  calidadStatEnArma,
  posicionEnBanda,
  nivelConfianza,
  tierDeScore,
  precioBaseDeArma,
  demandaDeArma,
  precioJusto,
} from "../../utils/rivens/riven_tasacion_visual.js";
import { fechaWfmRivens, rotuloBanda } from "../../utils/rivens/riven_tooltips.js";
import { getMetaStats, fetchSimilarRivens } from "../../services/rivens/riven_market.service.js?v=1.9";
import { computeDesirabilityMultiplier, statsBuscadosDelArma } from "../../services/rivens/riven_appraisal.service.js";
import { metaConPesosDeFamilia, statsSinDatoPropio } from "../../services/rivens/riven_weights.service.js";
import { nivelesDeStats } from "./ui_riven_meta_stats.js";
import { cicloRivenHtml } from "./ui_riven_cycling.js";

const PLAT = '<span class="plat-icon-inline" aria-hidden="true"></span>';
const PLAT_HERO = '<span class="plat-icon-inline tas-plat" aria-hidden="true"></span>';

const AVISO_BANDA = {
    trash: {
        es: "Roll de gama baja: precio orientativo (usa la banda, no el valor único).",
        en: "Low-end roll: ballpark price (use the band, not the single value).",
    },
    pocosDatos: {
        es: "Pocos datos del arma: precio orientativo.",
        en: "Little data for this weapon: ballpark price.",
    },
};

function htmlBanda(low, fair, high, isEs) {
  if (!Number.isFinite(low) || !Number.isFinite(fair) || !Number.isFinite(high)) return "";
  const pos = posicionEnBanda({ low, fair, high });
  const anclaJusto = pos === null ? "" : ` style="--tas-pos:${(pos * 100).toFixed(1)}%"`;
  const cifras = `<div class="tas-banda-cifras"${anclaJusto}>`
    + `<span><small>${isEs ? "Mínimo" : "Low"}</small><b>${low}${PLAT}</b></span>`
    + `<span><small>${isEs ? "Justo" : "Fair"}</small><b>${fair}${PLAT}</b></span>`
    + `<span><small>${isEs ? "Alto" : "High"}</small><b>${high}${PLAT}</b></span>`
    + `</div>`;
  if (pos === null) return cifras;
  return `${cifras}<div class="tas-banda-pista"><span class="tas-banda-marca" style="left:${(pos * 100).toFixed(1)}%"></span></div>`;
}

function pintarPrecio(estCard, low, fair, high, isEs) {
  if (!estCard?.querySelector) return;
  const fp = estCard.querySelector("[data-fair-price]");
  const fr = estCard.querySelector("[data-fair-range]");
  if (fp) {
    fp.textContent = `~${fair}`;
    fp.removeAttribute("data-sin-cifra");
  }
  if (fr) fr.innerHTML = htmlBanda(low, fair, high, isEs);
}

function pipsConfianza(nivel) {
  const n = nivel === "alta" ? 3 : nivel === "media" ? 2 : nivel === "baja" ? 1 : 0;
  let html = `<span class="tas-pips tas-conf-${nivel || "nula"}" aria-hidden="true">`;
  for (let i = 0; i < 3; i++) {
    html += `<span class="tas-pip${i < n ? " lleno" : ""}"></span>`;
  }
  return `${html}</span>`;
}

function marcarChipsSinDato(estCard) {
  if (!estCard?.querySelector) return;
  for (const sel of ["[data-stat-score] b", "[data-roll-score] b"]) {
    const b = estCard.querySelector(sel);
    if (b && b.textContent === "…") {
      b.textContent = "—";
      if (b.style) b.style.opacity = 1;
    }
  }
}

export function nivelesDelArma(meta, weaponName, tipo, typeIdx) {
  if (!meta) return { niveles: null, pesos: null, generico: false };
  const copia = { ...metaConPesosDeFamilia(meta, weaponName) };
  const niveles = nivelesDeStats(copia, weaponName, tipo);
  const grado = gradeWeaponStats(copia, state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null, typeIdx);
  return { niveles, pesos: grado?.pesos ?? null, generico: !!copia._genericRecs };
}

export function etiquetaDeCalidad(nivel, isEs) {
  if (nivel === "top") return "TOP";
  if (nivel === "medio") return isEs ? "MEDIO" : "MID";
  if (nivel === "flojo") return isEs ? "FLOJO" : "WEAK";
  if (nivel === "inofensiva") return isEs ? "INOFENSIVA" : "HARMLESS";
  if (nivel === "media") return isEs ? "MEDIA" : "MODERATE";
  if (nivel === "ruinosa") return isEs ? "RUINOSA" : "RUINOUS";
  return isEs ? "SIN DATOS" : "NO DATA";
}

export function textoNivelTirada(pos, isNeg, calidadNivel, fusionado, isEs) {
  if (!pos) return isEs ? "Sin rango conocido" : "No known range";
  if (pos.fuera) {
    return isEs
      ? "Fuera de rango: revisa el valor, el rango del mod y los stats"
      : "Out of range: check the value, mod rank and stats";
  }
  if (isNeg && calidadNivel === "inofensiva") {
    return isEs ? "La tirada apenas importa" : "Roll barely matters";
  }
  if (isNeg) {
    if (pos.nivel === "alta") return isEs ? "PENALIZACIÓN LEVE" : "MILD PENALTY";
    if (pos.nivel === "media") return isEs ? "PENALIZACIÓN MEDIA" : "MODERATE PENALTY";
    return isEs ? "PENALIZACIÓN FUERTE" : "HEAVY PENALTY";
  }
  const base = pos.nivel === "alta"
    ? (isEs ? "TIRADA ALTA" : "HIGH ROLL")
    : pos.nivel === "media"
      ? (isEs ? "TIRADA MEDIA" : "MID ROLL")
      : (isEs ? "TIRADA BAJA" : "LOW ROLL");
  return fusionado ? base : `${base} · ${Math.round(pos.bondad * 100)}%`;
}

export function buildAppraisalWarningsHtml({ appraisal, desirabilityMultiplier, stats, priceCalculated, isEs }) {
  let warningHtml = "";
  if (appraisal.comboName) {
    const title = isEs
      ? `SINERGIA ELEMENTAL (${appraisal.comboName})`
      : `ELEMENTAL SYNERGY (${appraisal.comboName})`;
    const desc = isEs
      ? `La combinación de elementos aumenta el valor comercial al liberar espacio de modulación.`
      : `The element combination increases market value by freeing up mod space.`;
    warningHtml = `<details class="gsc-flag green"><summary>${title}</summary><div>${desc}</div></details>`;
  } else if (desirabilityMultiplier < 0.5) {
    const _sinNeg = !stats.some(s => s.value < 0);
    warningHtml = _sinNeg
      ? `<div class="gsc-flag-line amber">${isEs ? "Sin negativa: stats más débiles (no godroll)" : "No negative: weaker stats (not a godroll)"}</div>`
      : `<div class="gsc-flag-line red">${isEs ? "Penalización por Stats no deseados" : "Heavy Penalty: Unpopular Stats"}</div>`;
  } else if (desirabilityMultiplier > 0.8) {
    warningHtml = `<div class="gsc-flag-line green">${isEs ? "Coincide con Stats Meta" : "Meta Stats Match"}</div>`;
  }

  if (priceCalculated >= 8000) {
    const riskTitle = isEs
      ? "RIESGO DE PLATINO ILÍCITO / FRAUDULENTO"
      : "ILLEGAL / BOGUS PLATINUM RISK";
    const riskDesc = isEs
      ? "Las transacciones de Mods Agrietados que rozan o superan los 10.000 de platino conllevan un riesgo extremo in-game. Ventas récord tan elevadas a menudo reflejan traspasos fraudulentos o lavado de platino. El comercio en este rango se realiza bajo tu propio riesgo debido a la alta probabilidad de recibir Platinum 'sucio/falso' que resulte en suspensión de cuenta."
      : "Riven trades approaching or exceeding 10,000 platinum carry extreme in-game risks. Record prices in this range often reflect fraudulent transfers or platinum laundering. Trading in this high tier is done strictly at your own risk due to a high likelihood of receiving 'fake/dirty' platinum leading to account suspension.";
    warningHtml += `<details class="gsc-flag red"><summary>${riskTitle}</summary><div>${riskDesc}</div></details>`;
  }
  return warningHtml;
}

// the data-* hooks are the contract for the async ML patch and must always exist here
export function buildAppraisalCardHTML({ tier, tierColor, priceCalculated, minPrice, maxPrice, finalScore, demanda, precioTipico, warningHtml, isEs, withSimilarButton, histLoading }) {
  const histHint = histLoading
    ? `<span class="tas-hist"><span class="gsc-hist-loading"></span>${isEs ? "actualizando historial…" : "updating history…"}</span>`
    : "";
  const similarHtml = withSimilarButton ? `
    <button id="btn-search-similar-rivens" class="btn btn-secondary" style="margin-top: 10px; width: 100%; font-size: 11px; padding: 6px 12px; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(155, 89, 182, 0.2); border: 1px solid rgba(155, 89, 182, 0.4); color: #dcb3ff; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(155, 89, 182, 0.4)'" onmouseout="this.style.background='rgba(155, 89, 182, 0.2)'">
      <img src="assets/dmg/DmgVoidSmall64.webp" style="width:14px; height:14px; object-fit:contain;"> ${isEs ? "Buscar Rivens Similares" : "Search Similar Rivens"}
    </button>
    <div id="similar-rivens-container" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; display: none;"></div>
  ` : "";
  const sinDatos = precioTipico == null;
  const pendiente = '<b style="opacity:.5;">…</b>';
  const precioHero = sinDatos
    ? `<span data-fair-price data-sin-cifra>…</span>${PLAT_HERO}`
    : `<span data-fair-price>~${priceCalculated}</span>${PLAT_HERO}`;
  const bandaHero = sinDatos ? "" : htmlBanda(minPrice, priceCalculated, maxPrice, isEs);
  const confHero = `${pipsConfianza(null)}<span>${isEs ? "Calculando confianza…" : "Computing confidence…"}</span>`;

  return `
    <div class="gsc-hero tas-hero">
      <div class="gsc-price">
        <span class="gsc-price-label">${isEs ? "Valor Estimado" : "Estimated Value"}${histHint}</span>
        <span class="gsc-price-value">${precioHero}</span>
      </div>
      <div class="gsc-grade">
        <div class="grade-badge-large ${tierColor} gsc-badge">${tier}</div>
        <span class="gsc-grade-score">Score <b>${finalScore}%</b></span>
      </div>
      <div class="tas-banda" data-fair-range data-tooltip="${isEs ? "Del precio de venta rápida (abajo) al techo si esperas al comprador adecuado (arriba)." : "From quick-sale price (low) to the ceiling if you wait for the right buyer (high)."}">${bandaHero}</div>
      <div class="tas-confianza" data-ml-line>${confHero}</div>
    </div>

    <div class="gsc-chips">
      <span class="gsc-chip" data-stat-score data-tooltip="${isEs ? "¿Son estos los stats que los compradores buscan en esta arma? S = combo muy buscado · F = stats que nadie quiere. Solo mira QUÉ stats son, no sus números." : "Are these the stats buyers want on this weapon? S = highly wanted combo · F = stats nobody wants. Only looks at WHICH stats, not their numbers."}" style="cursor: help;">${isEs ? "Stats buscados" : "Wanted stats"}: ${pendiente} <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-roll-score data-tooltip="${isEs ? "¿Cómo de altos salieron los números dentro de lo posible para cada stat? S = casi perfectos · F = por los mínimos. No mira si los stats son buenos, solo cuánto rolaron." : "How high did the numbers land within what's possible for each stat? S = near perfect · F = rock bottom. Ignores whether the stats are good, only how well they rolled."}" style="cursor: help;">${isEs ? "Nivel del roll" : "Roll strength"}: ${pendiente} <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-tooltip="${isEs ? "Cuánto se está comerciando esta arma ahora mismo: 0 = nadie la busca, 100 = de las más demandadas. Con demanda alta venderás antes y a mejor precio." : "How actively this weapon is being traded right now: 0 = nobody wants it, 100 = among the most in-demand. High demand means faster sales at better prices."}" style="cursor: help;">${isEs ? "Demanda" : "Demand"}: <b>${demanda == null ? (isEs ? "sin datos" : "no data") : `${demanda}/100`}</b> <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-tooltip="${isEs ? "Lo que se paga de verdad por un riven cualquiera de esta arma: la mediana de las ventas reales del juego, sin timos ni gangas. Es el punto de partida antes de valorar tus stats." : "What people actually pay for any riven of this weapon: the median of real in-game sales, excluding scams and fire sales. The starting point before your stats are valued."}" style="cursor: help;">${isEs ? "Precio típico" : "Typical price"}: <b>${precioTipico == null ? (isEs ? "sin datos" : "no data") : `${precioTipico}${PLAT}`}</b> <span class="gsc-info">i</span></span>
      <span class="gsc-chip" data-market-line style="display:none;"></span>
      <span class="gsc-chip" data-comp-line style="display:none;"></span>
    </div>

    <div class="gsc-flags">${warningHtml}</div>
    ${similarHtml}
  `;
}

export function buildStatsTable(stats, weaponData, buffCount, hasNeg, isEs, { meta = null, weaponName = "", escala = 1 } = {}) {
  const table = document.createElement("div");
  table.className = "stats-table tas-tabla";
  const tipo = weaponData?.t || meta?.t;
  const typeIdx = tipoDeArma(tipo);
  const { niveles, pesos, generico } = nivelesDelArma(meta, weaponName, tipo, typeIdx);
  const sinDatoPos = statsSinDatoPropio(weaponName, "pos");
  const sinDatoNeg = statsSinDatoPropio(weaponName, "neg");
  let hayEstimadaGenerica = false;
  let hayFusionado = false;

  stats.forEach((stat) => {
    const internalName = normalizeStatName(stat.name, weaponData?.t);
    const isNeg = stat.value < 0;
    const fusionado = esFusionado(internalName, typeIdx);
    if (fusionado) hayFusionado = true;

    const rango = getRivenStatRange(weaponData, internalName, isNeg, buffCount, hasNeg);
    let min = NaN, max = NaN;
    if (rango) {
      const a = Math.abs(rango.min), b = Math.abs(rango.max);
      min = Math.min(a, b);
      max = Math.max(a, b);
    }
    const pos = posicionTirada({ valor: Math.abs(stat.projected), min, max, isNeg, fusionado, escala });
    const calidad = calidadStatEnArma({
      nombre: internalName,
      isPositive: !isNeg,
      typeIdx,
      niveles,
      pesos,
      sinDato: isNeg ? sinDatoNeg : sinDatoPos,
      generico,
    });
    if (calidad.estimada && generico) hayEstimadaGenerica = true;

    const def = RIVEN_STATS.find((s) => s.name_en === stat.name || normalizeStatName(s.name_en) === internalName);
    const nombre = def ? (isEs ? def.name_es : def.name_en) : getLocalizedStatName(internalName);
    const valorTxt = valorDelStat({ name: internalName, value: Math.abs(stat.value), isPositive: !isNeg }, typeIdx);
    const etiqueta = etiquetaDeCalidad(calidad.nivel, isEs);
    const nivelTxt = textoNivelTirada(pos, isNeg, calidad.nivel, fusionado, isEs);

    const row = document.createElement("div");
    const claseNivel = pos?.fuera ? "fuera" : (pos?.nivel || "nula");
    const atenuado = isNeg && calidad.nivel === "inofensiva" && pos !== null && !pos.fuera ? " tas-atenuado" : "";
    row.className = `tas-fila tas-${isNeg ? "neg" : "pos"} tas-cal-${calidad.nivel} tas-nivel-${claseNivel}${atenuado}`;

    const tagHtml = fusionado ? `<span class="tas-tag">${isEs ? "fusionado" : "spliced"}</span>` : "";
    const cabHtml = `<div class="tas-fila-cab"><span class="tas-nombre">${escapeHTML(nombre)}</span>${tagHtml}<span class="tas-valor">${escapeHTML(valorTxt)}</span><span class="tas-calidad">${calidad.estimada && calidad.nivel !== "sindato" ? "~" : ""}${escapeHTML(etiqueta)}</span></div>`;

    let medidorHtml = "";
    let pieHtml;
    if (pos !== null) {
      medidorHtml = `<div class="tas-medidor" role="img" aria-label="${escapeHTML(nivelTxt)}" style="--pos:${(pos.bondad * 100).toFixed(1)}%;--c1:${(pos.cortes[0] * 100).toFixed(1)}%;--c2:${(pos.cortes[1] * 100).toFixed(1)}%"><span class="tas-relleno"></span><span class="tas-corte tas-corte-1"></span><span class="tas-corte tas-corte-2"></span><span class="tas-marca"></span></div>`;
      const ext = (v) => valorDelStat({ name: internalName, value: Number((v / escala).toFixed(1)), isPositive: !isNeg }, typeIdx);
      const izq = ext(isNeg ? max : min);
      const der = ext(isNeg ? min : max);
      pieHtml = `<div class="tas-pie"><span class="tas-extremo">${escapeHTML(izq)}</span><span class="tas-nivel">${escapeHTML(nivelTxt)}</span><span class="tas-extremo">${escapeHTML(der)}</span></div>`;
    } else {
      pieHtml = `<div class="tas-pie"><span class="tas-nivel">${escapeHTML(nivelTxt)}</span></div>`;
    }

    row.innerHTML = `${cabHtml}${medidorHtml}${pieHtml}`;
    table.appendChild(row);
  });

  const leyenda = document.createElement("div");
  leyenda.className = "tas-leyenda";
  let leyendaHtml = `<span>${isEs ? "Barra: derecha = mejor para ti" : "Bar: right = better for you"}</span>`;
  if (hayEstimadaGenerica) {
    leyendaHtml += `<span>${isEs ? "~ Calidad estimada por tipo de arma, sin datos propios" : "~ Quality estimated from weapon type, no own data"}</span>`;
  }
  if (hayFusionado) {
    leyendaHtml += `<span>${isEs ? "Fusionado: calidad y tramos provisionales" : "Spliced: quality and roll bands are provisional"}</span>`;
  }
  leyenda.innerHTML = leyendaHtml;
  table.appendChild(leyenda);

  return table;
}

export function computeFairHigh(appraisal, bandQ, fair) {
  const statQ = Number.isFinite(appraisal?.statScore?.score) ? appraisal.statScore.score
    : (Number.isFinite(appraisal?.adjustedScore) ? appraisal.adjustedScore : null);
  let cap;
  if (statQ == null || statQ >= 75) cap = bandQ.p95;
  else if (statQ >= 55) cap = bandQ.p90;
  else if (statQ >= 35) cap = bandQ.p80;
  else cap = Math.round((bandQ.p50 || fair) * 1.5);
  const rawHigh = Math.max(bandQ.p95 || 0, appraisal.suggestedMax || 0, fair);
  return Math.max(fair, Math.min(rawHigh, Math.max(cap, Math.round(fair * 1.3))));
}

export function renderMlChip(estCard, prec, bandQ, isEs) {
  const el = estCard.querySelector("[data-ml-line]");
  if (!el) return;
  const nivel = nivelConfianza({ mape: prec?.mape, confianza: bandQ.confianza });
  const aviso = bandQ.aviso;
  const texto = nivel === "alta"
    ? (isEs ? "Confianza alta" : "High confidence")
    : nivel === "media"
      ? (isEs ? "Confianza media" : "Medium confidence")
      : nivel === "baja"
        ? (isEs ? "Confianza baja" : "Low confidence")
        : (isEs ? "Sin historial suficiente" : "Not enough history");
  const rotulo = rotuloBanda(bandQ.fuente, isEs);
  const alerta = bandQ.confianza === "baja" ? ' <b class="tas-alerta">!</b>' : "";
  const margen = Number.isFinite(prec?.mape) ? ` <span class="tas-margen">±${prec.mape}%</span>` : "";
  const avisoHtml = AVISO_BANDA[aviso]
    ? `<span class="tas-aviso">${AVISO_BANDA[aviso][isEs ? "es" : "en"]}</span>`
    : "";
  const detalle = (isEs
    ? `Cuánto suele desviarse la predicción del precio real en esta arma (medido con ventas que la IA no vio al entrenar). `
      + `${rotulo.largo}: venta rápida ~${bandQ.p25} platino · precio justo ~${bandQ.p50} platino · buen roll ~${bandQ.p80} platino · godroll ~${bandQ.p95} platino`
    : `How far the prediction typically lands from the real price on this weapon (measured on sales the AI never saw). `
      + `${rotulo.largo}: quick sale ~${bandQ.p25} platinum · fair price ~${bandQ.p50} platinum · good roll ~${bandQ.p80} platinum · godroll ~${bandQ.p95} platinum`)
    + (AVISO_BANDA[aviso] ? ` · ${AVISO_BANDA[aviso][isEs ? "es" : "en"]}` : "");
  el.setAttribute?.("data-tooltip", detalle);
  el.innerHTML = `${rotulo.corto}: ${pipsConfianza(nivel)}<b>${texto}</b>${alerta}${margen}${avisoHtml}`;
}

export function renderMarketChip(estCard, mk, isEs) {
  const el = estCard.querySelector("[data-market-line]");
  if (!el || !mk) return;
  const col = { meta: "#4ade80", bubble: "#f87171", illiquid: "#60a5fa", mid: "#cbd5e1", nodata: "#9ca3af" }[mk.flag] || "#cbd5e1";
  el.style.display = "inline-flex"; el.style.color = col;
  el.dataset.tooltip = mk.advice;
  const extras = [
    mk.vol ? `${mk.vol} ${isEs ? "anuncios/día" : "listings/day"}` : null,
    (mk.refFiable && mk.ratio >= 2)
      ? (isEs ? `piden ${mk.ratio}× lo que se paga` : `asking ${mk.ratio}× what gets paid`) + (fechaWfmRivens(isEs) ? ` (${fechaWfmRivens(isEs)})` : "") : null,
  ].filter(Boolean).join(" · ");
  el.innerHTML = `<span class="gsc-dot" style="background:${col}; box-shadow:0 0 6px ${col};"></span> <b>${mk.label}</b>${extras ? ` <span style="opacity:.85;">· ${extras}</span>` : ""}`;
}

export function parchearTasacion({ estCard, appraisal, weaponName, weaponData, meta, basePrice, precioTipico, itemAttributes, isEs, conComparables }) {
  const _w = meta || { name: weaponName, official_median: basePrice, wfm_avg: basePrice };
  return import("../../utils/rivens/riven_ml.js")
    .then(async (M) => {
      const bandQ = await M.predictRivenMLBand(_w, itemAttributes, weaponData, null, appraisal.adjustedScore);
      const mk = await M.getWeaponMarket(weaponName, _w);
      appraisal.mlEstimate = bandQ.p50;
      appraisal.mlBand = bandQ;
      try {
        const sc = await M.rivenScores(weaponName, itemAttributes);
        appraisal.statScore = sc.stat; appraisal.rollScore = sc.roll;
        const _gBadge = (g) => `<span class="gsc-mini-badge grade-${String(g || "f").toLowerCase()}">${g}</span>`;
        const _ss = estCard.querySelector("[data-stat-score] b");
        const _rs = estCard.querySelector("[data-roll-score] b");
        if (_ss) { _ss.innerHTML = meta ? `${sc.stat.score}% ${_gBadge(sc.stat.grade)}` : "—"; _ss.style.opacity = 1; }
        if (_rs) { _rs.innerHTML = `${sc.roll.score}% ${_gBadge(sc.roll.grade)}`; _rs.style.opacity = 1; }
      } catch (_e) {
        marcarChipsSinDato(estCard);
      }
      const _prec = (typeof M.weaponPrecision === "function") ? await M.weaponPrecision(weaponName) : null;
      const _h = appraisal.estimatedValue || 0, _m = bandQ.p50 || 0;
      const _ovr = Number.isFinite(appraisal.adjustedScore) ? appraisal.adjustedScore : (appraisal?.statScore?.score || 0);
      const { justo: _fair, pesoMl: _wMl } = precioJusto({
        heuristico: _h,
        ml: _m,
        mape: _prec?.mape,
        confianza: bandQ.confianza,
        puntuacion: _ovr,
        tipico: precioTipico != null ? basePrice : null,
      });
      const _low = Math.max(1, Math.min(bandQ.p25, appraisal.suggestedMin || bandQ.p25, _fair));
      const _high = computeFairHigh(appraisal, bandQ, _fair);
      appraisal.fairPrice = _fair; appraisal.fairLow = _low; appraisal.fairHigh = _high;
      pintarPrecio(estCard, _low, _fair, _high, isEs);
      console.log(`[ML fusion] ${weaponName}: heur=${_h} ml=${_m} wMl=${_wMl.toFixed(2)} -> fair=${_fair} [${_low}-${_high}]`);
      renderMlChip(estCard, _prec, bandQ, isEs);
      try {
        renderMarketChip(estCard, mk, isEs);
      } catch (e) {
        console.warn("[ML] mercado:", e);
      }

      if (conComparables) {
        // p30 of exact asks is close to the closing price, WFM buyouts are asks
        try {
          const _posN = itemAttributes.filter(a => a.isPositive).map(a => a.name);
          const _negN = itemAttributes.find(a => !a.isPositive)?.name || null;
          const { anchor } = await fetchSimilarRivens(weaponName, _posN, _negN, true);
          if (anchor && anchor.n >= 3 && appraisal.fairPrice > 0) {
            const _wC = Math.min(0.5, anchor.n * 0.08);
            const _adj = Math.round(Math.exp((1 - _wC) * Math.log(appraisal.fairPrice) + _wC * Math.log(anchor.price)));
            appraisal.fairPrice = _adj;
            appraisal.fairLow = Math.min(appraisal.fairLow, _adj);
            appraisal.fairHigh = Math.max(appraisal.fairHigh, anchor.median);
            pintarPrecio(estCard, appraisal.fairLow, _adj, appraisal.fairHigh, isEs);
            const _cEl = estCard.querySelector("[data-comp-line]");
            if (_cEl) {
              _cEl.style.display = "inline-flex"; _cEl.style.color = "#4ade80"; _cEl.style.cursor = "pointer";
              _cEl.title = isEs
                ? `Ahora mismo hay ${anchor.n} rivens a la venta con este mismo combo de stats. Los más baratos piden ~${anchor.price} platino (lo habitual es ${anchor.median} platino). Tu tasación se ajusta a estos precios reales del mercado. Toca para ver los listados.`
                : `Right now there are ${anchor.n} rivens for sale with this exact stat combo. The cheapest ask ~${anchor.price} platinum (typical ask is ${anchor.median} platinum). Your appraisal is adjusted to these real market prices. Tap to see the listings.`;
              _cEl.innerHTML = `${isEs ? "En venta ahora" : "On sale now"}: <b>${isEs ? "desde" : "from"} ~${anchor.price}${PLAT}</b> <span style="opacity:.6;">(${anchor.n} ${isEs ? "iguales" : "same"}) ${isEs ? "· toca para ver" : "· tap to view"}</span>`;
              onTap(_cEl, () => {
                const _btn = document.getElementById("btn-search-similar-rivens");
                const _c = document.getElementById("similar-rivens-container");
                if (_btn) {
                  if (!_btn.disabled) _btn.click();
                  if (_c) setTimeout(() => _c.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
                } else {
                  window.open(`https://warframe.market/auctions/search?type=riven&weapon_url_name=${getRivenSlug(weaponName)}&sort_by=price_asc`, "_blank", "noopener");
                }
              });
            }
            console.log(`[Comparables] ${weaponName}: fair=${_adj} ancla=${anchor.price}p n=${anchor.n} w=${_wC.toFixed(2)}`);
          }
        } catch (_e) {}
      }
    })
    .catch(e => {
      console.warn("[ML] error:", e);
      marcarChipsSinDato(estCard);
      const _fp = estCard?.querySelector?.("[data-fair-price]");
      if (_fp?.textContent === "…") _fp.textContent = "—";
      const _ml = estCard?.querySelector?.("[data-ml-line]");
      if (_ml) _ml.innerHTML = `${pipsConfianza(null)}<span>${isEs ? "Confianza no disponible" : "Confidence unavailable"}</span>`;
    });
}

export function generateRollResultsDOM(roll, weaponData, weaponName, currentRank, scaleFactor) {
  const isEs = state.currentLang === "es";
  const stats = roll.stats.map(s => ({
    name: s.name,
    value: s.value,
    projected: s.value * scaleFactor
  }));
  const buffCount = stats.filter((s) => s.value > 0).length;
  const hasNeg = stats.some((s) => s.value < 0);

  const meta = getMetaStats(weaponData?.name || weaponName, weaponData?.t);

  const statsCol = document.createElement("div");
  statsCol.className = "results-stats-col";
  statsCol.appendChild(buildStatsTable(stats, weaponData, buffCount, hasNeg, isEs, { meta, weaponName, escala: scaleFactor }));

  const desirabilityMultiplier = computeDesirabilityMultiplier(stats, meta, weaponData);
  const { basePrice, precioTipico } = precioBaseDeArma(meta);
  const demanda = demandaDeArma(meta);
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

  const { tier, tierColor } = tierDeScore(appraisal.adjustedScore);

  const estCard = document.createElement("div");
  estCard.className = "grade-summary-card gsc";

  const warningHtml = buildAppraisalWarningsHtml({ appraisal, desirabilityMultiplier, stats, priceCalculated: appraisal.estimatedValue, isEs });
  estCard.innerHTML = buildAppraisalCardHTML({
    tier,
    tierColor,
    priceCalculated: appraisal.estimatedValue,
    minPrice: appraisal.suggestedMin,
    maxPrice: appraisal.suggestedMax,
    finalScore: appraisal.adjustedScore,
    demanda,
    precioTipico,
    warningHtml,
    isEs,
    withSimilarButton: false,
    histLoading: !!(state.currentWeaponHistory?.weaponName === weaponName && state.currentWeaponHistory.loading)
  });
  estCard.insertAdjacentHTML("beforeend", cicloRivenHtml({ stats, meta, tipo: weaponData?.t || meta?.t, deseados: statsBuscadosDelArma(meta, weaponName), rolls: roll.rolls, isEs }));
  parchearTasacion({ estCard, appraisal, weaponName, weaponData, meta, basePrice, precioTipico, itemAttributes, isEs, conComparables: false });

  const wrapper = document.createElement("div");
  wrapper.style = "display: flex; flex-direction: column; gap: 12px; width: 100%;";
  wrapper.appendChild(estCard);
  wrapper.appendChild(statsCol);

  return wrapper;
}
