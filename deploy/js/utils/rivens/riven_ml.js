import { classifyWeaponMarket } from "./riven_logic.js";
import { state } from "../../state.js";
import { tipoDeArma, esFusionado, pesoFusionado } from "./riven_cycling.js";
import { cargarNivelTirada, cargarDe10, atributosAWfm, residuosTirada, precisionNivel, registroSinWfm, nombreArma, filaDe10, nivelSinWfm, poblacionTirada, percentilTirada, preciosDe10 } from "./riven_nivel.js";

let _ml = null;
let _loading = null;

export async function loadRivenML() {
  if (_ml) return _ml;
  if (_loading) return _loading;
  _loading = (async () => {
    const base = "assets/ml/";
    const [bands, statWeights, cal] = await Promise.all([
      fetch(base + "price_bands.json").then(r => r.json()).catch(() => ({})),     // per weapon historical band
      fetch(base + "stat_weights.json").then(r => r.json()).catch(() => ({})),    // pos/neg weights per weapon
      fetch(base + "calibracion_por_arma.json").then(r => r.json()).catch(() => ({})), // drift/synlo/nsamp
    ]);

    _ml = {
      bands: bands || {}, statWeights: statWeights || {},
      cal: cal || {}, drift: (cal && cal.drift) || {}, synlo: (cal && cal.synlo) || {}, nsamp: (cal && cal.nsamp) || {},
    };
    // global stat prior, in state so the appraisal can interpolate stats without weapon data
    const _prior = statWeights && statWeights._global && statWeights._global.pos;
    if (_prior && typeof _prior === "object" && !state.rivenStatPrior) {
      state.rivenStatPrior = _prior;
    }
    // full table per weapon so the UI can sort inside a tier: dynamic_weights saturates. Same reference,
    // not a copy
    if (statWeights && typeof statWeights === "object" && !state.rivenStatWeights) {
      state.rivenStatWeights = statWeights;
      // repaint the guide: a panel drawn without these weights has empty TOP marks. Through globalThis to
      // avoid the ui_rivens -> riven_ml -> ui_rivens cycle
      if (typeof globalThis.refreshCurrentRivenMetaStats === "function") {
        try { globalThis.refreshCurrentRivenMetaStats(); } catch { /* panel not mounted yet */ }
      }
    }
    // meta/magnitude split of the score, measured in training (calibracion_por_arma.json)
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

// grades a riven BY WEAPON: each positive by how popular it is on that weapon, each negative by how
// much it ruins it
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
  // both export formats: flat {stat: weight} (_global) and by tier {S:{...}, A:{...}} (per weapon)
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

  const plano = (t) => t && Object.values(t).some((v) => v && typeof v === "object")
    ? Object.assign({}, ...Object.values(t).filter((v) => v && typeof v === "object"))
    : t;
  const tipo = tipoDeArma(state.weaponMap?.[weaponName]?.t);

  const out = [];
  const posW = [];
  let negFactor = 1;
  for (const s of stats) {
    if (s.isPositive) {
      const w = (esFusionado(s.name, tipo)
        ? pesoFusionado(s.name, plano(W.pos), tipo) ?? pesoFusionado(s.name, plano(base.pos), tipo)
        : lookup(W.pos, s.name) ?? lookup(base.pos, s.name)) ?? 0.30;
      posW.push(w);
      out.push({ name: s.name, isPositive: true, weight: +w.toFixed(2), tier: posTier(w), popular: w >= 0.45 });
    } else {
      // a negative's damage = the stat's value AS A POSITIVE on this weapon. The historical "neg" weight is
      // not used: price confounds it
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

// per weapon model precision, baked in training (held-out p50 MAPE)
export async function weaponPrecision(weaponName) {
  const rec = precisionNivel(await cargarNivelTirada(), weaponName);
  if (!rec) return null;
  const mape = Math.round(rec.mape);
  const grade = mape < 40 ? (state.currentLang === "es" ? "alta" : "high")
    : mape < 80 ? (state.currentLang === "es" ? "media" : "medium")
      : (state.currentLang === "es" ? "baja" : "low");
  return { mape, grade, n: rec.n || null };
}

// two independent scores: stat = which stats and how wanted on this weapon (no magnitude); roll = how
// high the values rolled in their range (no meta)
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

// appraisal anchored to real DE SALES, not asks: the score places the price on DE's real distribution,
// convex above the median
export async function mlBandEstimate(weaponName, itemAttributes, scoreOverride = null, de = null) {
  const ml = await loadRivenML();
  const bands = ml.bands || {};
  let b = bands[weaponName];
  if (!b) {
    const nl = String(weaponName || "").toLowerCase();
    const k = Object.keys(bands).find(x => x.toLowerCase() === nl);
    b = k ? bands[k] : null;
  }
  // score: the override (the shown grade, which reads magnitude) when given, else gradeRiven
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
  // the floor can never exceed the median: on low volume weapons unrolled can sell above rerolled and the
  // band collapsed to a point
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

// price band anchored to real DE data plus history, immune to one day outliers
export function robustPriceBand(weapon, history) {
  // floor and typical come from the live endpoint data, the ceiling from the accumulated history
  // (price_bands.json). The p15 of WFM listings is inflated on meta weapons, not used
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

function _synergy(weapon, itemAttributes, weaponData) {
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  const dwKey = (name) => {
    const nl = name.toLowerCase();
    return Object.keys(dw).find(k => k.toLowerCase() === nl);
  };
  const tipo = tipoDeArma((weaponData && weaponData.t) || weapon.t);
  let synergy = 0;
  for (const a of itemAttributes) {
    if (!a.isPositive) continue;
    if (esFusionado(a.name, tipo)) {
      synergy += pesoFusionado(a.name, dw, tipo) ?? 0.05;
    } else {
      const k = dwKey(a.name);
      synergy += k ? (parseFloat(dw[k]) || 0.05) : 0.05;
    }
  }
  return synergy;
}

// quantile band {p25,p50,p80,p90,p95}: p50 fair price, p25 quick sale, p80+ godroll ceiling
export async function predictRivenMLBand(weapon, itemAttributes, weaponData = null, rerolls = 0, scoreOverride = null) {
  const [ml, nt, de10] = await Promise.all([loadRivenML(), cargarNivelTirada(), cargarDe10()]);
  const synergy = _synergy(weapon, itemAttributes, weaponData);
  const wname = weapon.name || weapon.weaponName;
  const qs = [0.25, 0.5, 0.8, 0.9, 0.95];
  const drift = _byWeapon(ml.drift, wname) || 1.0;

  // roll quality: the shown score when given, else gradeRiven. The model's ask ranking is not used: asks
  // are compressed and inflated
  let scoreVal = scoreOverride;
  if (!Number.isFinite(scoreVal)) { const g = await gradeRiven(wname, itemAttributes); scoreVal = g.score; }
  const s = Math.max(0, Math.min(1, (scoreVal || 0) / 100));

  // level anchored to real DE sales: the score maps onto DE's distribution, median = typical sale, max =
  // real godroll ceiling
  const b = _byWeapon(ml.bands, wname);
  const deRe = weapon.de_rerolled || (weaponData && weaponData.de_rerolled) || {};
  const deUn = weapon.de_unrolled || (weaponData && weaponData.de_unrolled) || {};
  const usaDE = (deRe.median > 0 || deUn.median > 0);
  // deMed anchors the whole band: with low volume it is capped at a multiple of unrolled
  let deMedRaw = usaDE ? (deRe.median > 0 ? deRe.median : deUn.median) : (b ? b.typical : 50);
  if (deRe.median > 0 && (deRe.pop || 0) < 3 && deUn.median > 0 && deMedRaw > deUn.median * 4) {
    deMedRaw = deUn.median * 4;
  }
  const deMed = deMedRaw;
  let deMax = (deRe.max_price || deRe.max || 0);
  // capped godroll ceiling: median + 2σ of rerolled sales, max_price only bounds it from above. σ only
  // counts with volume (one sale gives σ=0, which means "unknown").
  // The 8x cap clips most weapons and is unresolved: raising it did not move the heuristic appraisal
  // (calculateAdvancedPredictivePrice rules there). Measure this path alone before touching it.
  const deSd = (deRe.stddev > 0 && (deRe.pop || 0) >= 3) ? deRe.stddev : 0;
  const robustMax = deSd > 0 ? Math.max(deMed + 2 * deSd, deMed * 3) : 0;
  if (robustMax > deMed) deMax = deMax > deMed ? Math.min(deMax, robustMax) : robustMax;
  deMax = deMax > deMed ? Math.min(deMax, deMed * 8) : deMed * 5;
  const deFloor = Math.max(1, Math.round(Math.min(deMed, deUn.median || deMed) * 0.45));
  const levelMap = (f) => {   // quality 0..1 -> real sale price
    if (f <= 0.5) return deFloor + (deMed - deFloor) * (f / 0.5);
    // above 0.5: median -> real max; exponent 1.5 keeps mid rolls near typical
    const fr = (f - 0.5) / 0.5, skew = Math.max(1.3, deMax / deMed);
    return deMed * Math.pow(skew, Math.pow(fr, 1.5));
  };

  // the bad negative is already in the SCORE: not multiplied by BRICK again, esBrick only labels
  const neg = itemAttributes.find(a => !a.isPositive);
  const dw = weapon.dynamic_weights || (weaponData && weaponData.dynamic_weights) || {};
  // BRICK = losing a stat that is top on THIS weapon, from its weight with the global prior as fallback
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

  // the p25..p95 band = the placed score ± spread
  const OFF = { 0.25: -0.12, 0.50: 0.0, 0.80: 0.10, 0.90: 0.15, 0.95: 0.20 };
  const floor = deFloor;
  const out = {};

  const { positivos, negativo } = atributosAWfm(itemAttributes, tipoDeArma((weaponData && weaponData.t) || weapon.t));
  const dispoArma = Number((weaponData && weaponData.d) || state.weaponMap?.[wname]?.d);
  const tipoCrudo = state.weaponDetailsDB?.find?.(w => w.name === wname)?.type ?? null;
  const conocida = nombreArma(nt, wname);
  const fila = filaDe10(de10, wname, deRe);
  const registro = fila && !conocida ? registroSinWfm(nt, nivelSinWfm(nt, wname, fila), dispoArma, tipoCrudo) : null;
  const residuos = fila ? residuosTirada(nt, wname, positivos, negativo, registro) : null;
  if (residuos) {
    const poblacion = poblacionTirada(nt, wname, tipoCrudo ?? nt.armas[conocida]?.tipo ?? ((weaponData && weaponData.t) || weapon.t));
    const suelo = usaDE ? floor : 1;
    preciosDe10(fila, percentilTirada(poblacion, residuos[1]), qs, nt.rho).forEach((v, i) => { out[qs[i]] = Math.max(suelo, Math.round(v)); });
  } else {
    for (const a of qs) {
      const f = Math.max(0, Math.min(1, s + (OFF[a] != null ? OFF[a] : 0)));
      out[a] = Math.max(floor, Math.round(levelMap(f)));
    }
  }
  // non decreasing, in case rounding or a clamp crosses
  let prev = 0;
  for (const a of qs) { out[a] = Math.max(out[a], prev); prev = out[a]; }

  // low confidence: low end roll (score <= the weapon's p30) or a weapon with little data
  const synlo = _byWeapon(ml.synlo, wname);
  const nsamp = _byWeapon(ml.nsamp, wname) || 0;
  const esTrash = (synlo != null) && (synergy <= synlo);
  const lowConf = esTrash || nsamp < 40;
  const p = (a) => out[a] != null ? out[a] : out[0.5];
  return {
    p25: p(0.25), p50: p(0.5), p80: p(0.8), p90: p(0.9), p95: p(0.95),
    price: p(0.5), floor, drift: +drift.toFixed(3),
    fuente: residuos ? "de10" : "curva",
    confianza: lowConf ? "baja" : "alta",
    aviso: lowConf ? (esTrash ? "trash" : "pocosDatos") : null,
    regla: esBrick ? "BRICK" : (rerolls === 0 ? "0roll" : "q"),
  };
}

// compat: single price = p50 of the band
export async function predictRivenMLPrice(weapon, itemAttributes, weaponData = null, rerolls = 0) {
  const band = await predictRivenMLBand(weapon, itemAttributes, weaponData, rerolls);
  return band.p50;
}
