// EXPERIMENTAL — tasación por el modelo XGBoost destilado (slim) corriendo en el navegador.
// NO sustituye a calculateAdvancedPredictivePrice (la tasación actual): es una vía paralela
// para comparar el "pensamiento combinatorio" del modelo contra la heurística JS.
//
// El modelo (model_trees_slim.json, ~0.33MB gzip) se carga PEREZOSAMENTE la primera vez que se
// tasa un riven, así que no afecta al arranque (apto PC y móvil). El predictor recorre los árboles
// (JS puro, sin WASM) — verificado idéntico a XGBoost (parity max |diff| 4e-6).

import { classifyWeaponMarket } from "./riven_logic.js";
import { state } from "../state.js";

let _ml = null;
let _loading = null;

// Parsea un modelo XGBoost (formato save_model json) a {baseScore, trees} para recorrer en JS.
function _parseModel(model) {
  const lrn = model.learner;
  let baseScore = lrn.learner_model_param.base_score;
  baseScore = Array.isArray(baseScore) ? +baseScore[0] : parseFloat(String(baseScore).replace(/[[\]]/g, ""));
  const trees = lrn.gradient_booster.model.trees.map(t => ({
    si: t.split_indices, sc: t.split_conditions,
    L: t.left_children, R: t.right_children, dl: t.default_left,
  }));
  return { baseScore, trees };
}

export async function loadRivenML() {
  if (_ml) return _ml;
  if (_loading) return _loading;
  _loading = (async () => {
    const base = "assets/ml/";
    const [qbundle, order, defaults, bands, statWeights, cal, single] = await Promise.all([
      fetch(base + "model_quantiles_slim.json").then(r => r.json()).catch(() => null), // banda p25..p95
      fetch(base + "feature_order_slim.json").then(r => r.json()),
      fetch(base + "feature_defaults_slim.json").then(r => r.json()),
      fetch(base + "price_bands.json").then(r => r.json()).catch(() => ({})),     // banda histórica por arma
      fetch(base + "stat_weights.json").then(r => r.json()).catch(() => ({})),    // pesos pos/neg por arma
      fetch(base + "calibracion_por_arma.json").then(r => r.json()).catch(() => ({})), // drift/synlo/nsamp
      fetch(base + "model_trees_slim.json").then(r => r.json()).catch(() => null), // fallback modelo único
    ]);
    const idx = {};
    order.forEach((n, i) => { idx[n] = i; });

    let quantiles, qmodels;
    if (qbundle && qbundle.models) {
      quantiles = qbundle.quantiles || Object.keys(qbundle.models).map(Number).sort((a, b) => a - b);
      qmodels = {};
      for (const a of quantiles) qmodels[a] = _parseModel(qbundle.models[String(a)]);
    } else if (single) {
      // Fallback: modelo de PUNTO antiguo -> se trata como único cuantil p50.
      quantiles = [0.5]; qmodels = { 0.5: _parseModel(single) };
    } else {
      quantiles = []; qmodels = {};
    }
    _ml = {
      quantiles, qmodels, order, defaults, idx,
      bands: bands || {}, statWeights: statWeights || {},
      cal: cal || {}, drift: (cal && cal.drift) || {}, synlo: (cal && cal.synlo) || {}, nsamp: (cal && cal.nsamp) || {},
    };
    return _ml;
  })();
  return _loading;
}

// Busca un valor en una tabla por arma tolerando mayúsculas/espacios.
function _byWeapon(table, weaponName) {
  if (!table || weaponName == null) return undefined;
  if (table[weaponName] != null) return table[weaponName];
  const nl = String(weaponName).toLowerCase();
  const k = Object.keys(table).find(x => x.toLowerCase() === nl);
  return k ? table[k] : undefined;
}

// Clasifica el MERCADO del arma (meta/burbuja/ilíquido/medio) cruzando los asks vivos (meta.wfm_avg)
// con el precio central robusto servido (band.typical = mediana histórica 1 mes) + liquidez/momentum.
// Resuelve la banda del arma desde price_bands.json y delega en classifyWeaponMarket.
export async function getWeaponMarket(weaponName, meta) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let band = bands[weaponName];
  if (!band) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    band = k ? bands[k] : null;
  }
  return classifyWeaponMarket(meta || (band ? { official_median: band.typical } : null), band);
}

// Califica un riven SEGÚN EL ARMA: cada positivo por lo POPULAR que es en esa arma, y cada negativo
// por cuánto la ARRUINA (una negativa que es un stat top del arma es ruinosa; una irrelevante es
// inofensiva). Usa los pesos data-driven por arma (stat_weights.json, percentiles del histórico),
// con fallback al prior global. Devuelve nota por stat + score 0-100 + grado.
export async function gradeRiven(weaponName, stats) {
  const ml = await loadRivenML();
  const sw = ml.statWeights || {};
  const W = sw[weaponName] || {};
  const base = sw.__baseline || {};
  const lookup = (table, name) => {
    if (!table) return undefined;
    if (table[name] != null) return table[name];
    const nl = name.toLowerCase();
    const k = Object.keys(table).find(x => x.toLowerCase() === nl);
    return k ? table[k] : undefined;
  };
  const posTier = (w) => w >= 0.75 ? "S" : w >= 0.45 ? "A" : w >= 0.15 ? "B" : "F";
  const isEs = state.currentLang === "es";
  const negLabel = (b) => isEs
    ? (b >= 0.70 ? "RUINOSA" : b >= 0.40 ? "MEDIA" : "INOFENSIVA")
    : (b >= 0.70 ? "RUINOUS" : b >= 0.40 ? "AVERAGE" : "HARMLESS");

  const out = [];
  const posW = [];
  let negFactor = 1;
  for (const s of stats) {
    if (s.isPositive) {
      const w = lookup(W.pos, s.name) ?? lookup(base.pos, s.name) ?? 0.30;
      posW.push(w);
      out.push({ name: s.name, isPositive: true, weight: +w.toFixed(2), tier: posTier(w), popular: w >= 0.45 });
    } else {
      // DAÑO de una negativa = lo valiosa que es ESE stat como POSITIVO en esta arma.
      // Perder un stat top (CC/CD/Multishot) arruina; un stat irrelevante (Zoom, Recoil, facción)
      // como negativa es inofensivo. (No usamos el peso "neg" del histórico: está confundido por
      // el precio — las negativas inofensivas salen en godrolls caros y darían daño alto erróneo.)
      const nl = s.name.toLowerCase();
      const harmless = /zoom|recoil|\bto |vs |faction/.test(nl); // negativas universalmente inofensivas
      let b = harmless ? 0.05 : (lookup(W.pos, s.name) ?? lookup(base.pos, s.name) ?? 0.30);
      b = Math.max(0.05, Math.min(1, b));
      negFactor *= (1 - 0.6 * b);
      out.push({ name: s.name, isPositive: false, badness: +b.toFixed(2), label: negLabel(b) });
    }
  }
  // score: media de positivos (ponderada al mejor) × penalización por negativas.
  const posAvg = posW.length ? (posW.reduce((a, b) => a + b, 0) / posW.length) : 0;
  const best = posW.length ? Math.max(...posW) : 0;
  const score = Math.round(Math.max(0, Math.min(100, (0.6 * posAvg + 0.4 * best) * negFactor * 100)));
  const grade = score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "F";
  return { weapon: weaponName, score, grade, stats: out };
}

// Precisión del modelo POR ARMA (horneada en el entrenamiento: MAPE del p50 en test held-out).
// Devuelve {mape, grade, n} o null si no hay dato. grade: alta <40% · media 40-80% · baja >80%/sin datos.
export async function weaponPrecision(weaponName) {
  const ml = await loadRivenML();
  const prec = (ml.cal && ml.cal.precision) || {};
  const rec = _byWeapon(prec, weaponName);
  if (!rec) return null;
  const mape = Math.round(rec.mape != null ? rec.mape : rec);
  const grade = mape < 40 ? (state.currentLang === "es" ? "alta" : "high")
    : mape < 80 ? (state.currentLang === "es" ? "media" : "medium")
      : (state.currentLang === "es" ? "baja" : "low");
  return { mape, grade, n: rec.n || null };
}

// DOS SCORES independientes para un riven:
//   stat  = CALIDAD POR STATS (meta): qué stats tiene y cómo de buscados son en ESTA arma (gradeRiven).
//           No mira magnitud. Un CC/CD es alto aunque haya rolleado bajo.
//   roll  = CALIDAD DEL ROLL (magnitud): cuánto rolaron los valores dentro de su rango posible.
//           No mira meta. Un roll perfecto de stats malos tiene roll alto pero stat bajo.
// itemAttributes: [{name, value, isPositive, minIdeal, maxIdeal}, ...]
export async function rivenScores(weaponName, itemAttributes) {
  const g = await gradeRiven(weaponName, itemAttributes);   // meta (stats)
  const _grade = (s) => s >= 85 ? "S" : s >= 70 ? "A" : s >= 50 ? "B" : s >= 30 ? "C" : "F";
  // ROLL (magnitud): posición del valor en su rango posible [minIdeal, maxIdeal].
  const rollPerStat = [];
  const posPcts = [];
  for (const a of itemAttributes) {
    const v = Math.abs(a.value || 0), lo = Math.abs(a.minIdeal || 0), hi = Math.abs(a.maxIdeal || 0);
    let pct = hi > lo ? (v - lo) / (hi - lo) : (v > 0 ? 1 : 0);
    pct = Math.max(0, Math.min(1, pct));
    rollPerStat.push({ name: a.name, isPositive: !!a.isPositive, pct: Math.round(pct * 100) });
    if (a.isPositive) posPcts.push(pct);
  }
  const rollScore = posPcts.length ? Math.round(posPcts.reduce((x, y) => x + y, 0) / posPcts.length * 100) : 0;
  return {
    weapon: weaponName,
    stat: { score: g.score, grade: g.grade, perStat: g.stats },       // meta por stats
    roll: { score: rollScore, grade: _grade(rollScore), perStat: rollPerStat }, // magnitud del roll
  };
}

// Tasación anclada a VENTAS REALES de DE (no a los asks). El precio sale de posicionar la CALIDAD del
// roll (score, que lee magnitud) sobre la DISTRIBUCIÓN REAL de DE (de_rerolled: median/max/floor):
//   - score<=0.5: floor (trash) -> mediana real.
//   - score>0.5 : mediana -> máx real con curva CONVEXA (frac²) que capta el sesgo propio del arma
//     (max/median): mid rolls cerca de la mediana, godrolls escalan hacia el máximo realmente vendido.
// El `list` (precio de LISTAR) se calcula de los deciles de ASKS (price_bands.json) solo para el tooltip,
// porque los asks superan a las ventas reales ~8-11× (Acceltra med 84 vs asks 844). Ver informe.
export async function mlBandEstimate(weaponName, itemAttributes, scoreOverride = null, de = null) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let b = bands[weaponName];
  if (!b) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    b = k ? bands[k] : null;
  }
  // score 0-100: usa el override (la nota mostrada, que SÍ lee magnitud) si viene; si no, gradeRiven.
  const g = await gradeRiven(weaponName, itemAttributes);
  const score = (scoreOverride != null && Number.isFinite(scoreOverride)) ? scoreOverride : g.score;
  const s = Math.max(0, Math.min(1, (score || 0) / 100));

  // VENTA real desde la distribución de DE
  const med = (de && de.median > 0) ? de.median : (b ? b.typical : 50);
  let mx = (de && de.max > med) ? de.max : med * 10;
  if (b && b.ceiling > med) {
    mx = Math.min(mx, b.ceiling);
  } else {
    mx = Math.min(mx, med * 8); // cap raw outlier DE max at 8x median
  }
  const floor = (de && de.floor > 0) ? de.floor : Math.round(med * 0.5);
  let sale;
  if (s <= 0.5) {
    sale = Math.round(floor + (med - floor) * (s / 0.5));
  } else {
    const frac = (s - 0.5) / 0.5;
    const skew = Math.max(1.2, mx / med);            // cuán amplio es el rango real del arma
    sale = Math.round(med * Math.pow(skew, Math.pow(frac, 1.5)));
  }
  sale = Math.max(floor, sale);

  // LIST (ask): posición del score en los deciles de asks, solo informativo
  let list = sale;
  const q = b && Array.isArray(b.q) && b.q.length === 9 ? b.q : null;
  if (q) {
    const hi = Math.max(b.ceiling, q[8]);
    if (s <= 0.1) list = Math.round(b.floor + (q[0] - b.floor) * (s / 0.1));
    else if (s >= 0.9) list = Math.round(q[8] + (hi - q[8]) * ((s - 0.9) / 0.1));
    else { const pos = (s - 0.1) / 0.1, i = Math.floor(pos), f = pos - i; list = Math.round(q[i] + (q[Math.min(8, i + 1)] - q[i]) * f); }
  }
  return { price: sale, list, floor, median: med, max: mx, score: Math.round(score), grade: g.grade };
}

// Banda de precio ROBUSTA anclada a datos reales (DE) + histórico, inmune a outliers de un día.
// floor   = mediana histórica de official_median (DE unrolled real)  -> suelo estable
// typical = rerolled median de DE (si es sano y con volumen) o floor × premium histórico
// ceiling = typical × factor generoso pero ACOTADO (godrolls suben, pero sin récords troll)
// Si falta histórico/volumen, cae a los datos de hoy y, en última instancia, a múltiplos del floor.
export function robustPriceBand(weapon, history) {
  // FLOOR y TYPICAL salen del DATO REAL EN VIVO del endpoint (/api/rivens) por arma — siempre fresco,
  // automático. El CEILING (godroll) usa el histórico acumulado (price_bands.json), que necesita todo
  // el dataset. NO se usa el p15 de los listados WFM como suelo (en armas meta está inflado).
  const served = (_ml && _ml.bands && weapon) ? _ml.bands[weapon.name] : null;
  const days = Array.isArray(history?.data) ? history.data
    : (Array.isArray(history) ? history : []);
  const median = (arr) => {
    const v = arr.filter(x => typeof x === "number" && x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
  };
  const deUn = weapon?.de_unrolled || {};
  const deRe = weapon?.de_rerolled || {};

  // FLOOR = precio REAL de DE en vivo (official_median); respaldos: histórico /api/history, unrolled, served.
  let floor = (weapon && weapon.official_median > 0 ? weapon.official_median : 0)
    || median(days.map(d => d.official_median)) || deUn.median || (served && served.floor) || 15;

  // TYPICAL = rerolled real de DE en vivo (si sano y con volumen); si no, premium histórico o served.
  let typical;
  if (deRe.median > 0 && deRe.median >= floor && (deRe.pop || 0) >= 1) {
    typical = deRe.median;
  } else {
    const histPrem = median(days.map(d => d.rerolled_premium_ratio).filter(x => x > 1.05));
    typical = histPrem > 1 ? Math.round(floor * histPrem)
      : (served && served.typical > floor ? served.typical : Math.round(floor * 1.7));
  }
  if (typical < floor) typical = Math.round(floor * 1.5);

  // CEILING (godroll) = histórico acumulado (served = p88 WFM winsorizado); si no, múltiplo acotado.
  let ceiling = (served && served.ceiling > typical) ? served.ceiling : 0;
  if (!ceiling) {
    ceiling = typical * 5;
    const obsMax = Math.max(deUn.max_price || 0, deRe.max_price || 0, median(days.map(d => d.web_max)) || 0);
    if (obsMax > typical) ceiling = Math.max(ceiling, typical + (obsMax - typical) * 0.35);
    ceiling = Math.min(ceiling, typical * 8);
  }
  ceiling = Math.max(ceiling, typical * 3);

  return { floor: Math.round(floor), typical: Math.round(typical), ceiling: Math.round(ceiling) };
}

// Recorre los árboles de UN modelo (cuantil) y suma las hojas (igual que XGBoost).
function rawPredictModel(model, x) {
  let sum = model.baseScore;
  for (const t of model.trees) {
    let n = 0;
    while (t.L[n] !== -1) {
      const v = x[t.si[n]];
      n = (v === undefined || Number.isNaN(v))
        ? (t.dl[n] ? t.L[n] : t.R[n])
        : (v < t.sc[n] ? t.L[n] : t.R[n]);
    }
    sum += t.sc[n]; // valor de hoja
  }
  return sum;
}

const MODEL_STAT_MAP = {
  "Damage": "Base Damage / Melee Damage",
  "Melee Damage": "Base Damage / Melee Damage",
  "Base Damage": "Base Damage / Melee Damage",
  "Fire Rate": "Fire Rate / Attack Speed",
  "Attack Speed": "Fire Rate / Attack Speed",
  "Fire Rate / Attack Speed": "Fire Rate / Attack Speed",
  "Toxin": "Toxin Damage",
  "Heat": "Heat Damage",
  "Electric": "Electric Damage",
  "Cold": "Cold Damage",
  "Impact": "Impact Damage",
  "Puncture": "Puncture Damage",
  "Slash": "Slash Damage",
  "Damage to Grineer": "Damage Vs Grineer",
  "Damage to Corpus": "Damage Vs Corpus",
  "Damage to Infested": "Damage Vs Infested",
  "Slide Attack Critical Chance": "Critical Chance On Slide Attack",
  "Slide Crit Chance": "Critical Chance On Slide Attack",
};

/**
 * Construye el vector de 88 features para un riven y devuelve el precio estimado (pl) por el modelo.
 * Las features que el front no aporta se rellenan con la mediana de entrenamiento (feature_defaults).
 * @param {Object} weapon  objeto del arma (/api/rivens): official_median, wfm_avg, dynamic_weights, ...
 * @param {Array}  itemAttributes  [{name, value, isPositive, minIdeal, maxIdeal}, ...]
 * @param {Object} [weaponData]  datos extra (disposition, type, dynamic_weights)
 * @param {number} [rerolls]
 * @returns {Promise<number>} precio estimado en pl
 */
// Construye el vector de features + devuelve señales auxiliares (synergy) para la banda/confianza.
async function buildFeatureVector(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const ml = await loadRivenML();
  // arranca con defaults (medianas) y sobreescribe lo conocido
  const vec = ml.order.map(n => (typeof ml.defaults[n] === "number" ? ml.defaults[n] : 0));
  const set = (name, val) => {
    const i = ml.idx[name];
    if (i !== undefined && typeof val === "number" && Number.isFinite(val)) vec[i] = val;
  };
  const wfm = weapon.wfm_avg ?? weapon.wfm_avg_price;
  const ofmv = weapon.official_median || 0;
  const deRe = weapon.de_rerolled || (weaponData && weaponData.de_rerolled) || {};

  set("official_median", weapon.official_median);
  set("wfm_avg", wfm);
  set("official_median_missing", weapon.official_median > 0 ? 0 : 1);
  set("wfm_avg_missing", wfm > 0 ? 0 : 1);
  set("popularity_pct", weapon.popularity_pct);
  set("wfm_market_sample", weapon.wfm_market_sample);
  set("liquidity_score", weapon.liquidity_score);
  set("rerolled_premium_ratio", weapon.rerolled_premium_ratio);
  // features nuevas curadas (de de_rerolled + ratios); si el arma no las trae -> quedan en default
  const reMed = deRe.median || 0, reMax = deRe.max_price || 0;
  set("re_pop", deRe.pop);
  set("re_std", deRe.stddev);
  set("re_med", reMed);
  set("re_max", reMax);
  set("wfm_vs_off", (wfm || 0) / (ofmv + 1));
  set("ceil_mult", reMax / (reMed + 1));
  // history del día: en el front (sin fecha) se asume día normal -> drift/ratios neutros = 1
  set("hist_day_drift", 1.0);
  set("hist_day_offdrift", 1.0);
  set("hist_day_rerprem", 1.0);
  // legacy (se ignoran si no están en feature_order nuevo)
  set("volatility_index", weapon.volatility_index);
  set("trend_7d_pct", weapon.trend_7d_pct);
  set("web_min", weapon.web_min);
  set("web_max", weapon.web_max);

  // Populate historical data features if state and history data are loaded.
  // Comparación tolerante (trim + case): el === estricto descartaba el historial en silencio.
  const _wName = String(weapon.name || weapon.weaponName || "").trim().toLowerCase();
  const histData = (typeof state !== "undefined" && state.currentWeaponHistory && _wName
    && String(state.currentWeaponHistory.weaponName || "").trim().toLowerCase() === _wName)
    ? state.currentWeaponHistory.data : null;
  if (histData && histData.length > 0) {
    const getMedian = (arr) => {
      const sorted = arr.filter(x => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
      return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    };
    const getAvg = (arr) => {
      const filtered = arr.filter(x => typeof x === "number" && !Number.isNaN(x));
      return filtered.length ? (filtered.reduce((a, b) => a + b, 0) / filtered.length) : null;
    };
    const getMax = (arr) => {
      const filtered = arr.filter(x => typeof x === "number" && !Number.isNaN(x));
      return filtered.length ? Math.max(...filtered) : null;
    };

    const histOfficial = getMedian(histData.map(d => d.official_median));
    const histWfm = getMedian(histData.map(d => d.wfm_avg ?? d.wfm_avg_price));
    const histLiq = getAvg(histData.map(d => d.liquidity_score));
    const histVol = getMax(histData.map(d => d.volatility_index));
    const histPrem = getMedian(histData.map(d => d.rerolled_premium_ratio));
    const histTrend = getMedian(histData.map(d => d.trend_7d_pct));

    if (histOfficial !== null) set("hist_current_official", histOfficial);
    if (histWfm !== null) set("hist_current_wfm", histWfm);
    if (histLiq !== null) set("hist_liquidity_avg", histLiq);
    if (histVol !== null) set("hist_volatility_max", histVol);
    if (histPrem !== null) set("hist_rerolled_premium", histPrem);
    if (histTrend !== null) set("hist_trend_7d", histTrend);
  }

  // synergy_score (misma idea que el entrenamiento): suma de pesos meta de los positivos.
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  const dwKey = (name) => {
    const nl = name.toLowerCase();
    return Object.keys(dw).find(k => k.toLowerCase() === nl);
  };
  let synergy = 0;
  const posMags = [];
  let hasNegCurse = 0;
  let negPenalty = 1.0;

  for (const a of itemAttributes) {
    const name = a.name;
    if (a.isPositive) {
      const k = dwKey(name);
      synergy += k ? (parseFloat(dw[k]) || 0.05) : 0.05;
      
      let modelName = MODEL_STAT_MAP[name] || name;
      if (name === "Chance not to gain Combo") {
        modelName = "Chance To Gain Extra Combo Count";
      }
      set("has_pos_stat_" + modelName, 1);

      const maxVal = a.maxIdeal || 1;
      posMags.push(a.value / maxVal);
    } else {
      hasNegCurse = 1;
      const nl = name.toLowerCase();
      const harmless = /zoom|recoil|\bto |vs |faction/.test(nl);
      const k = dwKey(name);
      let b = harmless ? 0.05 : (k ? (parseFloat(dw[k]) || 0.30) : 0.30);
      b = Math.max(0.05, Math.min(1.0, b));
      negPenalty *= (1.0 - 0.6 * b);

      let modelName = MODEL_STAT_MAP[name] || name;
      if (name === "Chance not to gain Combo") {
        modelName = "Chance To Gain Combo Count";
      }
      set("has_neg_stat_" + modelName, 1);
    }
  }
  const numPos = itemAttributes.filter(a => a.isPositive).length;
  set("synergy_score", Number(synergy.toFixed(4)));
  set("has_neg", hasNegCurse);
  set("num_pos", numPos);
  set("has_mag", posMags.length > 0 ? 1 : 0);
  set("neg_penalty_factor", Number(negPenalty.toFixed(4)));  // legacy (ignorado si no está)

  // interacciones (si están en feature_order nuevo)
  set("popularity_pct_x_synergy", (weapon.popularity_pct || 0) * synergy);
  set("pop_x_synergy", (weapon.popularity_pct || 0) * synergy);
  const dispo = (weaponData && weaponData.disposition) || weapon.disposition;
  if (dispo) { set("disposition", dispo); set("dispo_x_synergy", dispo * synergy); }

  // SEÑAL META (misma fórmula que el entrenamiento): la dispo baja la pone DE a las armas más
  // usadas; si además la mediana es alta Y estable en el historial, es arma meta asentada y sus
  // rivens cotizan caro de forma sostenida. meta_signal = (2-dispo) * log1p(mediana) * consistencia.
  let _cons = null;
  if (histData && histData.length >= 5) {
    const _offs = histData.map(d => d.official_median).filter(v => Number.isFinite(v) && v > 0);
    if (_offs.length >= 5) {
      const _mu = _offs.reduce((a, b) => a + b, 0) / _offs.length;
      const _sd = Math.sqrt(_offs.reduce((a, b) => a + (b - _mu) * (b - _mu), 0) / _offs.length);
      _cons = 1 / (1 + (_mu > 0 ? _sd / _mu : 1));
    }
  }
  if (_cons !== null) set("median_consistency", _cons);
  if (dispo && _cons !== null && ofmv > 0) set("meta_signal", (2 - dispo) * Math.log1p(ofmv) * _cons);

  // Magnitudes normalizadas del roll
  set("mag_pos1_norm", posMags[0] !== undefined ? posMags[0] : 0.85);
  set("mag_pos2_norm", posMags[1] !== undefined ? posMags[1] : 0.85);
  set("mag_pos3_norm", posMags[2] !== undefined ? posMags[2] : 0.85);
  if (posMags.length > 0) {
    const posAvgMag = posMags.reduce((a, b) => a + b, 0) / posMags.length;
    set("mag_pos_avg", posAvgMag);
  }

  const ofm = weapon.official_median || 100;
  set("rerolls", rerolls);
  set("fatigue_index", rerolls / (ofm + 1));

  return { ml, vec, synergy, numPos, hasNeg: hasNegCurse };
}

// Tasación por BANDA de cuantiles: devuelve {p25,p50,p80,p90,p95} en pl, anclada al mercado de cada
// arma (drift del history) y con flag de CONFIANZA. El p50 es el "precio justo"; p25 venta rápida;
// p80/p90/p95 techo godroll (precio REAL de mercado, no asks especulativos).
export async function predictRivenMLBand(weapon, itemAttributes, weaponData = null, rerolls = 0, scoreOverride = null) {
  const { ml, synergy } = await buildFeatureVector(weapon, itemAttributes, weaponData, rerolls);
  const wname = weapon.name || weapon.weaponName;
  const qs = ml.quantiles && ml.quantiles.length ? ml.quantiles : [0.25, 0.5, 0.8, 0.9, 0.95];
  const drift = _byWeapon(ml.drift, wname) || 1.0;

  // CALIDAD del roll 0..1: el score mostrado (adjustedScore, lee magnitud y sabe que CC/CD es top)
  // si viene; si no, gradeRiven (pesos por arma). NO se usa el ranking en asks del modelo: los asks
  // están comprimidos/inflados y distorsionan (un CC/CD salía "trash"). El score es la señal fiable.
  let scoreVal = scoreOverride;
  if (!Number.isFinite(scoreVal)) { const g = await gradeRiven(wname, itemAttributes); scoreVal = g.score; }
  const s = Math.max(0, Math.min(1, (scoreVal || 0) / 100));

  // === NIVEL anclado a VENTAS REALES de DE (no asks). El modelo/entrenamiento van sobre ASKS de WFM,
  // inflados ~3-20× en armas meta -> subvaloran/ sobrevaloran. Mapeamos la CALIDAD (score) sobre la
  // distribución REAL de DE: mediana = venta típica, max = techo godroll real. Convexo arriba.
  const b = _byWeapon(ml.bands, wname);
  const deRe = weapon.de_rerolled || (weaponData && weaponData.de_rerolled) || {};
  const deUn = weapon.de_unrolled || (weaponData && weaponData.de_unrolled) || {};
  const usaDE = (deRe.median > 0 || deUn.median > 0);
  const deMed = usaDE ? (deRe.median > 0 ? deRe.median : deUn.median) : (b ? b.typical : 50);
  let deMax = (deRe.max_price || deRe.max || 0);
  deMax = deMax > deMed ? Math.min(deMax, deMed * 25) : deMed * 8;    // techo godroll real, acotado
  const deFloor = Math.max(1, Math.round(Math.min(deMed, deUn.median || deMed) * 0.45));
  const levelMap = (f) => {   // f(0..1) calidad -> precio de venta real
    if (f <= 0.5) return deFloor + (deMed - deFloor) * (f / 0.5);
    // s>0.5: mediana -> máx real, casi lineal en log (exp 1.05) para que un roll BUENO (no solo el
    // godroll perfecto) escale de verdad hacia el techo y no se quede pegado a la mediana (trash-heavy).
    const fr = (f - 0.5) / 0.5, skew = Math.max(1.3, deMax / deMed);
    return deMed * Math.pow(skew, Math.pow(fr, 1.05));
  };

  // ajustes multiplicativos. OJO: la negativa mala YA la penaliza el SCORE (un -Multishot en Torid
  // tira el score a ~9%), así que NO se vuelve a multiplicar por BRICK aquí (era doble castigo y
  // aplanaba la banda al floor). Solo se marca esBrick para el label. Se mantiene el premio 0-roll.
  let mult = 1.0;
  const neg = itemAttributes.find(a => !a.isPositive);
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  const BRICK = new Set(["Critical Chance", "Critical Damage", "Base Damage / Melee Damage", "Multishot", "Fire Rate / Attack Speed"]);
  let esBrick = false;
  if (neg) {
    const nm = MODEL_STAT_MAP[neg.name] || neg.name;
    const wneg = parseFloat(dw[Object.keys(dw).find(k => k.toLowerCase() === nm.toLowerCase())] || 0);
    esBrick = BRICK.has(nm) || wneg >= 0.6;
  }
  if (Number(rerolls) === 0) mult *= 1.25;

  // La banda p25..p95 = el score posicionado ± dispersión (rango de precio del propio roll).
  const OFF = { 0.25: -0.12, 0.50: 0.0, 0.80: 0.10, 0.90: 0.15, 0.95: 0.20 };
  const floor = deFloor;
  const out = {};
  for (const a of qs) {
    const f = Math.max(0, Math.min(1, s + (OFF[a] != null ? OFF[a] : 0)));
    out[a] = Math.max(floor, Math.round(levelMap(f) * mult));
  }
  // orden no decreciente por si el redondeo/clamp cruza
  let prev = 0;
  for (const a of qs) { out[a] = Math.max(out[a], prev); prev = out[a]; }

  // CONFIANZA: baja si el roll es de gama baja (score <= p30 del arma) o el arma tiene pocos datos.
  const synlo = _byWeapon(ml.synlo, wname);
  const nsamp = _byWeapon(ml.nsamp, wname) || 0;
  const esTrash = (synlo != null) && (synergy <= synlo);
  const lowConf = esTrash || nsamp < 40;
  const p = (a) => out[a] != null ? out[a] : out[0.5];
  return {
    p25: p(0.25), p50: p(0.5), p80: p(0.8), p90: p(0.9), p95: p(0.95),
    price: p(0.5), floor, drift: +drift.toFixed(3),
    confianza: lowConf ? "baja" : "alta",
    aviso: lowConf
      ? (esTrash ? "Roll de gama baja: precio orientativo (usa la banda, no el valor único)."
        : "Pocos datos del arma: precio orientativo.")
      : null,
    regla: esBrick ? "BRICK" : (Number(rerolls) === 0 ? "0roll" : "q"),
  };
}

// Compat: precio único = p50 de la banda de cuantiles.
export async function predictRivenMLPrice(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const band = await predictRivenMLBand(weapon, itemAttributes, weaponData, rerolls);
  return band.p50;
}
