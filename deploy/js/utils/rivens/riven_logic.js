import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS, resolveBaseStatKey } from "../../config.js";
import { state } from "../../state.js";
import { statUnit } from "./riven_stat_display.js";

export function calculateRivenGrade(weaponData, statName, statValue, isNeg, buffCount, hasNeg) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  const wKey = `${buffCount}-${hasNeg ? 1 : 0}`;
  const w = RIVEN_WEIGHTS[wKey] || RIVEN_WEIGHTS["2-0"];

  const multiplier = isNeg ? w.curse : w.buff;

  const typeIdx = WEAPON_TYPE_IDX[type] ?? 0;
  const baseCoef = RIVEN_BASE_STATS[resolveBaseStatKey(statName, typeIdx)]?.[typeIdx];

  if (baseCoef === undefined || baseCoef === 0) {
    return { grade: "?", pct: 0, range: "N/A", isGodRoll: false };
  }

  const SCALING_FACTOR = 9;
  const theoreticalVal = baseCoef * dispo * multiplier * SCALING_FACTOR;

  const idealMag = Math.abs(theoreticalVal);
  const minMag = idealMag * 0.9;
  const maxMag = idealMag * 1.1;

  const userMag = Math.abs(statValue);
  let pct = (userMag - minMag) / (maxMag - minMag) * 100;
  pct = Math.max(0, Math.min(100, pct));
  if (isNeg) pct = 100 - pct;

  let grade = "F";
  if (pct >= 98) grade = "SSS";
  else if (pct >= 94) grade = "S+";
  else if (pct >= 90) grade = "S";
  else if (pct >= 82) grade = "A+";
  else if (pct >= 75) grade = "A";
  else if (pct >= 65) grade = "B+";
  else if (pct >= 50) grade = "B";
  else if (pct >= 40) grade = "C+";
  else if (pct >= 30) grade = "C";

  const sign = theoreticalVal < 0 ? -1 : 1;
  const minDisplay = (minMag * sign).toFixed(1);
  const maxDisplay = (maxMag * sign).toFixed(1);
  const [lo, hi] = Number.parseFloat(minDisplay) > Number.parseFloat(maxDisplay) ? [maxDisplay, minDisplay] : [minDisplay, maxDisplay];
  const rangeStr = `${lo} a ${hi}${statUnit(statName)}`;

  return {
    grade,
    pct: pct.toFixed(1),
    range: rangeStr,
    isGodRoll: pct >= 95,
  };
}

export function getRivenStatRange(weaponData, statName, isNeg, buffCount, hasNeg) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  const wKey = `${buffCount}-${hasNeg ? 1 : 0}`;
  const w = RIVEN_WEIGHTS[wKey] || RIVEN_WEIGHTS["2-0"];

  const multiplier = isNeg ? w.curse : w.buff;
  const typeIdx = WEAPON_TYPE_IDX[type] ?? 0;
  const baseCoef = RIVEN_BASE_STATS[resolveBaseStatKey(statName, typeIdx)]?.[typeIdx];

  if (baseCoef === undefined || baseCoef === 0) {
    return null;
  }

  const SCALING_FACTOR = 9;
  const theoreticalVal = baseCoef * dispo * multiplier * SCALING_FACTOR;

  const idealMag = Math.abs(theoreticalVal);
  const minMag = idealMag * 0.9;
  const maxMag = idealMag * 1.1;

  const sign = theoreticalVal < 0 ? -1 : 1;
  const minVal = Number((minMag * sign).toFixed(1));
  const maxVal = Number((maxMag * sign).toFixed(1));
  const midVal = Number(theoreticalVal.toFixed(1));

  return {
    min: minVal < maxVal ? minVal : maxVal,
    max: minVal < maxVal ? maxVal : minVal,
    mid: midVal
  };
}

export function calculateRealPotential(val) {
  if (!val) return 0;
  const popularity = val.popularity_pct || 0;
  const realVolume = (val.de_unrolled?.pop || 0) + (val.de_rerolled?.pop || 0);
  const isUnpopular = popularity < 8.0 || realVolume < 3;

  let unrolledMedian = (val.de_unrolled && val.de_unrolled.median !== undefined && val.de_unrolled.median !== null && val.de_unrolled.median > 0)
    ? val.de_unrolled.median
    : (val.official_median || val.official_avg_price || 30);

  let rerollMedian = (val.de_rerolled && val.de_rerolled.median !== undefined && val.de_rerolled.median > 0)
    ? val.de_rerolled.median
    : (val.official_median || unrolledMedian);

  let maxRerolledPrice = (val.de_rerolled && val.de_rerolled.max_price !== undefined) ? val.de_rerolled.max_price : 0;
  let maxUnrolledPrice = (val.de_unrolled && val.de_unrolled.max_price !== undefined) ? val.de_unrolled.max_price : 0;
  let maxCeiling = Math.max(maxRerolledPrice, maxUnrolledPrice);

  if (isUnpopular) {
    if (unrolledMedian > 150) {
      unrolledMedian = 150 + (unrolledMedian - 150) * 0.15;
    }
    if (rerollMedian > 300) {
      rerollMedian = 300 + (rerollMedian - 300) * 0.15;
    }
    if (maxCeiling > 1500) {
      maxCeiling = 1500 + (maxCeiling - 1500) * 0.10;
    }
  }

  if (unrolledMedian <= 0) return 0;

  const realMarkup = Math.max(1.0, rerollMedian / unrolledMedian);
  const unrolledStd = (val.de_unrolled && val.de_unrolled.stddev !== undefined) ? val.de_unrolled.stddev : (val.official_stddev || 0);
  const rerollStd = (val.de_rerolled && val.de_rerolled.stddev !== undefined) ? val.de_rerolled.stddev : (val.official_stddev || 0);

  const unrolledCV = unrolledStd / unrolledMedian;
  const rerollCV = rerollStd / rerollMedian;
  const volatilityFactor = 1.0 + Math.max(unrolledCV, rerollCV);

  const godrollFactor = maxCeiling > 0 ? Math.min(1.0 + (maxCeiling / 800), 5.0) : 1.0;
  const popFactor = 1.0 + (popularity / 20);

  const potential = realMarkup * Math.sqrt(volatilityFactor) * Math.sqrt(godrollFactor) * Math.sqrt(popFactor);
  return Number(potential.toFixed(2));
}

export function calculateWebPotential(val) {
  if (!val) return 0;
  const popularity = val.popularity_pct || 0;
  const realVolume = (val.de_unrolled?.pop || 0) + (val.de_rerolled?.pop || 0);
  const isUnpopular = popularity < 8.0 || realVolume < 3;

  let unrolledMedian = (val.de_unrolled && val.de_unrolled.median !== undefined && val.de_unrolled.median !== null && val.de_unrolled.median > 0)
    ? val.de_unrolled.median
    : (val.official_median || val.official_avg_price || 30);

  let wfmAvg = val.wfm_avg_price || val.wfm_avg || 0;

  if (isUnpopular) {
    if (unrolledMedian > 150) {
      unrolledMedian = 150 + (unrolledMedian - 150) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.20;
    }
  }

  if (unrolledMedian <= 0) return 0;

  const wfmMarkup = wfmAvg > 0 ? Math.max(1.0, wfmAvg / unrolledMedian) : 1.0;
  const wfmSample = val.wfm_market_sample || 0;
  const sampleFactor = 1.0 + Math.min(wfmSample / 15, 2.0);

  const potential = wfmMarkup * Math.sqrt(sampleFactor) * Math.sqrt(1.0 + (popularity / 20));
  return Number(potential.toFixed(2));
}

export function calculateRivenPotential(val) {
  return calculateRealPotential(val);
}

function resolveStatWeight(nameLower, weapon, weaponData, statBaseline) {
  const dw = (weapon && weapon.dynamic_weights) || (weaponData && weaponData.dynamic_weights);
  let ownWeight = null;
  if (dw && typeof dw === "object") {
    const key = Object.keys(dw).find(k => {
      const kl = k.toLowerCase();
      return kl === nameLower || nameLower.includes(kl) || kl.includes(nameLower);
    });
    if (key !== undefined && dw[key] !== null && dw[key] !== undefined) {
      ownWeight = parseFloat(dw[key]);
    }
  }

  let baseWeight = null;
  if (statBaseline && typeof statBaseline === "object") {
    const key = Object.keys(statBaseline).find(k => {
      const kl = k.toLowerCase();
      return kl === nameLower || nameLower.includes(kl) || kl.includes(nameLower);
    });
    if (key !== undefined && statBaseline[key] !== null && statBaseline[key] !== undefined) {
      baseWeight = parseFloat(statBaseline[key]);
    }
  }

  const liquidity = (weapon && weapon.liquidity_score) || (weaponData && weaponData.liquidity_score) || 0;
  const alpha = Math.min(1, liquidity / 25);

  if (ownWeight !== null && baseWeight !== null) return alpha * ownWeight + (1 - alpha) * baseWeight;
  if (ownWeight !== null) return ownWeight;
  if (baseWeight !== null) return baseWeight;
  return null;
}

export function areWeightsDegenerate(dynWeightsRaw) {
  const vals = dynWeightsRaw && typeof dynWeightsRaw === "object"
    ? Object.values(dynWeightsRaw).map(v => parseFloat(v)).filter(Number.isFinite) : [];
  const empates = vals.filter(v => v >= 0.999).length;
  return vals.length >= 12 && empates >= 6 && (empates / vals.length) >= 0.25;
}

export const STAT_TIER_TOP = 0.7;
export const STAT_TIER_MID = 0.4;

export function gradeWeaponStats(weapon, statBaseline = null) {
  const raw = (weapon && weapon.dynamic_weights) || null;
  const propios = raw && !areWeightsDegenerate(raw) ? raw : null;
  const tabla = propios || (statBaseline && typeof statBaseline === "object" ? statBaseline : null);
  if (!tabla) return null;

  const orden = Object.entries(tabla)
    .map(([k, v]) => [k, parseFloat(v)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
  if (!orden.length) return null;

  const best = [], mid = [], meh = [];
  for (const [nombre, peso] of orden) {
    if (peso >= STAT_TIER_TOP) best.push(nombre);
    else if (peso >= STAT_TIER_MID) mid.push(nombre);
    else meh.push(nombre);
  }
  return { best, mid, meh, fuente: propios ? "arma" : "prior", pesos: Object.fromEntries(orden) };
}

export function calculateAdvancedPredictivePrice(weapon, itemAttributes, tiers, desirabilityMultiplier = 1.0, weaponData = null, statBaseline = null) {
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || []);
  const midPositives = weapon.midPos || [];

  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  const positiveStats = itemAttributes.filter(a => a.isPositive);
  let hasToxin = false;
  let hasCold = false;
  let hasElectric = false;
  let hasHeat = false;

  positiveStats.forEach(attr => {
    const nameLower = attr.name.toLowerCase();
    if (nameLower.includes("toxin")) hasToxin = true;
    if (nameLower.includes("cold")) hasCold = true;
    if (nameLower.includes("electric")) hasElectric = true;
    if (nameLower.includes("heat")) hasHeat = true;
  });

  // only the pairs the market pays a premium for get a bonus: Viral, Radiation and Corrosive
  let elementComboBonus = 0;
  let comboName = "";
  if (hasToxin && hasCold) {
    elementComboBonus = 0.25;
    comboName = "Viral";
  } else if (hasHeat && hasElectric) {
    elementComboBonus = 0.10;
    comboName = "Radiation";
  } else if (hasToxin && hasElectric) {
    elementComboBonus = 0.10;
    comboName = "Corrosive";
  }

  const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
  if (dispo < 0.8 && elementComboBonus > 0) {
    elementComboBonus *= 1.6;
  }

  const weaponType = weaponData?.t?.toLowerCase() || "";
  const isMeleeWeapon = weaponType === "melee" || weaponType === "zaw" || weaponType === "glaive"
    ? true
    : (weaponType === "" && itemAttributes.some(attr => {
      const name = attr.name.toLowerCase();
      return name === "melee damage" || name === "range" || name === "combo duration" || name === "initial combo" || name === "heavy attack efficiency";
    }));

  const positiveWeights = [];
  let validRangeCount = 0;
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();
      const isDynamicMeta = bestPositives.some(p => p.toLowerCase() === nameLower);
      const isMidMeta = midPositives.some(p => p.toLowerCase() === nameLower);

      const resolvedWeight = resolveStatWeight(nameLower, weapon, weaponData, statBaseline);

      let attributeWeight;
      if (resolvedWeight !== null) {
        attributeWeight = resolvedWeight;
      } else if (isDynamicMeta) {
        attributeWeight = 1.0;
      } else if (isMidMeta) {
        attributeWeight = 0.85;
      } else {
        attributeWeight = 0;
      }

      const range = attr.maxIdeal - attr.minIdeal;
      if (range > 0) {
        const quality = (attr.value - attr.minIdeal) / range;
        const clampedQuality = Math.max(0, Math.min(1, quality));
        totalRollQuality += clampedQuality;
        validRangeCount++;

        if (clampedQuality > 0.8 && (isDynamicMeta || resolvedWeight > 0.75)) {
          attributeWeight += (1.0 - attributeWeight) * 0.25;
        }
      }

      totalMetaScore += attributeWeight;
      positiveWeights.push(attributeWeight);
    }
  });

  if (elementComboBonus > 0) {
    let elementsFound = 0;
    itemAttributes.forEach((attr, idx) => {
      if (attr.isPositive) {
        const nameLower = attr.name.toLowerCase();
        if (nameLower.includes("toxin") || nameLower.includes("cold") || nameLower.includes("electric") || nameLower.includes("heat")) {
          if (positiveWeights[elementsFound] !== undefined) {
            positiveWeights[elementsFound] += elementComboBonus / 2;
          }
          elementsFound++;
        }
      }
    });
  }

  const avgRollQuality = validRangeCount > 0 ? totalRollQuality / validRangeCount : 0.5;

  // copy before sorting: elementComboBonus is applied by index above
  const sortedWeights = positiveWeights.slice().sort((a, b) => b - a);
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = sortedWeights[0] || 0;
  } else if (positiveCount === 2) {
    finalMetaRatio = ((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2;
  } else if (positiveCount >= 3) {
    finalMetaRatio = (((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2) * 0.70 + (sortedWeights[2] || 0) * 0.30;
  }

  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  let effectiveMetaRatio = finalMetaRatio;
  if (!hasNegAttr) {
    effectiveMetaRatio = finalMetaRatio * 0.78;
  }

  let finalPrice = 0;

  const isGodrollCombo = effectiveMetaRatio >= 0.80 && avgRollQuality >= 0.60;
  if (isGodrollCombo) {
    const floorGodroll = tiers.godroll * 0.50;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.3) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    if (avgRollQuality <= 0.5) {
      const floorGood = tiers.goodReroll * (tiers.isUnpopular ? 0.40 : 0.65);
      finalPrice = floorGood + (avgRollQuality * 2.0) * (tiers.goodReroll - floorGood);
    } else {
      const upperBound = tiers.goodReroll * 1.4;
      finalPrice = tiers.goodReroll + ((avgRollQuality - 0.5) * 2.0) * (upperBound - tiers.goodReroll);
    }
  } else {
    finalPrice = tiers.trash * (0.8 + avgRollQuality * 0.4);
  }

  const NEG_KILLER = 0.60;
  const NEG_MITIGABLE = 0.25;

  const bestNegatives = Array.isArray(weapon.neg) ? weapon.neg : (weapon.neg?.best || []);

  const dynWeightsRaw = (weapon && weapon.dynamic_weights) || (weaponData && weaponData.dynamic_weights);

  const dynWeights = areWeightsDegenerate(dynWeightsRaw) ? null : dynWeightsRaw;

  const posWeightOf = (nameLower) => {
    if (dynWeights && typeof dynWeights === "object") {
      const key = Object.keys(dynWeights).find(k => {
        const kl = k.toLowerCase();
        return kl === nameLower || kl.includes(nameLower) || nameLower.includes(kl);
      });
      if (key && dynWeights[key] != null) return parseFloat(dynWeights[key]) || 0;
    }
    if (statBaseline && typeof statBaseline === "object") {
      const bk = Object.keys(statBaseline).find(k => {
        const kl = k.toLowerCase();
        return kl === nameLower || kl.includes(nameLower) || nameLower.includes(kl);
      });
      if (bk && statBaseline[bk] != null) {
        const bv = parseFloat(statBaseline[bk]);
        if (Number.isFinite(bv)) return bv;
      }
    }
    const inList = (list) => Array.isArray(list) && list.some(p => {
      const pl = p.toLowerCase();
      return pl === nameLower || pl.includes(nameLower) || nameLower.includes(pl);
    });
    if (inList(bestPositives)) return 1.0;
    if (inList(midPositives)) return 0.5;
    return 0;
  };

  const _dwVals = dynWeights && typeof dynWeights === "object"
    ? Object.values(dynWeights).map(v => parseFloat(v)).filter(Number.isFinite).sort((a, b) => b - a)
    : [];
  const _topRef = _dwVals.length ? _dwVals[Math.min(_dwVals.length - 1, 2)] : null;
  const esStatTopDelArma = (w) => _topRef != null
    ? (w >= Math.max(NEG_MITIGABLE, _topRef * 0.9))
    : (w >= NEG_KILLER);

  let isBricked = false;

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      const isGoodNegative = bestNegatives.some(b => b.toLowerCase().includes(negName) || negName.includes(b.toLowerCase()));

      // exact match: posWeightOf's fuzzy match would confuse them with critical damage
      const negPosWeight = (negName === "damage" || negName === "base damage")
        ? (posWeightOf("base damage / melee damage") || posWeightOf("damage") || 0)
        : posWeightOf(negName);

      if (!isGoodNegative && esStatTopDelArma(negPosWeight)) {
        isBricked = true;
      }

      if (isGoodNegative) {
        finalPrice *= 1.20;
      } else if (esStatTopDelArma(negPosWeight)) {
        finalPrice *= (effectiveMetaRatio >= 0.80) ? 0.25 : 0.10;
      } else if (negPosWeight >= 0.4) {
        finalPrice *= 0.70;
      } else if (negPosWeight >= NEG_MITIGABLE) {
        finalPrice *= 0.85;
      } else {
        finalPrice *= 1.10;
      }
    }
  });

  if (isBricked) {
    finalPrice = tiers.trash;
  }

  const desirabilityFactor = Math.sqrt(desirabilityMultiplier);
  let penalizedPrice = Math.round(finalPrice * desirabilityFactor);
  if (isBricked) {
    penalizedPrice = tiers.trash;
  } else {
    penalizedPrice = Math.max(penalizedPrice, tiers.trash);
  }
  const _pesoMag = Math.min(0.35, Math.max(0.15,
    (typeof state !== "undefined" && typeof state.rivenPesoMagnitud === "number")
      ? state.rivenPesoMagnitud : 0.25));
  const rawScore = Math.round(((finalMetaRatio * (1 - _pesoMag)) + (avgRollQuality * _pesoMag)) * 100);
  const adjustedScore = isBricked
    ? Math.min(20, Math.max(5, Math.round(rawScore * 0.10)))
    : Math.max(10, Math.min(100, Math.round(rawScore * desirabilityFactor)));

  if (!isBricked) {
    const trendPct = Number.isFinite(weapon.trend_7d_pct) ? weapon.trend_7d_pct : 0;
    if (trendPct !== 0) {
      const trendFactor = 1 + (Math.max(-30, Math.min(30, trendPct)) / 100) * 0.5;
      penalizedPrice = Math.max(tiers.trash, Math.round(penalizedPrice * trendFactor));
    }
  }

  if (penalizedPrice > 9500) {
    penalizedPrice = Math.round(9500 + (penalizedPrice - 9500) * 0.25);
  }

  penalizedPrice = Math.min(15000, penalizedPrice);

  const volatility = Number.isFinite(weapon.volatility_index) ? weapon.volatility_index : 0;
  const spread = 0.15 + Math.max(0, Math.min(0.25, volatility / 20));

  return {
    estimatedValue: penalizedPrice,
    suggestedMin: Math.round(penalizedPrice * (1 - spread)),
    suggestedMax: Math.round(penalizedPrice * (1 + spread)),
    adjustedScore: adjustedScore,
    comboName: comboName,
    elementComboBonus: elementComboBonus
  };
}

export function sameWeaponName(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function calculateHybridTiers(weapon, weaponHistory = null) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0;
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled && weapon.de_rerolled.median !== undefined) ? weapon.de_rerolled.median : 0;

  const _rePop = (weapon.de_rerolled && weapon.de_rerolled.pop) || 0;
  const _unMedian = (weapon.de_unrolled && weapon.de_unrolled.median) || offMedian || 0;
  if (reMedian > 0 && _rePop < 3 && _unMedian > 0) {
    const _capAnecdota = _unMedian * 4;
    if (reMedian > _capAnecdota) reMedian = _capAnecdota;
  }

  let histWfmAvg = 0;
  let histWfmMax = 0;
  let histDeMedian = 0;
  let hasHistory = false;

  const HIST_EMA_DECAY = 0.72;

  const _ema = (pts, key) => {
    let wSum = 0, wTotal = 0;
    pts.forEach((p, i) => { const w = Math.pow(HIST_EMA_DECAY, i); wSum += p[key] * w; wTotal += w; });
    return wTotal > 0 ? wSum / wTotal : 0;
  };

  const currentName = weapon.name || null;
  if (currentName && weaponHistory && sameWeaponName(weaponHistory.weaponName, currentName) && Array.isArray(weaponHistory.data)) {
    const histPoints = weaponHistory.data.filter(p => p && (p.wfm_avg_price > 0 || p.official_median > 0));
    if (histPoints.length > 0) {
      hasHistory = true;

      histPoints.forEach(p => { if (p.wfm_avg_price > histWfmMax) histWfmMax = p.wfm_avg_price; });

      const _ts = (p) => { const t = Date.parse(p.date); return Number.isNaN(t) ? -Infinity : t; };
      const wfmPts = histPoints.filter(p => p.wfm_avg_price > 0).sort((a, b) => _ts(b) - _ts(a));
      const dePts  = histPoints.filter(p => p.official_median > 0).sort((a, b) => _ts(b) - _ts(a));

      const flatWfm = wfmPts.length > 0 ? wfmPts.reduce((s, p) => s + p.wfm_avg_price, 0) / wfmPts.length : 0;

      histWfmAvg  = wfmPts.length > 0 ? _ema(wfmPts, 'wfm_avg_price')   : 0;
      histDeMedian = dePts.length > 0  ? _ema(dePts,  'official_median') : 0;

      const volIdx = Number.isFinite(weapon.volatility_index) ? weapon.volatility_index : 0;
      const sample = weapon.wfm_market_sample || 0;
      let histAlpha = Math.max(0.10, Math.min(0.65,
          0.25 + (volIdx / 20) * 0.35 - Math.min(0.10, (sample / 30) * 0.10)
      ));

      if (flatWfm > 0 && histWfmAvg > 0) {
        const divergence = Math.abs(histWfmAvg - flatWfm) / flatWfm;
        histAlpha = Math.max(0.05, histAlpha * Math.max(0.10, 1 - divergence * 2.0));
      }

      if (histWfmAvg > 0)  wfmAvg   = wfmAvg   > 0 ? (wfmAvg   * (1 - histAlpha) + histWfmAvg   * histAlpha) : histWfmAvg;
      if (histDeMedian > 0) offMedian = offMedian > 0 ? (offMedian * (1 - histAlpha) + histDeMedian * histAlpha) : histDeMedian;
    }
  }

  const maxWfmPrice = Math.max(wfmAvg, histWfmMax);
  const maxUnrolledRef = (weapon.de_unrolled && weapon.de_unrolled.max_price) || 0;
  const maxRerolledRef = (weapon.de_rerolled && weapon.de_rerolled.max_price) || 0;
  const absoluteMaxRef = Math.max(maxUnrolledRef, maxRerolledRef, weapon.max_price || 0);
  const isHighValue = wfmAvg > 800 || (absoluteMaxRef > 2500 && wfmAvg > 500) || histWfmAvg > 800;
  const hasBasicVolume = popularity >= 5.0 || realVolume >= 5;
  const isMetaWeapon = ((isHighValue || maxWfmPrice > 1200) && hasBasicVolume) || popularity >= 60;

  let clampMultiplier = 8.0;
  if (popularity > 0 || realVolume > 0) {
    if (popularity < 25.0 || realVolume < 25) {
      clampMultiplier = 5.5;
    } else if (popularity > 75.0 || realVolume > 100) {
      clampMultiplier = 12.0;
    }
  }

  if (isMetaWeapon) {
    clampMultiplier = Math.max(clampMultiplier, 22.0);
  }

  const baseRefMedian = reMedian > 0 ? reMedian : (offMedian > 0 ? offMedian : 50);
  const clampRef = reMedian > 0 ? Math.min(clampMultiplier, 6.0) : clampMultiplier;
  if (wfmAvg > baseRefMedian * clampRef) {
    wfmAvg = baseRefMedian * clampRef + (wfmAvg - baseRefMedian * clampRef) * 0.15;
  }

  const isUnpopular = (popularity < 25.0 || realVolume < 25) && !(isHighValue && hasBasicVolume) && !isMetaWeapon;

  if (isUnpopular) {
    if (offMedian > 150) {
      offMedian = 150 + (offMedian - 150) * 0.15;
    }
    if (reMedian > 300) {
      reMedian = 300 + (reMedian - 300) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.20;
    }
    if (offStdDev > 200) {
      offStdDev = 200 + (offStdDev - 200) * 0.10;
    }
  }

  let trash = offMedian > 0 ? offMedian : ((weapon.de_unrolled?.median > 0) ? weapon.de_unrolled.median : ((weapon.de_unrolled?.min_price > 0) ? weapon.de_unrolled.min_price : (isMetaWeapon ? 50 : 15)));
  const maxTrashFloor = isMetaWeapon ? 250 : 100;
  if (trash > maxTrashFloor) {
    trash = maxTrashFloor;
  }

  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    goodReroll = wfmAvg > 0
      ? Math.min(Math.round(wfmAvg * 0.3), Math.round(trash * 5))
      : Math.round(trash * (isUnpopular ? 1.8 : 2.5));
  }

  let godroll = 0;
  if (offMedian > 0) {
    const stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 0.25;
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    let stdDevMultiplier = 5.0;
    if (isUnpopular) {
      stdDevMultiplier = 1.5;
    }

    const deGodroll = Math.round(baseRef * (2.5 + Math.min(stdDevScale * stdDevMultiplier, 10.0)));

    if (wfmAvg > 0) {
      if (wfmAvg > baseRef * 2) {
        const _askRatio = baseRef > 0 ? wfmAvg / baseRef : 0;
        const _credibilidad = (_askRatio > 3 && wfmAvg > deGodroll)
          ? Math.max(0.15, 3 / _askRatio) : 1;
        const _pesoAsk = 0.30 * _credibilidad;
        const baseWfmScale = wfmAvg;
        godroll = Math.round(deGodroll * (1 - _pesoAsk) + baseWfmScale * _pesoAsk);
      } else {
        godroll = Math.round(deGodroll * 0.6 + Math.min(wfmAvg * 0.8, baseRef * 20) * 0.4);
      }
    } else {
      godroll = deGodroll;
    }
  } else {
    godroll = wfmAvg > 0
      ? Math.round(wfmAvg * 1.2)
      : Math.round(trash * (isUnpopular ? 3.5 : 6));
  }

  const observedMin = (weapon.de_unrolled && weapon.de_unrolled.min_price) || 0;
  if (observedMin > 0 && trash < observedMin) {
    trash = observedMin;
  }

  const observedMax = Math.max(absoluteMaxRef, weapon.web_max || 0);
  if (observedMax > 0 && godroll > observedMax * 1.3) {
    godroll = Math.round(observedMax * 1.3);
  }

  if (weapon.ml_trash && weapon.ml_trash.min > 0) {
    trash = Math.max(trash, weapon.ml_trash.min);
  }

  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(godroll * 2.5);
  }

  return { trash: Math.round(trash), goodReroll: Math.round(goodReroll), godroll: Math.round(godroll), isUnpopular };
}

export function classifyWeaponMarket(meta, band = null) {
  if (!meta) return null;
  const b = band || meta.band || {};
  const _deReMed = (meta.de_rerolled && meta.de_rerolled.median) || 0;
  const _deRePop = (meta.de_rerolled && meta.de_rerolled.pop) || 0;
  const refFiable = _deReMed > 0 && _deRePop >= 3;
  let typical = refFiable ? _deReMed : (b.typical || meta.official_median || 0);
  const wfm = meta.wfm_avg_price || meta.wfm_avg || 0;
  const vol = b.vol_dia != null ? b.vol_dia : (meta.wfm_market_sample || 0);
  const trend = b.trend != null ? b.trend : (meta.trend_7d_pct || 0);

  const hist = (typeof state !== "undefined" && state.currentWeaponHistory
    && sameWeaponName(state.currentWeaponHistory.weaponName, meta.name)
    && Array.isArray(state.currentWeaponHistory.data)) ? state.currentWeaponHistory.data : null;
  if (hist && hist.length > 0) {
    const meds = hist.map(p => p && p.official_median).filter(v => Number.isFinite(v) && v > 0).sort((x, y) => x - y);
    if (meds.length > 0) {
      const histMed = meds[Math.floor((meds.length - 1) / 2)];
      typical = typical > 0 ? Math.round(typical * 0.6 + histMed * 0.4) : histMed;
    }
  }
  if (!typical) return null;
  const ratio = wfm > 0 ? Math.round((wfm / typical) * 10) / 10 : 0;

  const isEs = state.currentLang === "es";

  // around the catalog's p75: the whole riven market asks far above what sells
  const RATIO_BURBUJA = 24;

  let flag, label, emoji, advice;
  if (refFiable && ratio >= RATIO_BURBUJA) {
    flag = "bubble"; emoji = "🫧";
    label = isEs ? "Sobreprecio · mucha oferta" : "Overpriced · heavy supply";
    advice = isEs
      ? `Aquí se pide ${ratio}× lo que se paga de verdad, y eso es más que en 3 de cada 4 armas. Hay cola de vendedores esperando: si quieres venderlo esta semana, ponte por debajo de los que ves listados.`
      : `Sellers here ask ${ratio}x what actually gets paid, more than in 3 out of 4 weapons. There is a queue of sellers waiting: to sell this week, price below the listings you can see.`;
  } else if (vol > 0 && vol < 12) {
    flag = "illiquid"; emoji = "🧊";
    label = isEs ? "Mercado dormido" : "Quiet market";
    advice = isEs
      ? "Casi nadie mueve rivens de esta arma. El precio que veas es poco fiable por falta de muestra, y colocarlo puede llevar semanas: cuenta con rebajar si tienes prisa."
      : "Hardly anyone trades rivens for this weapon. Any price you see is unreliable for lack of sample, and selling can take weeks: expect to discount if you are in a hurry.";
  } else if (!refFiable) {
    flag = "nodata"; emoji = "?";
    label = isEs ? "Sin ventas suficientes" : "Not enough sales";
    advice = isEs
      ? "Digital Extremes apenas registra ventas de rivens de esta arma, así que no hay precio de referencia fiable. Fíjate en la calidad del roll y en lo que piden otros, y no te sorprenda si las cifras bailan mucho."
      : "Digital Extremes barely records any riven sales for this weapon, so there is no reliable reference price. Go by the quality of the roll and what others are asking, and do not be surprised if numbers swing a lot.";
  } else if (vol >= 35 && ratio < 4) {
    flag = "meta"; emoji = "🔥";
    label = isEs ? "Arma meta · se vende" : "Meta weapon · sells";
    advice = isEs
      ? "Mucho movimiento y lo que piden se acerca a lo que se paga. Puedes pedir el precio estimado sin miedo: hay compradores buscando."
      : "Plenty of movement and asking prices are close to what gets paid. You can ask the estimated price with confidence: buyers are looking.";
  } else {
    flag = "mid"; emoji = "·";
    label = isEs ? "Mercado normal" : "Normal market";
    advice = isEs
      ? "Ni chollo ni trampa. El precio estimado es una buena referencia; si quieres el máximo, tendrás que esperar al comprador adecuado."
      : "Neither a steal nor a trap. The estimate is a solid reference; to get top value you will have to wait for the right buyer.";
  }
  if (trend >= 25) {
    advice += isEs ? ` ▲ Subiendo (+${Math.round(trend)}% 7d).` : ` ▲ Rising (+${Math.round(trend)}% 7d).`;
  } else if (trend <= -25) {
    advice += isEs ? ` ▼ Enfriándose (${Math.round(trend)}% 7d).` : ` ▼ Cooling down (${Math.round(trend)}% 7d).`;
  }
  return { flag, label, emoji, ratio, vol, trend, advice, refFiable };
}
