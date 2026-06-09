/**
 * RivenValuationService.js
 * Capa de dominio (Vanilla JS) que contiene la lógica matemática central y las reglas de negocio
 * para la tasación predictiva y scoring de mods Agrietados.
 */

/**
 * Calcula los umbrales de mercado (Trash, Good Reroll, Godroll) para un arma,
 * combinando las medianas oficiales (DE) y promedios reales (Warframe Market).
 *
 * @param {Object} weapon - Objeto de metadatos del arma (contiene wfm_avg_price, official_median, etc.)
 * @returns {Object} { trash, goodReroll, godroll }
 */
export function calculateHybridTiers(weapon) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0;
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled?.median !== undefined) ? weapon.de_rerolled.median : 0;

  // Integrate historical price estimations from API history logs
  let histWfmAvg = 0;
  let histWfmMax = 0;
  let histDeMedian = 0;
  let hasHistory = false;

  const currentName = weapon.name || (globalThis.state && globalThis.state.currentWeaponHistory ? globalThis.state.currentWeaponHistory.weaponName : null);
  if (currentName && globalThis.state && globalThis.state.currentWeaponHistory && globalThis.state.currentWeaponHistory.weaponName === currentName && Array.isArray(globalThis.state.currentWeaponHistory.data)) {
    const histPoints = globalThis.state.currentWeaponHistory.data.filter(p => p && (p.wfm_avg_price > 0 || p.official_median > 0));
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

  // Stabilize averages by blending current data with historical estimations
  if (hasHistory) {
    if (histWfmAvg > 0) {
      wfmAvg = wfmAvg > 0 ? (wfmAvg * 0.6 + histWfmAvg * 0.4) : histWfmAvg;
    }
    if (histDeMedian > 0) {
      offMedian = offMedian > 0 ? (offMedian * 0.6 + histDeMedian * 0.4) : histDeMedian;
    }
  }

  // Check if this is a high-demand premium variant (e.g. Prime, Tenet, Kuva)
  let isPremiumVariant = false;
  if (currentName) {
    const nameLower = currentName.toLowerCase();
    if (nameLower.includes("tenet") || nameLower.includes("kuva") || nameLower.includes("prime") || nameLower.includes("vandal") || nameLower.includes("wraith") || nameLower.includes("prisma")) {
      isPremiumVariant = true;
    }
  }

  const maxWfmPrice = Math.max(wfmAvg, histWfmMax);
  const META_WEAPONS = new Set(["torid", "latron", "angstrum", "boar", "toxocyst", "dual toxocyst", "furis", "burston", "miter", "magistar", "ceramic dagger", "hate", "glaive", "phenmor", "felarx", "laetum", "epitaph", "nataruk", "stropha", "pennant", "sporelacer"]);
  const isMetaWeapon = isPremiumVariant || (currentName && META_WEAPONS.has(currentName.toLowerCase()));

  // Dynamic Speculative Hyperinflation Safeguard linked directly to transaction volume (liquidity)
  let clampMultiplier = 8;
  if (popularity > 0 || realVolume > 0) {
    if (popularity < 25 || realVolume < 25) {
      clampMultiplier = 5.5; // Very low movement = tight clamp to prevent speculative spikes
    } else if (popularity > 75 || realVolume > 100) {
      clampMultiplier = 12; // High liquid movement = relaxed clamp
    }
  }

  if (isMetaWeapon) {
    clampMultiplier = Math.max(clampMultiplier, 22.0); // Allow much higher WFM pricing scale for top meta/Incarnon weapons
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

  // Resolve true maximum registered DE price
  const maxUnrolled = (weapon.de_unrolled?.max_price) || 0;
  const maxRerolled = (weapon.de_rerolled?.max_price) || 0;
  const absoluteMax = Math.max(maxUnrolled, maxRerolled, weapon.max_price || 0);

  // Consistent high-value evaluation (must have high average or high max with decent average)
  const isHighValue = wfmAvg > 800 || (absoluteMax > 2500 && wfmAvg > 500) || histWfmAvg > 800;
  const isUnpopular = (popularity < 25 || realVolume < 25) && !isHighValue && !isMetaWeapon;

  // Dampen outliers if unpopular/low pop weapon AND NOT igh-value
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

  // 1. Trash/Base tier: siempre respeta el official_median (transacciones reales) como suelo
  const trash = Math.max(absMinFloor, offMedian > 0 ? offMedian : Math.round(wfmAvg * 0.15));

  // 2. Good Reroll tier
  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    goodReroll = wfmAvg > 0
      ? Math.round(wfmAvg * 0.3)
      : Math.round(trash * 2.5);
  }

  // 3. Godroll tier
  let godroll = 0;
  if (offMedian > 0) {
    let stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 1;
    if (stdDevScale > 5.0) {
      stdDevScale = 5.0; // clamp standard deviation scale to avoid outliers distorting godroll benchmark
    }
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    // Dynamic Standard Deviation Multiplier: low-liquidity/unpopular weapons shouldn't scale as fast
    let stdDevMultiplier = 5;
    if (isUnpopular) {
      stdDevMultiplier = 1.5; // Dampen standard deviation multiplier for low-volume/unpopular items
    }

    // Base DE record prediction
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

  // Sanity checks para asegurar que la escala ascendente tenga sentido
  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(goodReroll * 2.5);
  }

  return { trash, goodReroll, godroll };
}

/**
 * Función central de tasación en tiempo real cuando el usuario introduce estadísticas.
 *
 * @param {Object} weapon - Objeto base del arma.
 * @param {Array} itemAttributes - Arreglo de los stats seleccionados [{ name: "Critical Chance", value: 120, isPositive: true, minIdeal: 100, maxIdeal: 150 }, ...]
 * @param {Object} tiers - Objeto proveniente de calculateHybridTiers()
 * @returns {Object} Objeto con la tasación final (estimatedValue, suggestedMin, suggestedMax, adjustedScore)
 */
export function calculateAdvancedPredictivePrice(weapon, itemAttributes, tiers) {
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || weapon.pos_tier?.top || []);

  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  // 1. CLASIFICADOR DE ARQUETIPO DE ARMA
  const isMeleeWeapon = itemAttributes.some(attr => {
    const name = attr.name.toLowerCase();
    return name.includes("melee") || name.includes("range") || name.includes("combo") || name.includes("efficiency");
  });

  const midPositives = Array.isArray(weapon.pos_tier?.mid) ? weapon.pos_tier.mid : 
    isMeleeWeapon ? ["initial combo", "toxin", "heat", "combo duration"] : ["fire rate", "toxin", "heat", "elemental"];
  const trashPositives = Array.isArray(weapon.pos_tier?.trash) ? weapon.pos_tier.trash : [];

  // Evaluación de los positivos
  const positiveWeights = [];
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();

      let attributeWeight = 0.15; // Default utility weight

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
    // Bonificación por concentración: los mods de 2 stats positivos tienen valores numéricos más altos.
    finalMetaRatio = (((positiveWeights[0] || 0) + (positiveWeights[1] || 0)) / 2) * 1.10;
  } else if (positiveCount >= 3) {
    const sortedWeights = positiveWeights.toSorted((a, b) => b - a);
    if (sortedWeights[2] >= 0.8) {
      // Symmetrical weight for triple top stats to prevent underestimating perfect 3-stat rolls
      finalMetaRatio = (sortedWeights[0] + sortedWeights[1] + sortedWeights[2]) / 3;
    } else {
      // Dilution blend (80% top 2, 20% 3rd)
      finalMetaRatio = ((sortedWeights[0] + sortedWeights[1]) / 2) * 0.80 + sortedWeights[2] * 0.20;
    }
  }

  // Determine if the Riven completely lacks a negative curse (curse/boost synergy)
  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  // A Riven completely lacking a negative curse can NEVER be a true Godroll.
  let effectiveMetaRatio = finalMetaRatio;
  if (!hasNegAttr) {
    if (positiveCount >= 3) {
      // Pierden ~25% de stats numéricas respecto a uno con negativa, 
      // pero mitigamos la penalización para que retengan más valor (0.82)
      effectiveMetaRatio = finalMetaRatio * 0.82; 
    } else {
      // Pierden ~20% de stats numéricas respecto a uno con negativa (0.80)
      effectiveMetaRatio = finalMetaRatio * 0.80;
    }
  }


  // 3. CURVA AJUSTADA DE VALORACIÓN COMERCIAL (NO LINEAL)
  let finalPrice = 0;

  if (effectiveMetaRatio >= 0.85) {
    // Godroll Curve: floors at 60% of tiers.godroll to preserve massive inherent value of perfect stat combos.
    const floorGodroll = tiers.godroll * 0.60;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.2) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    // Good Reroll Curve: tiers.goodReroll is the MARKET CENTROID — most tradeable Rivens land here.
    // Starts at 65% of tiers.goodReroll even at quality=0.0 to prevent devaluing solid utility stats to trash.
    if (avgRollQuality <= 0.5) {
      const floorGood = tiers.goodReroll * 0.65;
      finalPrice = floorGood + (avgRollQuality * 2) * (tiers.goodReroll - floorGood);
    } else {
      const upperBound = tiers.goodReroll * 1.4;
      finalPrice = tiers.goodReroll + ((avgRollQuality - 0.5) * 2) * (upperBound - tiers.goodReroll);
    }
  } else {
    // Trash tier: no meta synergy. Respects trash floor.
    finalPrice = tiers.trash * (0.8 + avgRollQuality * 0.4);
  }

  // 4. CLASIFICADOR DINÁMICO DE NEGATIVAS (con fallback para esquemas viejos)
  const currentName = weapon.name || (globalThis.state && globalThis.state.currentWeaponHistory ? globalThis.state.currentWeaponHistory.weaponName : null);
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
      
      let isCurse = isElementalNeg || curseNegs.some(n => n.toLowerCase().includes(negName) || negName.includes(n.toLowerCase()));
      let isBuff = !isElementalNeg && buffNegs.some(n => n.toLowerCase().includes(negName) || negName.includes(n.toLowerCase()));

      // If it's an Incarnon weapon with Devouring Attrition (Phenmor, Laetum, Felarx), negative critical stats are actually perfect buffs!
      if (isIncarnonDevouring && (negName.includes("critical chance") || negName.includes("critical damage"))) {
        isCurse = false;
        isBuff = true;
      }

      const isBrick = isElementalNeg || (isCurse && ["multishot", "critical chance", "critical damage", "damage", "melee damage"].some(b => negName.includes(b)));
      if (isBrick) {
        isBricked = true;
      }

      if (isCurse) {
        // Negativa destructiva
        finalPrice *= (effectiveMetaRatio >= 0.85) ? 0.35 : 0.15;
      } else if (isBuff) {
        // Negativa inofensiva o "Perfect Negative"
        // Since Quality_stat was already calculated on the negative-boosted range, we set the multiplier to 1.0 to avoid double dipping.
        finalPrice *= 1.0;
      } else {
        // Negativa neutral (ni buena ni mala)
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
 * Calcula un score unificado de potencial/conveniencia de inversión (0-100).
 *
 * @param {Object} weapon - Objeto base del arma.
 * @returns {number} Score de 0 a 100.
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
