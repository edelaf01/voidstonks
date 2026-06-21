/**
 * @param {Object} weapon
 * @returns {Object}
 */
export function calculateHybridTiers(weapon, weaponHistory = null) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0;
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled?.median !== undefined) ? weapon.de_rerolled.median : 0;

  let histWfmAvg = 0;
  let histWfmMax = 0;
  let histDeMedian = 0;
  let hasHistory = false;

  const currentName = weapon.name || null;
  if (currentName && weaponHistory && weaponHistory.weaponName === currentName && Array.isArray(weaponHistory.data)) {
    const histPoints = weaponHistory.data.filter(p => p && (p.wfm_avg_price > 0 || p.official_median > 0));
    if (histPoints.length > 0) {
      hasHistory = true;
      let sumWfm = 0;
      let sumDe = 0;
      let countWfm = 0;
      let countDe = 0;
      histPoints.forEach(p => {
        if (p.wfm_avg_price > 0) {
          sumWfm += p.wfm_avg_price;
          countWfm++;
          if (p.wfm_avg_price > histWfmMax) histWfmMax = p.wfm_avg_price;
        }
        if (p.official_median > 0) {
          sumDe += p.official_median;
          countDe++;
        }
      });
      if (countWfm > 0) histWfmAvg = sumWfm / countWfm;
      if (countDe > 0) histDeMedian = sumDe / countDe;
    }
  }

  if (hasHistory) {
    if (histWfmAvg > 0) {
      wfmAvg = wfmAvg > 0 ? (wfmAvg * 0.6 + histWfmAvg * 0.4) : histWfmAvg;
    }
    if (histDeMedian > 0) {
      offMedian = offMedian > 0 ? (offMedian * 0.6 + histDeMedian * 0.4) : histDeMedian;
    }
  }

  const maxWfmPrice = Math.max(wfmAvg, histWfmMax);
  const maxUnrolledRef = (weapon.de_unrolled && weapon.de_unrolled.max_price) || 0;
  const maxRerolledRef = (weapon.de_rerolled && weapon.de_rerolled.max_price) || 0;
  const absoluteMax = Math.max(maxUnrolledRef, maxRerolledRef, weapon.max_price || 0);
  const isHighValue = wfmAvg > 800 || (absoluteMax > 2500 && wfmAvg > 500) || histWfmAvg > 800;
  const hasBasicVolume = popularity >= 5.0 || realVolume >= 5;
  const isMetaWeapon = ((isHighValue || maxWfmPrice > 1200) && hasBasicVolume) || popularity >= 60;

  let clampMultiplier = 8;
  if (popularity > 0 || realVolume > 0) {
    if (popularity < 25 || realVolume < 25) {
      clampMultiplier = 5.5;
    } else if (popularity > 75 || realVolume > 100) {
      clampMultiplier = 12;
    }
  }

  if (isMetaWeapon) {
    clampMultiplier = Math.max(clampMultiplier, 22.0);
  }

  const absMinFloor = isMetaWeapon ? 50 : 15;
  if (offMedian > 0 && offMedian < absMinFloor) {
    offMedian = absMinFloor;
  }
  if (reMedian > 0 && reMedian < absMinFloor * 1.5) {
    reMedian = absMinFloor * 1.5;
  }

  const baseRefMedian = Math.max(absMinFloor, offMedian > 0 ? offMedian : (reMedian > 0 ? reMedian : 50));
  if (wfmAvg > baseRefMedian * clampMultiplier) {
    wfmAvg = baseRefMedian * clampMultiplier + (wfmAvg - baseRefMedian * clampMultiplier) * 0.15;
  }

  const isUnpopular = (popularity < 25 || realVolume < 25) && !isHighValue && !isMetaWeapon;

  if (isUnpopular) {
    if (offMedian > 150) {
      offMedian = 150 + (offMedian - 150) * 0.15;
    }
    if (reMedian > 300) {
      reMedian = 300 + (reMedian - 300) * 0.15;
    }
    if (wfmAvg > 400) {
      wfmAvg = 400 + (wfmAvg - 400) * 0.2;
    }
    if (offStdDev > 200) {
      offStdDev = 200 + (offStdDev - 200) * 0.1;
    }
  }

  const trash = Math.max(absMinFloor, offMedian > 0 ? offMedian : Math.round(wfmAvg * 0.15));

  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    goodReroll = wfmAvg > 0
      ? Math.round(wfmAvg * 0.3)
      : Math.round(trash * 2.5);
  }

  let godroll = 0;
  if (offMedian > 0) {
    let stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 1;
    if (stdDevScale > 5.0) {
      stdDevScale = 5.0;
    }
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    let stdDevMultiplier = 5;
    if (isUnpopular) {
      stdDevMultiplier = 1.5;
    }

    const deGodroll = Math.round(baseRef * (2.5 + Math.min(stdDevScale * stdDevMultiplier, 10)));

    if (wfmAvg > 0) {
      if (wfmAvg > baseRef * 2) {
        const baseWfmScale = wfmAvg * (1.2 + Math.min(stdDevScale * 0.5, 1.5));
        godroll = Math.round(deGodroll * 0.3 + baseWfmScale * 0.7);
      } else {
        godroll = Math.round(deGodroll * 0.6 + Math.min(wfmAvg * 0.8, baseRef * 20) * 0.4);
      }
    } else {
      godroll = deGodroll;
    }
  } else {
    godroll = wfmAvg > 0
      ? Math.round(wfmAvg * 1.2)
      : Math.round(trash * 6);
  }

  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(goodReroll * 2.5);
  }

  return { trash, goodReroll, godroll };
}

/**
 * @param {Object} weapon
 * @param {Array} itemAttributes
 * @param {Object} tiers
 * @returns {Object}
 */
export function calculateAdvancedPredictivePrice(weapon, itemAttributes, tiers, desirabilityMultiplier = 1.0) {
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || weapon.pos_tier?.top || []);

  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  const isMeleeWeapon = itemAttributes.some(attr => {
    const name = attr.name.toLowerCase();
    return name.includes("melee") || name.includes("range") || name.includes("combo") || name.includes("efficiency");
  });

  const midPositives = Array.isArray(weapon.pos_tier?.mid) ? weapon.pos_tier.mid : 
    isMeleeWeapon ? ["initial combo", "toxin", "heat", "combo duration"] : ["fire rate", "toxin", "heat", "elemental"];
  const trashPositives = Array.isArray(weapon.pos_tier?.trash) ? weapon.pos_tier.trash : [];

  const positiveWeights = [];
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();

      let attributeWeight = 0.15;

      const wDynamicWeights = weapon.dynamic_weights;
      let foundWeightVal = null;
      if (wDynamicWeights && typeof wDynamicWeights === "object") {
        const foundKey = Object.keys(wDynamicWeights).find(
          k => k.toLowerCase() === nameLower || nameLower.includes(k.toLowerCase()) || k.toLowerCase().includes(nameLower)
        );
        if (foundKey !== undefined && wDynamicWeights[foundKey] !== undefined && wDynamicWeights[foundKey] !== null) {
          foundWeightVal = parseFloat(wDynamicWeights[foundKey]);
        }
      }

      if (foundWeightVal !== null) {
        attributeWeight = foundWeightVal;
      } else {
        const isDynamicMeta = bestPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));
        const isMidMeta = midPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));
        const isTrashMeta = trashPositives.some(p => p.toLowerCase().includes(nameLower) || nameLower.includes(p.toLowerCase()));

        if (isTrashMeta) {
          attributeWeight = 0.0;
        } else if (isDynamicMeta) {
          attributeWeight = 1.0;
        } else if (isMidMeta) {
          attributeWeight = 0.60;
        }
      }

      totalMetaScore += attributeWeight;
      positiveWeights.push(attributeWeight);

      const range = (attr.maxIdeal || 0) - (attr.minIdeal || 0);
      const quality = range > 0 ? (attr.value - attr.minIdeal) / range : 0.5;
      totalRollQuality += Math.max(0, Math.min(1, quality));
    }
  });

  const avgRollQuality = positiveCount > 0 ? totalRollQuality / positiveCount : 0.5;
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = positiveWeights[0] || 0;
  } else if (positiveCount === 2) {
    finalMetaRatio = (((positiveWeights[0] || 0) + (positiveWeights[1] || 0)) / 2) * 1.10;
  } else if (positiveCount >= 3) {
    const sortedWeights = positiveWeights.toSorted((a, b) => b - a);
    if (sortedWeights[2] >= 0.8) {
      finalMetaRatio = (sortedWeights[0] + sortedWeights[1] + sortedWeights[2]) / 3;
    } else {
      finalMetaRatio = ((sortedWeights[0] + sortedWeights[1]) / 2) * 0.80 + sortedWeights[2] * 0.20;
    }
  }

  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  let effectiveMetaRatio = finalMetaRatio * desirabilityMultiplier;
  if (!hasNegAttr) {
    if (positiveCount >= 3) {
      effectiveMetaRatio = Math.min(effectiveMetaRatio, finalMetaRatio * 0.70); 
    } else {
      effectiveMetaRatio = Math.min(effectiveMetaRatio, finalMetaRatio * 0.45);
    }
  }


  let finalPrice = 0;

  if (effectiveMetaRatio >= 0.85) {
    const floorGodroll = tiers.godroll * 0.60;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.2) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    if (avgRollQuality <= 0.5) {
      const floorGood = tiers.goodReroll * 0.65;
      finalPrice = floorGood + (avgRollQuality * 2) * (tiers.goodReroll - floorGood);
    } else {
      const upperBound = tiers.goodReroll * 1.4;
      finalPrice = tiers.goodReroll + ((avgRollQuality - 0.5) * 2) * (upperBound - tiers.goodReroll);
    }
  } else {
    finalPrice = tiers.trash * (0.8 + avgRollQuality * 0.4);
  }

  const currentName = weapon.name || null;
  const isIncarnonDevouring = currentName && ["phenmor", "laetum", "felarx"].some(w => currentName.toLowerCase().includes(w));

  const curseNegs = Array.isArray(weapon.neg_tier?.curse) ? weapon.neg_tier.curse : 
    ["critical chance", "critical damage", "damage", "multishot", "fire rate", "attack speed", "melee damage", "range"];
  const buffNegs = Array.isArray(weapon.neg_tier?.buff) ? weapon.neg_tier.buff : 
    ["zoom", "recoil", "impact", "puncture"];

  let isBricked = false;

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      
      const isElementalNeg = ["toxin", "heat", "cold", "electric"].some(e => negName.includes(e));
      
      let isCurse = isElementalNeg || curseNegs.some(n => {
        const nl = n.toLowerCase();
        if (nl === "damage") return negName === "damage" || negName === "base damage" || negName === "melee damage";
        return nl === negName || negName.includes(nl) || nl.includes(negName);
      });
      let isBuff = !isElementalNeg && buffNegs.some(n => {
        const nl = n.toLowerCase();
        if (nl === "damage") return negName === "damage" || negName === "base damage" || negName === "melee damage";
        return nl === negName || negName.includes(nl) || nl.includes(negName);
      });

      if (isIncarnonDevouring && (negName.includes("critical chance") || negName.includes("critical damage"))) {
        isCurse = false;
        isBuff = true;
      }

      const isBrick = isElementalNeg || (isCurse && ["multishot", "critical chance", "critical damage", "damage", "base damage", "melee damage", "status chance"].includes(negName));
      if (isBrick) {
        isBricked = true;
      }

      if (isCurse) {
        finalPrice *= (effectiveMetaRatio >= 0.85) ? 0.35 : 0.15;
      } else if (isBuff) {
        finalPrice *= 1.0;
      } else {
        finalPrice *= 0.90;
      }
    }
  });

  if (isBricked) {
    finalPrice = tiers.trash;
  }

  finalPrice = Math.max(Math.round(finalPrice), tiers.trash);

  return {
    estimatedValue: finalPrice,
    suggestedMin: Math.round(finalPrice * 0.85),
    suggestedMax: Math.round(finalPrice * 1.15),
    adjustedScore: Math.round(((finalMetaRatio * 0.85) + (avgRollQuality * 0.15)) * 100)
  };
}

/**
 * @param {Object} weapon
 * @returns {number}
 */
export function calculatePotentialScore(weapon) {
  if (!weapon || (!weapon.wfm_avg_price && !weapon.wfm_avg && !weapon.official_median)) {
    return 0;
  }

  const basePrice = weapon.wfm_avg_price || weapon.wfm_avg || weapon.official_median;
  const offStdDev = weapon.official_stddev || 0;

  const volatilityFactor = basePrice > 0 ? (offStdDev / basePrice) : 0;
  let scoreV = Math.min(volatilityFactor * 50, 40);

  const wfmSamples = weapon.wfm_market_sample || 0;
  const dePop = weapon.de_unrolled?.pop || weapon.de_rerolled?.pop || 0;
  const popFactor = Math.max(wfmSamples, dePop * 2);
  let scoreP = Math.min(popFactor, 30);

  let scoreB = Math.min((basePrice / 500) * 30, 30);

  const finalScore = Math.round(scoreV + scoreP + scoreB);

  return Math.min(Math.max(finalScore, 0), 100);
}
