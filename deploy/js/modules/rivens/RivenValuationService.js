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
  const wfmAvg = weapon.wfm_avg_price || 0;
  const offMedian = weapon.official_median || 0;
  const offStdDev = weapon.official_stddev || 0;
  const reMedian = weapon.de_rerolled?.median || 0;

  // El piso (trash) suele rondar la mediana oficial si no hay suficiente volumen en WFM
  const trash = offMedian > 0 ? offMedian : Math.round(wfmAvg * 0.15);

  // Un buen reroll toma el máximo entre la mediana oficial con rolls y un 60% del precio en WFM
  let goodReroll = wfmAvg > 0 
    ? Math.max(Math.round(reMedian), Math.round(wfmAvg * 0.6))
    : Math.round(trash * 2.5);

  // Un godroll considera la desviación estándar (volatilidad) como multiplicador
  let godroll = wfmAvg > 0
    ? Math.round(wfmAvg * (1.5 + Math.min(offStdDev / (offMedian || 1), 2.0)))
    : Math.round(offMedian + (offStdDev * 6));

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
  const bestPositives = Array.isArray(weapon.pos) ? weapon.pos : (weapon.pos?.best || []);
  
  let positiveCount = 0;
  let totalMetaScore = 0;
  let totalRollQuality = 0;

  // 1. CLASIFICADOR DE ARQUETIPO DE ARMA
  const isMeleeWeapon = itemAttributes.some(attr => {
    const name = attr.name.toLowerCase();
    return name.includes("melee") || name.includes("range") || name.includes("combo") || name.includes("efficiency");
  });

  // 2. MATRICES DE SALVAGUARDA UNIVERSAL
  const universalGodStats = isMeleeWeapon
    ? ["melee damage", "critical chance", "critical damage", "range", "attack speed"]
    : ["multishot", "critical chance", "critical damage", "damage"];

  const universalTier2Stats = isMeleeWeapon
    ? ["initial combo", "toxin", "heat", "combo duration"]
    : ["fire rate", "toxin", "heat", "elemental"];

  // Evaluación de los positivos
  itemAttributes.forEach(attr => {
    if (attr.isPositive) {
      positiveCount++;
      const nameLower = attr.name.toLowerCase();

      let attributeWeight = 0;
      
      const isDynamicMeta = bestPositives.some(p => p.toLowerCase() === nameLower);
      const isUniversalGod = universalGodStats.some(u => nameLower.includes(u));
      const isUniversalTier2 = universalTier2Stats.some(t => nameLower.includes(t));

      if (isDynamicMeta) {
        attributeWeight = 1.0; 
      } else if (isUniversalGod) {
        attributeWeight = 0.90;
      } else if (isUniversalTier2) {
        attributeWeight = 0.65;
      }

      totalMetaScore += attributeWeight;

      const range = (attr.maxIdeal || 0) - (attr.minIdeal || 0);
      const quality = range > 0 ? (attr.value - attr.minIdeal) / range : 0.5;
      totalRollQuality += Math.max(0, Math.min(1, quality));
    }
  });

  const avgRollQuality = positiveCount > 0 ? totalRollQuality / positiveCount : 0.5;
  const finalMetaRatio = positiveCount > 0 ? totalMetaScore / positiveCount : 0;

  // 3. CURVA AJUSTADA DE VALORACIÓN COMERCIAL (NO LINEAL)
  let finalPrice = 0;

  if (finalMetaRatio >= 0.80) {
    const floorGodroll = tiers.goodReroll * 1.5;
    const ceilingGodroll = tiers.godroll;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 2) * (ceilingGodroll - floorGodroll));
  } else if (finalMetaRatio >= 0.50) {
    const floorGood = tiers.trash * 2.5;
    const ceilingGood = tiers.goodReroll * 1.3;
    finalPrice = floorGood + (avgRollQuality * (ceilingGood - floorGood));
  } else {
    finalPrice = tiers.trash;
  }

  // 4. CLASIFICADOR DINÁMICO DE NEGATIVAS
  const universalCriticalNegs = [
    "critical chance", "critical damage", "damage", "multishot", 
    "fire rate", "attack speed", "melee damage", "range"
  ];
  
  const isStatusMeta = bestPositives.some(p => p.toLowerCase().includes("status"));

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      
      const isUniversalBad = universalCriticalNegs.some(n => negName.includes(n));
      const isStatusBad = isStatusMeta && negName.includes("status");

      if (isUniversalBad || isStatusBad) {
        // Negativa destructiva
        finalPrice *= (finalMetaRatio >= 0.80) ? 0.35 : 0.15;
      } else {
        // Negativa inofensiva o "Perfect Negative"
        finalPrice *= 1.15; 
      }
    }
  });

  finalPrice = Math.max(Math.round(finalPrice), tiers.trash);

  return {
    estimatedValue: finalPrice,
    suggestedMin: Math.round(finalPrice * 0.85),
    suggestedMax: Math.round(finalPrice * 1.15),
    adjustedScore: Math.round(((finalMetaRatio * 0.7) + (avgRollQuality * 0.3)) * 100)
  };
}

/**
 * Calcula un score unificado de potencial/conveniencia de inversión (0-100).
 *
 * @param {Object} weapon - Objeto base del arma.
 * @returns {number} Score de 0 a 100.
 */
export function calculatePotentialScore(weapon) {
  if (!weapon || (!weapon.wfm_avg_price && !weapon.official_median)) {
    return 0;
  }

  const basePrice = weapon.wfm_avg_price || weapon.official_median;
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
