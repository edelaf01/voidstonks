import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS } from "../config.js";
import { state } from "../state.js";

/**
 * @param {Object} weaponData
 * @param {string} statName
 * @param {number} statValue
 * @param {boolean} isNeg
 * @param {number} buffCount
 * @param {boolean} hasNeg
 * @returns {{grade:string, pct:string, range:string, isGodRoll:boolean}}
 */
export function calculateRivenGrade(weaponData, statName, statValue, isNeg, buffCount, hasNeg) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  const wKey = `${buffCount}-${hasNeg ? 1 : 0}`;
  const w = RIVEN_WEIGHTS[wKey] || RIVEN_WEIGHTS["2-0"];

  const multiplier = isNeg ? w.curse : w.buff;

  const typeIdx = WEAPON_TYPE_IDX[type] ?? 0;
  const baseCoef = RIVEN_BASE_STATS[statName]?.[typeIdx];

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
  // on the curse a smaller magnitude is better, so the percentage is inverted
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
  const rangeStr = (Number.parseFloat(minDisplay) > Number.parseFloat(maxDisplay))
    ? `${maxDisplay} a ${minDisplay}%`
    : `${minDisplay} a ${maxDisplay}%`;

  return {
    grade,
    pct: pct.toFixed(1),
    range: rangeStr,
    isGodRoll: pct >= 95,
  };
}

/**
 * Bounds are for max rank (8); the client scales them by rank if needed.
 */
export function getRivenStatRange(weaponData, statName, isNeg, buffCount, hasNeg) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  const wKey = `${buffCount}-${hasNeg ? 1 : 0}`;
  const w = RIVEN_WEIGHTS[wKey] || RIVEN_WEIGHTS["2-0"];

  const multiplier = isNeg ? w.curse : w.buff;
  const typeIdx = WEAPON_TYPE_IDX[type] ?? 0;
  const baseCoef = RIVEN_BASE_STATS[statName]?.[typeIdx];

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

// per weapon weight blended with the global baseline: low volume weapons lean on the baseline
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

  let elementComboBonus = 0;
  let comboName = "";
  if (hasToxin && hasCold) {
    elementComboBonus = 0.25;
    comboName = "Viral";
  } else if (hasToxin && hasElectric) {
    elementComboBonus = 0.25;
    comboName = "Corrosive";
  } else if (hasHeat && hasElectric) {
    elementComboBonus = 0.15;
    comboName = "Radiation";
  } else if (hasToxin && hasHeat) {
    elementComboBonus = 0.15;
    comboName = "Gas";
  } else if (hasCold && hasElectric) {
    elementComboBonus = 0.10;
    comboName = "Magnetic";
  } else if (hasHeat && hasCold) {
    elementComboBonus = 0.10;
    comboName = "Blast";
  }

  const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
  // low disposition: a combined element saves a mod slot
  if (dispo < 0.8 && elementComboBonus > 0) {
    elementComboBonus *= 1.6;
  }

  // weapon archetype: weapon type first, stat name sniffing only when unknown
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

      if (/\b(grineer|corpus|infested)\b/i.test(nameLower)) {
        attributeWeight = Math.max(attributeWeight, 0.30);
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

  // only stats with a real range count: the rest default to 0.5
  const avgRollQuality = validRangeCount > 0 ? totalRollQuality / validRangeCount : 0.5;

  // copy before sorting: elementComboBonus is applied by index above
  const sortedWeights = positiveWeights.slice().sort((a, b) => b - a);
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = sortedWeights[0] || 0;
  } else if (positiveCount === 2) {
    finalMetaRatio = ((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2;
  } else if (positiveCount >= 3) {
    // a junk 3rd positive dilutes the riven, so it weighs 30%
    finalMetaRatio = (((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2) * 0.70 + (sortedWeights[2] || 0) * 0.30;
  }

  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  // without a curse a riven is never a godroll
  let effectiveMetaRatio = finalMetaRatio;
  if (!hasNegAttr) {
    effectiveMetaRatio = finalMetaRatio * 0.78;
  }

  // stat presence sets the price tier, roll quality the position inside it
  let finalPrice = 0;

  if (effectiveMetaRatio >= 0.80) {
    const floorGodroll = tiers.godroll * 0.50;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.3) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    // goodReroll is the market centroid; lower floor for unpopular weapons
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

  const universalCriticalNegs = new Set([
    "critical chance", "critical damage", "damage", "base damage", "multishot",
    "fire rate", "attack speed", "melee damage", "range", "status duration"
  ]);

  const brickNegs = new Set([
    "multishot", "critical chance", "critical damage", "damage", "base damage", "melee damage"
  ]);

  const mitigableNegs = [
    "ammo maximum", "magazine capacity", "reload speed", "impact", "puncture", "status chance", "projectile speed", "recoil"
  ];

  const bestNegatives = Array.isArray(weapon.neg) ? weapon.neg : (weapon.neg?.best || []);

  const dynWeights = (weapon && weapon.dynamic_weights) || (weaponData && weaponData.dynamic_weights);
  const posWeightOf = (nameLower) => {
    if (dynWeights && typeof dynWeights === "object") {
      const key = Object.keys(dynWeights).find(k => {
        const kl = k.toLowerCase();
        return kl === nameLower || kl.includes(nameLower) || nameLower.includes(kl);
      });
      if (key && dynWeights[key] != null) return parseFloat(dynWeights[key]) || 0;
    }
    const inList = (list) => Array.isArray(list) && list.some(p => {
      const pl = p.toLowerCase();
      return pl === nameLower || pl.includes(nameLower) || nameLower.includes(pl);
    });
    if (inList(bestPositives)) return 1.0;
    if (inList(midPositives)) return 0.5;
    return 0;
  };

  let isBricked = false;

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      const isFactionDmgNeg = negName.includes(" to ") || negName.includes("vs");
      const isGoodNegative = isFactionDmgNeg ||
        bestNegatives.some(b => b.toLowerCase().includes(negName) || negName.includes(b.toLowerCase()));
      const isUniversalBad = !isFactionDmgNeg && universalCriticalNegs.has(negName);
      const isMitigable = !isFactionDmgNeg && mitigableNegs.some(m => negName.includes(m));

      const negPosWeight = (isFactionDmgNeg || negName === "damage" || negName === "base damage")
        ? 0 : posWeightOf(negName);
      const isTopPositiveAsNeg = !isGoodNegative && negPosWeight >= 0.8;
      const isMidPositiveAsNeg = !isGoodNegative && negPosWeight >= 0.4 && negPosWeight < 0.8;

      const isBrick = !isFactionDmgNeg && brickNegs.has(negName);
      if (isBrick && !isGoodNegative) {
        isBricked = true;
      }

      if (isGoodNegative) {
        finalPrice *= 1.20;
      } else if (isUniversalBad || isTopPositiveAsNeg) {
        finalPrice *= (effectiveMetaRatio >= 0.80) ? 0.25 : 0.10;
      } else if (isMidPositiveAsNeg) {
        // mid positive as negative: usually has a workaround
        finalPrice *= 0.70;
      } else if (isMitigable) {
        finalPrice *= 0.85;
      } else {
        finalPrice *= 1.10;
      }
    }
  });

  if (isBricked) {
    finalPrice = tiers.trash;
  }

  // square root: the meta is already in finalPrice, the whole multiplier would punish it twice
  const desirabilityFactor = Math.sqrt(desirabilityMultiplier);
  let penalizedPrice = Math.round(finalPrice * desirabilityFactor);
  if (isBricked) {
    penalizedPrice = tiers.trash;
  } else {
    penalizedPrice = Math.max(penalizedPrice, tiers.trash);
  }
  const rawScore = Math.round(((finalMetaRatio * 0.85) + (avgRollQuality * 0.15)) * 100);
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

export function calculateHybridTiers(weapon, weaponHistory = null) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0;
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled && weapon.de_rerolled.median !== undefined) ? weapon.de_rerolled.median : 0;

  let histWfmAvg = 0;
  let histWfmMax = 0;
  let histDeMedian = 0;
  let hasHistory = false;

  // each older day weighs DECAY times the next newer one; lower reacts faster
  const HIST_EMA_DECAY = 0.72;

  const _ema = (pts, key) => {
    let wSum = 0, wTotal = 0;
    pts.forEach((p, i) => { const w = Math.pow(HIST_EMA_DECAY, i); wSum += p[key] * w; wTotal += w; });
    return wTotal > 0 ? wSum / wTotal : 0;
  };

  const currentName = weapon.name || null;
  if (currentName && weaponHistory && weaponHistory.weaponName === currentName && Array.isArray(weaponHistory.data)) {
    const histPoints = weaponHistory.data.filter(p => p && (p.wfm_avg_price > 0 || p.official_median > 0));
    if (histPoints.length > 0) {
      hasHistory = true;

      // flat max on purpose: all-time ceiling for meta detection
      histPoints.forEach(p => { if (p.wfm_avg_price > histWfmMax) histWfmMax = p.wfm_avg_price; });

      const wfmPts = histPoints.filter(p => p.wfm_avg_price > 0).sort((a, b) => new Date(b.date) - new Date(a.date));
      const dePts  = histPoints.filter(p => p.official_median > 0).sort((a, b) => new Date(b.date) - new Date(a.date));

      const flatWfm = wfmPts.length > 0 ? wfmPts.reduce((s, p) => s + p.wfm_avg_price, 0) / wfmPts.length : 0;

      histWfmAvg  = wfmPts.length > 0 ? _ema(wfmPts, 'wfm_avg_price')   : 0;
      histDeMedian = dePts.length > 0  ? _ema(dePts,  'official_median') : 0;

      const volIdx = Number.isFinite(weapon.volatility_index) ? weapon.volatility_index : 0;
      const sample = weapon.wfm_market_sample || 0;
      let histAlpha = Math.max(0.10, Math.min(0.65,
          0.25 + (volIdx / 20) * 0.35 - Math.min(0.10, (sample / 30) * 0.10)
      ));

      // EMA far from the flat mean = regime change (Incarnon, buff): the old baseline anchors less
      if (flatWfm > 0 && histWfmAvg > 0) {
        const divergence = Math.abs(histWfmAvg - flatWfm) / flatWfm;
        histAlpha = Math.max(0.05, histAlpha * Math.max(0.10, 1 - divergence * 2.0));
      }

      if (histWfmAvg > 0)  wfmAvg   = wfmAvg   > 0 ? (wfmAvg   * (1 - histAlpha) + histWfmAvg   * histAlpha) : histWfmAvg;
      if (histDeMedian > 0) offMedian = offMedian > 0 ? (offMedian * (1 - histAlpha) + histDeMedian * histAlpha) : histDeMedian;
    }
  }

  // meta from market signals, not from a list
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

  const baseRefMedian = offMedian > 0 ? offMedian : (reMedian > 0 ? reMedian : 50);
  if (wfmAvg > baseRefMedian * clampMultiplier) {
    wfmAvg = baseRefMedian * clampMultiplier + (wfmAvg - baseRefMedian * clampMultiplier) * 0.15;
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
      ? Math.round(wfmAvg * 0.3)
      : Math.round(trash * (isUnpopular ? 1.8 : 2.5));
  }

  let godroll = 0;
  if (offMedian > 0) {
    // no stddev = no evidence of volatility: assume a tight spread
    const stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 0.25;
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    let stdDevMultiplier = 5.0;
    if (isUnpopular) {
      stdDevMultiplier = 1.5;
    }

    const deGodroll = Math.round(baseRef * (2.5 + Math.min(stdDevScale * stdDevMultiplier, 10.0)));

    if (wfmAvg > 0) {
      if (wfmAvg > baseRef * 2) {
        const baseWfmScale = wfmAvg * (1.2 + Math.min(stdDevScale * 0.5, 1.5));
        godroll = Math.round(deGodroll * 0.5 + baseWfmScale * 0.5);
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

  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(godroll * 2.5);
  }

  return { trash, goodReroll, godroll, isUnpopular };
}
