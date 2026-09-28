import { classifyWeaponMarket } from "./riven_logic.js";
import { state } from "../../state.js";

let _ml = null;
let _loading = null;

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
      fetch(base + "model_quantiles_slim.json").then(r => r.json()).catch(() => null),
      fetch(base + "feature_order_slim.json").then(r => r.json()),
      fetch(base + "feature_defaults_slim.json").then(r => r.json()),
      fetch(base + "price_bands.json").then(r => r.json()).catch(() => ({})),
      fetch(base + "stat_weights.json").then(r => r.json()).catch(() => ({})),
      fetch(base + "calibracion_por_arma.json").then(r => r.json()).catch(() => ({})),
      fetch(base + "model_trees_slim.json").then(r => r.json()).catch(() => null),
    ]);
    const idx = {};
    order.forEach((n, i) => { idx[n] = i; });

    let quantiles, qmodels;
    if (qbundle && qbundle.models) {
      quantiles = qbundle.quantiles || Object.keys(qbundle.models).map(Number).sort((a, b) => a - b);
      qmodels = {};
      for (const a of quantiles) qmodels[a] = _parseModel(qbundle.models[String(a)]);
    } else if (single) {
      quantiles = [0.5]; qmodels = { 0.5: _parseModel(single) };
    } else {
      quantiles = []; qmodels = {};
    }
    _ml = {
      quantiles, qmodels, order, defaults, idx,
      bands: bands || {}, statWeights: statWeights || {},
      cal: cal || {}, drift: (cal && cal.drift) || {}, synlo: (cal && cal.synlo) || {}, nsamp: (cal && cal.nsamp) || {},
      venta: (cal && cal.venta) || {},
    };
    // global stat prior, in state so the appraisal can interpolate stats without weapon data
    const _prior = statWeights && statWeights._global && statWeights._global.pos;
    if (_prior && typeof _prior === "object" && !state.rivenStatPrior) {
      state.rivenStatPrior = _prior;
    }
    if (statWeights && typeof statWeights === "object" && !state.rivenStatWeights) {
      state.rivenStatWeights = statWeights;
      // through globalThis to avoid the ui_rivens -> riven_ml -> ui_rivens cycle
      if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
        try { globalThis.refreshCurrentRivenMetaStats(); } catch {}
      }
    }
    if (cal && typeof cal.peso_magnitud === "number" && cal.peso_magnitud > 0) {
      state.rivenPesoMagnitud = cal.peso_magnitud;
    }
    return _ml;
  })();
  return _loading;
}

function _byWeapon(table, weaponName) {
  if (!table || weaponName == null) return undefined;
  if (table[weaponName] != null) return table[weaponName];
  const nl = String(weaponName).toLowerCase();
  const k = Object.keys(table).find(x => x.toLowerCase() === nl);
  return k ? table[k] : undefined;
}

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

export async function gradeRiven(weaponName, stats) {
  const ml = await loadRivenML();
  const sw = ml.statWeights || {};
  const findWeapon = (name) => {
    if (sw[name]) return sw[name];
    const nl = String(name || "").trim().toLowerCase();
    const k = Object.keys(sw).find(x => x.toLowerCase() === nl);
    return k ? sw[k] : undefined;
  };
  const W = findWeapon(weaponName) || {};
  const base = sw.__baseline || sw._global || {};
  const lookup = (table, name) => {
    if (!table) return undefined;
    const direct = (t) => {
      if (t[name] != null) return t[name];
      const nl = name.toLowerCase();
      const k = Object.keys(t).find(x => x.toLowerCase() === nl);
      return k ? t[k] : undefined;
    };
    const v = direct(table);
    if (typeof v === "number") return v;
    for (const tier of Object.values(table)) {
      if (tier && typeof tier === "object") {
        const tv = direct(tier);
        if (typeof tv === "number") return tv;
      }
    }
    return undefined;
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
      let b = lookup(W.pos, s.name) ?? lookup(base.pos, s.name) ?? 0.30;
      b = Math.max(0.05, Math.min(1, b));
      negFactor *= (1 - 0.6 * b);
      out.push({ name: s.name, isPositive: false, badness: +b.toFixed(2), label: negLabel(b) });
    }
  }
  const posAvg = posW.length ? (posW.reduce((a, b) => a + b, 0) / posW.length) : 0;
  const best = posW.length ? Math.max(...posW) : 0;
  const score = Math.round(Math.max(0, Math.min(100, (0.6 * posAvg + 0.4 * best) * negFactor * 100)));
  const grade = score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "F";
  return { weapon: weaponName, score, grade, stats: out };
}

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

export async function rivenScores(weaponName, itemAttributes) {
  const g = await gradeRiven(weaponName, itemAttributes);
  const _grade = (s) => s >= 85 ? "S" : s >= 70 ? "A" : s >= 50 ? "B" : s >= 30 ? "C" : "F";
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
    stat: { score: g.score, grade: g.grade, perStat: g.stats },
    roll: { score: rollScore, grade: _grade(rollScore), perStat: rollPerStat },
  };
}

export async function mlBandEstimate(weaponName, itemAttributes, scoreOverride = null, de = null) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let b = bands[weaponName];
  if (!b) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    b = k ? bands[k] : null;
  }
  const g = await gradeRiven(weaponName, itemAttributes);
  const score = (scoreOverride != null && Number.isFinite(scoreOverride)) ? scoreOverride : g.score;
  const s = Math.max(0, Math.min(1, (score || 0) / 100));

  const med = (de && de.median > 0) ? de.median : (b ? b.typical : 50);
  let mx = (de && de.max > med) ? de.max : med * 10;
  if (b && b.ceiling > med) {
    mx = Math.min(mx, b.ceiling);
  } else {
    mx = Math.min(mx, med * 8);
  }
  // the floor can never exceed the median: on low volume unrolled can sell above rerolled
  const floor = Math.min((de && de.floor > 0) ? de.floor : Math.round(med * 0.5), Math.round(med * 0.5));
  let sale;
  if (s <= 0.5) {
    sale = Math.round(floor + (med - floor) * (s / 0.5));
  } else {
    const frac = (s - 0.5) / 0.5;
    const skew = Math.max(1.2, mx / med);
    sale = Math.round(med * Math.pow(skew, Math.pow(frac, 1.5)));
  }
  sale = Math.max(floor, sale);

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

export function robustPriceBand(weapon, history) {
  const served = (_ml && _ml.bands && weapon) ? _ml.bands[weapon.name] : null;
  const days = Array.isArray(history?.data) ? history.data
    : (Array.isArray(history) ? history : []);
  const median = (arr) => {
    const v = arr.filter(x => typeof x === "number" && x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
  };
  const deUn = weapon?.de_unrolled || {};
  const deRe = weapon?.de_rerolled || {};

  let floor = (weapon && weapon.official_median > 0 ? weapon.official_median : 0)
    || median(days.map(d => d.official_median)) || deUn.median || (served && served.floor) || 15;

  let typical;
  if (deRe.median > 0 && deRe.median >= floor && (deRe.pop || 0) >= 1) {
    typical = deRe.median;
  } else {
    const histPrem = median(days.map(d => d.rerolled_premium_ratio).filter(x => x > 1.05));
    typical = histPrem > 1 ? Math.round(floor * histPrem)
      : (served && served.typical > floor ? served.typical : Math.round(floor * 1.7));
  }
  if (typical < floor) typical = Math.round(floor * 1.5);

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
    sum += t.sc[n];
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

async function buildFeatureVector(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const ml = await loadRivenML();
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
  const reMed = deRe.median || 0, reMax = deRe.max_price || 0;
  set("re_pop", deRe.pop);
  set("re_std", deRe.stddev);
  set("re_med", reMed);
  set("re_max", reMax);
  set("wfm_vs_off", (wfm || 0) / (ofmv + 1));
  set("ceil_mult", reMax / (reMed + 1));
  set("hist_day_drift", 1.0);
  set("hist_day_offdrift", 1.0);
  set("hist_day_rerprem", 1.0);
  set("volatility_index", weapon.volatility_index);
  set("trend_7d_pct", weapon.trend_7d_pct);
  set("web_min", weapon.web_min);
  set("web_max", weapon.web_max);

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
      const k = dwKey(name);
      let b = (k ? (parseFloat(dw[k]) || 0.30) : 0.30);
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
  set("neg_penalty_factor", Number(negPenalty.toFixed(4)));

  set("popularity_pct_x_synergy", (weapon.popularity_pct || 0) * synergy);
  set("pop_x_synergy", (weapon.popularity_pct || 0) * synergy);
  const dispo = (weaponData && weaponData.disposition) || weapon.disposition;
  if (dispo) { set("disposition", dispo); set("dispo_x_synergy", dispo * synergy); }

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

export async function predictRivenMLBand(weapon, itemAttributes, weaponData = null, rerolls = 0, scoreOverride = null) {
  const { ml, vec, synergy } = await buildFeatureVector(weapon, itemAttributes, weaponData, rerolls);
  const wname = weapon.name || weapon.weaponName;
  const qs = ml.quantiles && ml.quantiles.length ? ml.quantiles : [0.25, 0.5, 0.8, 0.9, 0.95];
  const drift = _byWeapon(ml.drift, wname) || 1.0;

  let scoreVal = scoreOverride;
  if (!Number.isFinite(scoreVal)) { const g = await gradeRiven(wname, itemAttributes); scoreVal = g.score; }
  const s = Math.max(0, Math.min(1, (scoreVal || 0) / 100));

  const b = _byWeapon(ml.bands, wname);
  const deRe = weapon.de_rerolled || (weaponData && weaponData.de_rerolled) || {};
  const deUn = weapon.de_unrolled || (weaponData && weaponData.de_unrolled) || {};
  const usaDE = (deRe.median > 0 || deUn.median > 0);
  let deMedRaw = usaDE ? (deRe.median > 0 ? deRe.median : deUn.median) : (b ? b.typical : 50);
  if (deRe.median > 0 && (deRe.pop || 0) < 3 && deUn.median > 0 && deMedRaw > deUn.median * 4) {
    deMedRaw = deUn.median * 4;
  }
  const deMed = deMedRaw;
  let deMax = (deRe.max_price || deRe.max || 0);
  const deSd = (deRe.stddev > 0 && (deRe.pop || 0) >= 3) ? deRe.stddev : 0;
  const robustMax = deSd > 0 ? Math.max(deMed + 2 * deSd, deMed * 3) : 0;
  if (robustMax > deMed) deMax = deMax > deMed ? Math.min(deMax, robustMax) : robustMax;
  deMax = deMax > deMed ? Math.min(deMax, deMed * 8) : deMed * 5;
  const deFloor = Math.max(1, Math.round(Math.min(deMed, deUn.median || deMed) * 0.45));
  const levelMap = (f) => {
    if (f <= 0.5) return deFloor + (deMed - deFloor) * (f / 0.5);
    const fr = (f - 0.5) / 0.5, skew = Math.max(1.3, deMax / deMed);
    return deMed * Math.pow(skew, Math.pow(fr, 1.5));
  };

  let mult = 1.0;
  const neg = itemAttributes.find(a => !a.isPositive);
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  let esBrick = false;
  if (neg) {
    const nm = MODEL_STAT_MAP[neg.name] || neg.name;
    const dwKeyNeg = Object.keys(dw).find(k => k.toLowerCase() === nm.toLowerCase());
    let wneg = dwKeyNeg ? parseFloat(dw[dwKeyNeg]) : NaN;
    if (!Number.isFinite(wneg)) {
      const gpos = (ml.statWeights && ml.statWeights._global && ml.statWeights._global.pos) || {};
      const gk = Object.keys(gpos).find(k => k.toLowerCase() === nm.toLowerCase());
      wneg = gk ? parseFloat(gpos[gk]) : 0;
    }
    esBrick = Number.isFinite(wneg) && wneg >= 0.6;
  }
  if (rerolls === 0) mult *= 1.25;

  const OFF = { 0.25: -0.12, 0.50: 0.0, 0.80: 0.10, 0.90: 0.15, 0.95: 0.20 };
  const floor = deFloor;
  const out = {};

  const vinfo = _byWeapon(ml.venta, wname);
  const qmods = ml.qmodels || {};
  const usaModelo = !!(vinfo && vinfo.fiable) && Object.keys(qmods).length > 0;

  if (usaModelo) {
    for (const a of qs) {
      const m = qmods[a] || qmods[0.5];
      if (!m) continue;
      out[a] = Math.max(floor, Math.round(Math.expm1(rawPredictModel(m, vec))));
    }
  } else {
    for (const a of qs) {
      const f = Math.max(0, Math.min(1, s + (OFF[a] != null ? OFF[a] : 0)));
      out[a] = Math.max(floor, Math.round(levelMap(f) * mult));
    }
  }
  let prev = 0;
  for (const a of qs) { out[a] = Math.max(out[a], prev); prev = out[a]; }

  const synlo = _byWeapon(ml.synlo, wname);
  const nsamp = _byWeapon(ml.nsamp, wname) || 0;
  const esTrash = (synlo != null) && (synergy <= synlo);
  const lowConf = esTrash || nsamp < 40;
  const p = (a) => out[a] != null ? out[a] : out[0.5];
  return {
    p25: p(0.25), p50: p(0.5), p80: p(0.8), p90: p(0.9), p95: p(0.95),
    price: p(0.5), floor, drift: +drift.toFixed(3),
    fuente: usaModelo ? "ml" : "curva",
    confianza: lowConf ? "baja" : "alta",
    aviso: lowConf ? (esTrash ? "trash" : "pocosDatos") : null,
    regla: esBrick ? "BRICK" : (rerolls === 0 ? "0roll" : "q"),
  };
}

export async function predictRivenMLPrice(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const band = await predictRivenMLBand(weapon, itemAttributes, weaponData, rerolls);
  return band.p50;
}
