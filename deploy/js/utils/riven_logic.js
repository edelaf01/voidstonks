import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS, resolveBaseStatKey } from "../config.js";
import { state } from "../state.js";

/**
 * Calculate the grade for a single Riven stat.
 *
 * @param {Object} weaponData   Weapon data containing disposition (d) and type (t).
 * @param {string} statName     Normalized stat name (e.g., "Critical Chance").
 * @param {number} statValue    The projected value of the stat (already scaled by rank).
 * @param {boolean} isNeg       true if this is the negative (curse) stat.
 * @param {number} buffCount    Number of positive buff slots (2 or 3).
 * @param {boolean} hasNeg      true if the weapon has a negative slot.
 * @returns {{grade:string, pct:string, range:string, isGodRoll:boolean}}
 */
export function calculateRivenGrade(weaponData, statName, statValue, isNeg, buffCount, hasNeg) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  // Choose weight set based on number of buffs and presence of a negative slot
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
  // En la negativa (curse) una magnitud menor es mejor para el comprador, así que
  // invertimos el porcentaje: una negativa pequeña obtiene mejor grado que una grande.
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
 * Calculates the theoretical minimum, maximum, and median bounds for a riven stat.
 * All bounds are calculated for max rank (rank 8), to be scaled by rank in client if needed.
 */
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

  // Outlier / Abnormally high price handling for unpopular/off-meta weapons
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

  // Outlier / Abnormally high price handling for unpopular/off-meta weapons
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

// Shrinkage-blended stat weight: merges per-weapon auction data with the global baseline from the worker.
// Alpha grows with liquidity (full trust at ≥25), so low-volume weapons lean on the baseline.
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

/**
 * ¿Los pesos por arma del ML discriminan, o están saturados?
 *
 * En armas de poco volumen el entrenamiento empata media tabla al máximo: Seer trae 8 de sus 30
 * pesos a 1.0 — con Zoom y Recoil junto a Critical Damage. Un dato así no ordena nada, y usarlo
 * hace que un -Zoom brickee el riven o que Zoom aparezca como mejor positivo. Pasa en 31 de 608
 * armas (5%); en esos casos se cae al prior global, que sí ordena.
 *
 * Umbral en 25% Y al menos 6 empates: con >33% Seer se colaba, y el mínimo de 6 evita el falso
 * positivo en tablas cortas (un arma sana con CC/CD/Multishot a 1.0 son 3 empates legítimos).
 * @returns {boolean} true si los pesos NO sirven para discriminar.
 */
export function areWeightsDegenerate(dynWeightsRaw) {
  const vals = dynWeightsRaw && typeof dynWeightsRaw === "object"
    ? Object.values(dynWeightsRaw).map(v => parseFloat(v)).filter(Number.isFinite) : [];
  const empates = vals.filter(v => v >= 0.999).length;
  return vals.length >= 12 && empates >= 6 && (empates / vals.length) >= 0.25;
}

// Cortes de tier compartidos por positivos y negativos: un stat que el arma quiere con peso >=0.7 es
// TOP (y perderlo como negativa arruina), 0.4-0.7 es medio, por debajo da igual. Los negativos ya
// usaban estos mismos números en ui_rivens.js; aquí se centralizan para que no se separen.
export const STAT_TIER_TOP = 0.7;
export const STAT_TIER_MID = 0.4;

/**
 * Gradúa TODOS los stats de un arma en best/mid/meh usando SUS pesos del ML.
 *
 * Existe porque las listas curadas `pos`/`midPos` llegan vacías en 556 de 620 armas, así que el 90%
 * del catálogo caía en una lista genérica idéntica para todas — cuando el ML sí publica pesos por
 * arma para 608. Y varían de verdad: en Bo, Critical Chance es 0.48 (medio, no top) y en Kuva Bramma
 * Toxin Damage llega a 1.00.
 *
 * @param {object} weapon      arma con dynamic_weights
 * @param {object} [statBaseline] prior global por stat, para armas sin pesos fiables
 * @returns {{best:string[],mid:string[],meh:string[],fuente:string,pesos:object}|null}
 */
export function gradeWeaponStats(weapon, statBaseline = null) {
  const raw = (weapon && weapon.dynamic_weights) || null;
  const propios = raw && !areWeightsDegenerate(raw) ? raw : null;
  const tabla = propios || (statBaseline && typeof statBaseline === "object" ? statBaseline : null);
  if (!tabla) return null;

  // Sin encogimiento extra: los pesos que llegan aquí YA vienen mezclados con el prior global en el
  // entrenamiento (ML_local._mezclar, shrinkage bayesiano con K_PRIOR=8 sobre el nº de listados
  // locales del stat). Volver a mezclarlos aplicaría el prior dos veces y borraría la señal de las
  // armas que sí tienen datos propios suficientes.
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

  // Detect elements among active positive attributes
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

  // BONUS POR COMBO ELEMENTAL, calibrado con el mercado. El ratio de abajo es el precio mediano de
  // los rivens con ESE par de elementos frente a los que llevan otro par, medido DENTRO de cada arma:
  //   Viral (Tox+Cold)   1.44x   <- el único que se paga de verdad
  //   Radiación (Heat+El) 1.10x
  //   Corrosivo (Tox+El) 1.07x
  //   Blast (Heat+Cold)  0.95x   \
  //   Magnético (Cold+El) 0.89x   |  se pagan IGUAL o PEOR: no llevan bonus
  //   Gas (Tox+Heat)     0.76x   /
  // Antes Corrosivo cobraba lo mismo que Viral (+0.25) sin acercarse a su premium, y Gas/Magnético/
  // Blast cobraban bonus cuando el mercado los paga por debajo de la media. `comboName` se rellena
  // solo si hay bonus: la UI lo usa para anunciar "sinergia elemental" al nivel de un godroll, y
  // decir eso de un Gas a 0.76x era engañar.
  // Contexto que conviene no perder: llevar DOS elementos vale 0.75x que llevar uno solo (406 armas),
  // porque gastas dos de los tres huecos en algo que no es crit/multishot. El bonus solo compensa
  // dentro de ese peaje, no lo anula.
  let elementComboBonus = 0;
  let comboName = "";
  if (hasToxin && hasCold) {
    elementComboBonus = 0.25; // Viral: 1.44x medido
    comboName = "Viral";
  } else if (hasHeat && hasElectric) {
    elementComboBonus = 0.10; // Radiación: 1.10x
    comboName = "Radiation";
  } else if (hasToxin && hasElectric) {
    elementComboBonus = 0.10; // Corrosivo: 1.07x
    comboName = "Corrosive";
  }

  const dispo = weaponData ? (weaponData.disposition || weaponData.d || 1) : 1;
  // If low disposition, the combined elements have exponentially more value because they save invaluable mod space
  if (dispo < 0.8 && elementComboBonus > 0) {
    elementComboBonus *= 1.6; // Amplify elemental synergy by 60% for low-dispo weapons!
  }

  // 1. CLASIFICADOR DE ARQUETIPO DE ARMA
  // Use weapon type first (most reliable), fall back to stat name sniffing only if unknown
  const weaponType = weaponData?.t?.toLowerCase() || "";
  const isMeleeWeapon = weaponType === "melee" || weaponType === "zaw" || weaponType === "glaive"
    ? true
    : (weaponType === "" && itemAttributes.some(attr => {
      const name = attr.name.toLowerCase();
      // Only match unambiguously melee-only stat names
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

      // ORDEN DE PREFERENCIA, de más específico a más genérico:
      //   1. resolveStatWeight -> peso del ML de ESTE arma, mezclado con el prior global según la
      //      liquidez (alpha = liquidez/25). Cubre 606 de 620 armas y los 31 stats del juego, porque
      //      el prior (_global.pos del bundle) los trae todos. Es la vía normal.
      //   2. Las constantes de abajo son el ÚLTIMO RECURSO: solo se alcanzan si no hay ni pesos del
      //      arma ni prior, o sea si el bundle de ML no cargó. Son a dedo y no distinguen un Critical
      //      Damage de un Range, así que no conviene ampliar este camino: si falta un caso, lo que hay
      //      que arreglar es el prior, no añadir otro número aquí.
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

      // NO se pone un suelo al daño por facción (Grineer/Corpus/Infested). Lo hubo (0.30) con la idea
      // de que "es nicho pero no basura", y era un hardcodeo que contradecía al dato: el ML les da
      // peso mediano 0.010 —el MISMO que Zoom, Recoil o Ammo Maximum— y el suelo lo pisaba en el 91-96%
      // de las armas, regalando +4.1 puntos de score frente a un stat que el modelo valora igual.
      // En ventas reales tampoco se sostiene: un riven con +Daño vs Grineer se vende a 0.56× uno sin
      // él (Corpus 0.50×, Infested 0.45×), en el mismo rango que Reload Speed 0.56× o Ammo Maximum
      // 0.48×, que nunca tuvieron suelo. Las armas donde la facción SÍ vale se detectan solas: el ML
      // les da hasta 1.00 y ese peso se respeta.

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

  // Apply the dynamic element combo bonus to elements if found
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

  // Bug fix: use validRangeCount for avgRollQuality to avoid distorting the average
  // with stats that have no real DB range (they default to 0.5 which is misleading).
  // If no valid range stats exist, fall back to a neutral 0.5
  const avgRollQuality = validRangeCount > 0 ? totalRollQuality / validRangeCount : 0.5;

  // Evaluate combination meta ratio based on core stats to prevent dilution by 3rd positive.
  // Bug fix: use a COPY of positiveWeights (slice) before sorting to prevent mutating the original array,
  // which would break the index-based elementComboBonus application above.
  const sortedWeights = positiveWeights.slice().sort((a, b) => b - a);
  let finalMetaRatio = 0;
  if (positiveCount === 1) {
    finalMetaRatio = sortedWeights[0] || 0;
  } else if (positiveCount === 2) {
    finalMetaRatio = ((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2;
  } else if (positiveCount >= 3) {
    // Un 3er positivo basura (p.ej. daño por facción "Damage to Grineer") diluye el riven: pesa el 3º
    // al 30% (antes 20%) para que un 2-bueno-1-trash caiga del tier godroll a good-reroll. Un godroll
    // de verdad necesita que los 3 stats sean al menos decentes (3er positivo con peso >= ~0.33).
    finalMetaRatio = (((sortedWeights[0] || 0) + (sortedWeights[1] || 0)) / 2) * 0.70 + (sortedWeights[2] || 0) * 0.30;
  }

  // Determine if the Riven completely lacks a negative curse (curse/boost synergy)
  let hasNegAttr = false;
  itemAttributes.forEach(attr => {
    if (!attr.isPositive) hasNegAttr = true;
  });

  // A Riven completely lacking a negative curse can NEVER be a true Godroll.
  // We dynamically shift its quality tier down by scaling the effective meta ratio.
  let effectiveMetaRatio = finalMetaRatio;
  if (!hasNegAttr) {
    effectiveMetaRatio = finalMetaRatio * 0.78; // Scale down meta ratio to prevent Godroll classification but keep in Good Reroll/Utility
  }

  // 3. CURVA AJUSTADA DE VALORACIÓN COMERCIAL (La presencia del stat dicta el tier de precio, la calidad del roll define la posición dentro del tier)
  let finalPrice = 0;

  // La curva godroll pedía SOLO stats meta (effectiveMetaRatio), no magnitud: un CC/CD rolado al
  // mínimo entraba igual y su suelo era el 50% de tiers.godroll (~9.7× las ventas reales de DE en
  // armas populares), así que un roll mediocre de arma meta se tasaba como godroll. Un godroll de
  // verdad necesita stats meta Y que hayan rolado alto, así que exigimos también magnitud decente.
  // Los stats meta con magnitud floja caen a la curva de good-reroll, que es el centroide real.
  const isGodrollCombo = effectiveMetaRatio >= 0.80 && avgRollQuality >= 0.60;
  if (isGodrollCombo) {
    // Godroll Curve: floors at 50% of tiers.godroll to preserve massive inherent value of perfect stat combos.
    const floorGodroll = tiers.godroll * 0.50;
    finalPrice = floorGodroll + (Math.pow(avgRollQuality, 1.3) * (tiers.godroll - floorGodroll));
  } else if (effectiveMetaRatio >= 0.50) {
    // Good Reroll Curve: tiers.goodReroll is the MARKET CENTROID — most tradeable Rivens land here.
    // Floor is lower for unpopular weapons (no real trade data) to prevent inflating off-meta rolls.
    if (avgRollQuality <= 0.5) {
      const floorGood = tiers.goodReroll * (tiers.isUnpopular ? 0.40 : 0.65);
      finalPrice = floorGood + (avgRollQuality * 2.0) * (tiers.goodReroll - floorGood);
    } else {
      const upperBound = tiers.goodReroll * 1.4;
      finalPrice = tiers.goodReroll + ((avgRollQuality - 0.5) * 2.0) * (upperBound - tiers.goodReroll);
    }
  } else {
    // Trash tier: Riven with no meta synergy. Still respects the trash floor.
    finalPrice = tiers.trash * (0.8 + avgRollQuality * 0.4);
  }

  // 4. PENALIZADOR DINÁMICO DE NEGATIVAS CRÍTICAS
  // Antes había tres listas de stats en duro (universalCriticalNegs / brickNegs / mitigableNegs).
  // Se han retirado: el peso del stat COMO POSITIVO en ESTA arma (posWeightOf, más abajo) ya
  // clasifica lo mismo y encima con datos. Los umbrales salen de la distribución real del prior
  // global de stat_weights.json, donde los tres grupos NO se solapan:
  //   CC/CD/Damage/Multishot/BaseDamage .. 0.70-1.00  -> stat-killer (era universal/brick)
  //   status chance, projectile speed ....  0.28-0.37  -> mitigable
  //   ammo, magazine, impact, zoom, recoil  0.01-0.18  -> inofensiva
  // Además las listas fallaban por los dos lados: "range" y "status duration" estaban entre las
  // críticas universales aunque su peso global es 0.89 (solo melee) y 0.16 respectivamente, y
  // "recoil"/"vs Corpus" eran siempre inofensivas cuando llegan a 0.65/0.81 en ciertas armas.
  const NEG_KILLER = 0.60;    // perder un stat top del arma
  const NEG_MITIGABLE = 0.25; // molesta pero suele tener workaround

  const bestNegatives = Array.isArray(weapon.neg) ? weapon.neg : (weapon.neg?.best || []);

  // Peso del stat COMO POSITIVO según el meta real del arma (dynamic_weights / pos_tier).
  // Un best positive que aparece como negativa es un stat-killer (maldición); un mid positive
  // como negativa penaliza menos (suele haber workaround). Reutiliza la misma señal que usamos
  // para ponderar positivos, de modo que se adapta por arma sin listas en duro.
  const dynWeightsRaw = (weapon && weapon.dynamic_weights) || (weaponData && weaponData.dynamic_weights);

  // Con poco volumen los pesos por arma SATURAN: Seer trae 8 stats empatados a 1.0 (Critical Damage
  // junto a Zoom y Recoil), así que "el stat top del arma" deja de significar nada y cualquier
  // negativa brickeaba el riven — Seer con SUS mejores positivos se tasaba a 0.25× su mediana.
  // Pasa en 31 de 608 armas (5%). Si más de un tercio de los pesos está pegado al máximo, el dato
  // no discrimina: se descarta y se usa el prior global de stat_weights (vía statBaseline), que sí
  // ordena los stats. No se toca nada en las armas con datos sanos.
  // El detalle del umbral vive en areWeightsDegenerate (una sola definición: la UI gradúa los tiers
  // con el mismo criterio vía gradeWeaponStats, y si divergieran el panel mostraría como BEST un
  // stat que la tasación considera basura).
  const dynWeights = areWeightsDegenerate(dynWeightsRaw) ? null : dynWeightsRaw;

  const posWeightOf = (nameLower) => {
    if (dynWeights && typeof dynWeights === "object") {
      const key = Object.keys(dynWeights).find(k => {
        const kl = k.toLowerCase();
        return kl === nameLower || kl.includes(nameLower) || nameLower.includes(kl);
      });
      if (key && dynWeights[key] != null) return parseFloat(dynWeights[key]) || 0;
    }
    // Sin peso propio fiable: prior global por stat (statBaseline), que ordena bien CC/CD/Multishot
    // frente a zoom/recoil/ammo. Antes se caía directo a las listas pos/midPos del arma.
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

  // ¿El stat está entre los MEJORES de esta arma? Un umbral absoluto no vale para decidir el brick:
  // multishot tiene peso 1.00 en la mediana de armas pero 0.01 en su p10 (escopetas/melees donde de
  // verdad no aporta), así que un corte fijo en 0.60 dejaría sin brickear 239 de 608 armas donde el
  // stat sí es top. Lo medimos RELATIVO: entra en brick si está en el tercio alto de los pesos de
  // ESA arma y además no es irrelevante en absoluto.
  const _dwVals = dynWeights && typeof dynWeights === "object"
    ? Object.values(dynWeights).map(v => parseFloat(v)).filter(Number.isFinite).sort((a, b) => b - a)
    : [];
  const _topRef = _dwVals.length ? _dwVals[Math.min(_dwVals.length - 1, 2)] : null; // 3º mejor peso
  const esStatTopDelArma = (w) => _topRef != null
    ? (w >= Math.max(NEG_MITIGABLE, _topRef * 0.9))
    : (w >= NEG_KILLER);

  let isBricked = false;

  itemAttributes.forEach(attr => {
    if (!attr.isPositive) {
      const negName = attr.name.toLowerCase();
      // Negativa BUSCADA por el arma (neg_tier.buff del histórico, p.ej. zoom en Cyngas): sigue
      // siendo un dato de la propia arma, no una lista en duro.
      const isGoodNegative = bestNegatives.some(b => b.toLowerCase().includes(negName) || negName.includes(b.toLowerCase()));

      // El daño lo dicta el peso del stat en ESTA arma. "damage"/"base damage" se piden exactos
      // porque el fuzzy match de posWeightOf los confundiría con "critical damage".
      const negPosWeight = (negName === "damage" || negName === "base damage")
        ? (posWeightOf("base damage / melee damage") || posWeightOf("damage") || 0)
        : posWeightOf(negName);

      // Un stat top del arma como negativa la deja bricked: es la misma señal que antes daba
      // brickNegs, pero por arma (un -Range en un melee que vive del alcance sí brickea; el mismo
      // -Range en un rifle no) y sin lista que mantener.
      if (!isGoodNegative && esStatTopDelArma(negPosWeight)) {
        isBricked = true;
      }

      if (isGoodNegative) {
        // Negativa inofensiva o buscada (ej: zoom en Cyngas, neg_tier.buff) otorga multiplicador positivo
        finalPrice *= 1.20;
      } else if (esStatTopDelArma(negPosWeight)) {
        // Stat-killer: perder un stat top del arma hunde el valor
        finalPrice *= (effectiveMetaRatio >= 0.80) ? 0.25 : 0.10;
      } else if (negPosWeight >= 0.4) {
        // Mid positive como negativa: penaliza notablemente pero suele tener workaround, no destruye
        finalPrice *= 0.70;
      } else if (negPosWeight >= NEG_MITIGABLE) {
        // Negativa mitigable / moderada (ej: -status chance, -projectile speed) penaliza levemente
        finalPrice *= 0.85;
      } else {
        // Negativa irrelevante en esta arma (zoom, recoil, ammo, facción): casi un buff
        finalPrice *= 1.10;
      }
    }
  });

  if (isBricked) {
    finalPrice = tiers.trash;
  }

  // El meta-matching ya está incorporado en finalPrice (vía effectiveMetaRatio) y en rawScore
  // (vía finalMetaRatio). El desirabilityMultiplier externo también pondera ese mismo meta, así que
  // aplicarlo entero penalizaría dos veces los mismos stats. Usamos su raíz (media geométrica) para
  // conservar su señal única (negativas trash / falta de curse) sin doblar el castigo del meta.
  const desirabilityFactor = Math.sqrt(desirabilityMultiplier);
  let penalizedPrice = Math.round(finalPrice * desirabilityFactor);
  if (isBricked) {
    penalizedPrice = tiers.trash; // Bricked Riven's price is exactly the trash median price, not scaled down further
  } else {
    // The absolute minimum commercial value of a Riven is always its trash/unrolled price (tiers.trash)
    penalizedPrice = Math.max(penalizedPrice, tiers.trash);
  }
  // El score reparte 55% meta / 45% magnitud (antes 85/15). Con 85/15 la magnitud solo movía 15
  // puntos: un CC/CD rolado al MÍNIMO puntuaba 85/100 igual que un godroll, y como el score es lo
  // que posiciona el precio sobre la curva convexa (levelMap en riven_ml.js), un roll medio de un
  // arma popular salía a ~5x la mediana de ventas reales de DE. Medido sobre las 379 armas con
  // ventas DE: un roll medio (CC+CD magnitud 50%) pasa de 93/100 -> ~70/100 y de 5.3x -> ~1.7x.
  // El meta sigue mandando (un CC/CD basura no supera a un stat trash perfecto), pero la magnitud
  // ya separa el godroll del roll mediocre, que es lo que el mercado paga distinto.
  const rawScore = Math.round(((finalMetaRatio * 0.55) + (avgRollQuality * 0.45)) * 100);
  // Bug fix: for bricked Rivens, clamp adjustedScore to a max of 20 regardless of raw score
  // (a bricked Riven is always trash-tier, the score should reflect that)
  const adjustedScore = isBricked
    ? Math.min(20, Math.max(5, Math.round(rawScore * 0.10)))
    : Math.max(10, Math.min(100, Math.round(rawScore * desirabilityFactor)));

  // Ajuste por tendencia de mercado: trend_7d_pct (variación a 7 días) desplaza el precio
  // suavizado al 50% y limitado a ±30% para seguir el mercado sin sobre-reaccionar a ruido.
  // No se aplica a Rivens bricked (su valor es el suelo trash fijo, independiente del trend).
  if (!isBricked) {
    const trendPct = Number.isFinite(weapon.trend_7d_pct) ? weapon.trend_7d_pct : 0;
    if (trendPct !== 0) {
      const trendFactor = 1 + (Math.max(-30, Math.min(30, trendPct)) / 100) * 0.5;
      penalizedPrice = Math.max(tiers.trash, Math.round(penalizedPrice * trendFactor));
    }
  }

  // Soft compression for extremely high premium pricing to prevent excessive exaggeration
  // keeping it balanced and realistic within safe trade thresholds
  if (penalizedPrice > 9500) {
    penalizedPrice = Math.round(9500 + (penalizedPrice - 9500) * 0.25);
  }

  // Safe maximum ceiling for Riven trades to avoid hyper-inflated troll ranges
  penalizedPrice = Math.min(15000, penalizedPrice);

  // Rango sugerido dinámico: a mayor volatility_index, mayor incertidumbre y por tanto un
  // rango min-max más amplio. Base ±15%, hasta ±40% para mercados muy volátiles.
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

// Comparación tolerante de nombres de arma: el === estricto descartaba el historial en silencio
// por diferencias de mayúsculas/espacios entre el input del usuario y el nombre canónico.
export function sameWeaponName(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function calculateHybridTiers(weapon, weaponHistory = null) {
  const popularity = weapon.popularity_pct || 0;
  const realVolume = (weapon.de_unrolled?.pop || 0) + (weapon.de_rerolled?.pop || 0) + (weapon.wfm_market_sample || 0);

  let wfmAvg = weapon.wfm_avg_price || weapon.wfm_avg || 0;
  let offMedian = weapon.official_median || 0; // Base unrolled median
  let offStdDev = weapon.official_stddev || 0;
  let reMedian = (weapon.de_rerolled && weapon.de_rerolled.median !== undefined) ? weapon.de_rerolled.median : 0;

  // La "mediana" de rerolled con 1-2 ventas NO es un precio típico, es una anécdota, y de ella
  // cuelga todo el tier goodReroll (reMedian*1.6 + ...). Casos reales medidos: Attica de_rerolled
  // .median=1150 con pop=1 sobre un unrolled de 14pl (82×) -> goodReroll 2044pl para un arma que
  // vende a decenas; Akvasto 700 con pop=2 (70× su unrolled). Eso generaba la cola alta del p90:
  // las armas de la cola tenían goodReroll a 13.5× sus ventas reales frente a 2.2× en el resto,
  // y 31 de 38 tenían menos de 3 ventas.
  //
  // Con poco volumen acotamos el rerolled a un múltiplo del unrolled (que sí tiene ventas): el
  // premium por rolar es real, pero es ~2-4×, no 80×. Con volumen suficiente se respeta el dato.
  const _rePop = (weapon.de_rerolled && weapon.de_rerolled.pop) || 0;
  const _unMedian = (weapon.de_unrolled && weapon.de_unrolled.median) || offMedian || 0;
  if (reMedian > 0 && _rePop < 3 && _unMedian > 0) {
    const _capAnecdota = _unMedian * 4;
    if (reMedian > _capAnecdota) reMedian = _capAnecdota;
  }

  // Integrate historical price estimations from API history logs
  let histWfmAvg = 0;
  let histWfmMax = 0;
  let histDeMedian = 0;
  let hasHistory = false;

  // EMA decay: each older day is worth DECAY times the next newer one.
  // 0.72 ≈ day-1 weights 100%, day-2 weights 72%, day-3 weights 52%, etc.
  // Lower = more reactive to recent shifts (Incarnon, nerfs); raise to smooth more.
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

      // Flat max (all-time ceiling, used for meta detection — intentionally not EMA)
      histPoints.forEach(p => { if (p.wfm_avg_price > histWfmMax) histWfmMax = p.wfm_avg_price; });

      // Sort most-recent-first so EMA weights recency correctly.
      // Fechas no parseables van al final (peso mínimo) en vez de corromper el orden del sort.
      const _ts = (p) => { const t = Date.parse(p.date); return Number.isNaN(t) ? -Infinity : t; };
      const wfmPts = histPoints.filter(p => p.wfm_avg_price > 0).sort((a, b) => _ts(b) - _ts(a));
      const dePts  = histPoints.filter(p => p.official_median > 0).sort((a, b) => _ts(b) - _ts(a));

      // Flat mean (baseline reference for divergence check)
      const flatWfm = wfmPts.length > 0 ? wfmPts.reduce((s, p) => s + p.wfm_avg_price, 0) / wfmPts.length : 0;

      // EMA-weighted mean: recent days dominate → auto-corrects to Incarnon/nerf on the fly
      histWfmAvg  = wfmPts.length > 0 ? _ema(wfmPts, 'wfm_avg_price')   : 0;
      histDeMedian = dePts.length > 0  ? _ema(dePts,  'official_median') : 0;

      // Dynamic histAlpha: volatile market or low sample → lean on history more
      const volIdx = Number.isFinite(weapon.volatility_index) ? weapon.volatility_index : 0;
      const sample = weapon.wfm_market_sample || 0;
      let histAlpha = Math.max(0.10, Math.min(0.65,
          0.25 + (volIdx / 20) * 0.35 - Math.min(0.10, (sample / 30) * 0.10)
      ));

      // Structural shift correction: if EMA diverges from flat mean, the market has
      // changed regime (Incarnon, buff, meta shift). Reduce histAlpha so the old
      // baseline stops anchoring against the new reality. Self-corrects as days pass.
      if (flatWfm > 0 && histWfmAvg > 0) {
        const divergence = Math.abs(histWfmAvg - flatWfm) / flatWfm;
        histAlpha = Math.max(0.05, histAlpha * Math.max(0.10, 1 - divergence * 2.0));
      }

      if (histWfmAvg > 0)  wfmAvg   = wfmAvg   > 0 ? (wfmAvg   * (1 - histAlpha) + histWfmAvg   * histAlpha) : histWfmAvg;
      if (histDeMedian > 0) offMedian = offMedian > 0 ? (offMedian * (1 - histAlpha) + histDeMedian * histAlpha) : histDeMedian;
    }
  }

  // Market-derived signals replace the hardcoded meta list: a weapon is "meta" when
  // its real liquidity/value justifies relaxed price clamping (high WFM avg, high max
  // with volume, or strong popularity), so the model self-adjusts as the meta shifts.
  const maxWfmPrice = Math.max(wfmAvg, histWfmMax);
  const maxUnrolledRef = (weapon.de_unrolled && weapon.de_unrolled.max_price) || 0;
  const maxRerolledRef = (weapon.de_rerolled && weapon.de_rerolled.max_price) || 0;
  const absoluteMaxRef = Math.max(maxUnrolledRef, maxRerolledRef, weapon.max_price || 0);
  const isHighValue = wfmAvg > 800 || (absoluteMaxRef > 2500 && wfmAvg > 500) || histWfmAvg > 800;
  const hasBasicVolume = popularity >= 5.0 || realVolume >= 5;
  const isMetaWeapon = ((isHighValue || maxWfmPrice > 1200) && hasBasicVolume) || popularity >= 60;

  // Dynamic Speculative Hyperinflation Safeguard linked directly to transaction volume (liquidity)
  let clampMultiplier = 8.0;
  if (popularity > 0 || realVolume > 0) {
    if (popularity < 25.0 || realVolume < 25) {
      clampMultiplier = 5.5; // Very low movement = tight clamp to prevent speculative spikes
    } else if (popularity > 75.0 || realVolume > 100) {
      clampMultiplier = 12.0; // High liquid movement = relaxed clamp
    }
  }

  if (isMetaWeapon) {
    clampMultiplier = Math.max(clampMultiplier, 22.0); // Allow much higher WFM pricing scale for top meta/Incarnon weapons
  }

  // El clamp se aplica sobre el UNROLLED (official_median), pero wfmAvg son asks de rivens ROLADOS:
  // comparar ambos infla el límite por el premium de rolar. Cuando hay mediana real de rerolled la
  // usamos como referencia, que es la magnitud que wfmAvg intenta estimar.
  //
  // Además el clamp estaba INVERTIDO respecto al riesgo: las armas populares son las que tienen los
  // asks más especulativos (medido: asks/ventas reales de DE = 17.7× en el cuartil superior de
  // liquidez frente a 3.9× en el inferior) y justo a esas se les daba el clamp más laxo (22× contra
  // 5.5×). Resultado: tiers.godroll salía a ~15× las ventas reales en armas meta y el tasador
  // heurístico sobrevaloraba ~11×. Con referencia rerolled el clamp muerde donde debe; el margen
  // extra de las meta se mantiene (siguen cotizando caro de verdad), pero acotado.
  const baseRefMedian = reMedian > 0 ? reMedian : (offMedian > 0 ? offMedian : 50);
  const clampRef = reMedian > 0 ? Math.min(clampMultiplier, 6.0) : clampMultiplier;
  if (wfmAvg > baseRefMedian * clampRef) {
    wfmAvg = baseRefMedian * clampRef + (wfmAvg - baseRefMedian * clampRef) * 0.15;
  }

  const isUnpopular = (popularity < 25.0 || realVolume < 25) && !(isHighValue && hasBasicVolume) && !isMetaWeapon;

  // Dampen outliers if unpopular/low pop weapon AND NOT premium/high-value
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

  // 1. Trash/Base tier: siempre respeta el official_median (transacciones reales) como suelo
  let trash = offMedian > 0 ? offMedian : ((weapon.de_unrolled?.median > 0) ? weapon.de_unrolled.median : ((weapon.de_unrolled?.min_price > 0) ? weapon.de_unrolled.min_price : (isMetaWeapon ? 50 : 15)));
  const maxTrashFloor = isMetaWeapon ? 250 : 100;
  if (trash > maxTrashFloor) {
    trash = maxTrashFloor;
  }

  // 2. Good Reroll tier
  let goodReroll = 0;
  if (reMedian > 0) {
    goodReroll = Math.round(reMedian * 1.6 + Math.min(wfmAvg * 0.15, reMedian * 2));
  } else {
    // Sin rerolled real caemos a los asks (wfmAvg*0.3), pero el ask está inflado sobre la venta
    // (medido: 17.7× en el cuartil superior de liquidez), así que sin un tope el tier se despega
    // del precio real del arma. Lo acotamos a un múltiplo del suelo de transacciones reales.
    goodReroll = wfmAvg > 0
      ? Math.min(Math.round(wfmAvg * 0.3), Math.round(trash * 5))
      : Math.round(trash * (isUnpopular ? 1.8 : 2.5)); // tighter multiplier when no real trade data
  }

  // 3. Godroll tier
  let godroll = 0;
  if (offMedian > 0) {
    // No stddev data means we have NO evidence of volatility — assume a tight spread, not a
    // speculative premium. (Applies to every weapon; only data-rich ones override this default.)
    const stdDevScale = offStdDev > 0 ? (offStdDev / offMedian) : 0.25;
    const baseRef = reMedian > 0 ? reMedian : offMedian;

    // Dynamic Standard Deviation Multiplier: low-liquidity/unpopular weapons shouldn't scale as fast
    let stdDevMultiplier = 5.0;
    if (isUnpopular) {
      stdDevMultiplier = 1.5; // Dampen standard deviation multiplier for low-volume/unpopular items
    }

    // Base DE record prediction — anchored to REAL completed-trade medians (de_rerolled / history).
    const deGodroll = Math.round(baseRef * (2.5 + Math.min(stdDevScale * stdDevMultiplier, 10.0)));

    if (wfmAvg > 0) {
      if (wfmAvg > baseRef * 2) {
        // WFM listings are ASK prices (speculative), not completed sales. Weight the real
        // DE-record prediction at least as much as the WFM scale so a few high listings can't
        // inflate the godroll past what the weapon actually trades for. Applies to all weapons.
        //
        // El ask ya viene inflado sobre la venta real (medido: 17.7× la mediana de ventas de DE en el
        // cuartil superior de liquidez), así que MULTIPLICARLO otra vez por 1.2-2.7 era el término que
        // fijaba el techo: deGodroll salía a 5.0× las ventas reales y tiers.godroll acababa en 12.4×.
        // El ask entra como PISO orientativo del techo, no amplificado, y con el peso del dato real
        // (DE) por delante. Se sigue respetando el observedMax*1.3 de más abajo.
        // El 0.3 era FIJO, y ahí entraba la inflación: da igual que el ask sea 2× el precio real de
        // venta o 20×, pesaba lo mismo. Torid pide 7337p con mediana real de 429p (17×), así que ese
        // 0.3 metía +2201p de un precio que nadie paga. Ahora el peso decae con la credibilidad del
        // ask: se conserva entero mientras el ask esté en el rango sano (<=3× la venta real) y baja
        // hasta 0.05 en las armas con burbuja. No se anula nunca — el ask sigue siendo información
        // sobre el techo al que la gente ASPIRA, solo deja de fijar el precio.
        // El descuento es UNIDIRECCIONAL a propósito: solo se aplica cuando el ask tira del precio
        // hacia ARRIBA (ask > deGodroll). Si el ask queda por debajo hace de freno, y quitarle peso
        // lo soltaba: medido, el tramo 3-8× subía un 18% en vez de bajar.
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
      : Math.round(trash * (isUnpopular ? 3.5 : 6)); // no real data + unpopular → much tighter ceiling
  }

  // Suelo de mercado real: el trash nunca debe caer por debajo del precio mínimo unrolled observado
  const observedMin = (weapon.de_unrolled && weapon.de_unrolled.min_price) || 0;
  if (observedMin > 0 && trash < observedMin) {
    trash = observedMin;
  }

  // Techo de mercado real: el godroll no debe inventar precios por encima del máximo realmente
  // observado (DE + web) con un margen del 30%, filtrando precios troll inalcanzables
  const observedMax = Math.max(absoluteMaxRef, weapon.web_max || 0);
  if (observedMax > 0 && godroll > observedMax * 1.3) {
    godroll = Math.round(observedMax * 1.3);
  }

  // Suelo trash data-driven del ML (worker -> ml_trash, generado por generar_tiers_servibles.py):
  // mediana real de listados trash por arma. Sobreescribe el cap genérico maxTrashFloor cuando hay
  // evidencia real (p.ej. Torid trash ~300pl, por encima del cap de 250 de armas meta).
  if (weapon.ml_trash && weapon.ml_trash.min > 0) {
    trash = Math.max(trash, weapon.ml_trash.min);
  }

  // Garantías de límites coherentes entre tiers
  if (goodReroll <= trash) {
    goodReroll = Math.round(trash * 1.8);
  }
  if (godroll <= goodReroll) {
    godroll = Math.round(godroll * 2.5);
  }

  // Redondeo en origen: el blend con historial produce floats y estos valores van directos a UI.
  return { trash: Math.round(trash), goodReroll: Math.round(goodReroll), godroll: Math.round(godroll), isUnpopular };
}

/**
 * Clasifica el MERCADO del arma (no el roll): demanda real, especulación y momentum.
 * Implementa el "Avg List vs Avg Trade" + gradiente de liquidez del análisis de mercado:
 *   - ratio = asks WFM vivos / precio central robusto (mediana histórica 1 mes, band.typical).
 *     ~1.5–3 = sano; >=8 = listings inflados muy por encima del valor real (burbuja).
 *   - vol_dia = listings/día (liquidez estable, del historial).
 *   - trend = momentum % (últimos 7d vs primeros 7d).
 * @param {object} meta   objeto de arma (/api/rivens): wfm_avg, official_median, band...
 * @param {object} [band] price band servida (typical=hist_med, vol_dia, trend). Si falta, usa meta.band.
 * @returns {{flag:string,label:string,emoji:string,ratio:number,vol:number,trend:number,advice:string}|null}
 */
export function classifyWeaponMarket(meta, band = null) {
  if (!meta) return null;
  const b = band || meta.band || {};
  // El denominador tiene que ser comparable con el numerador: wfm_avg es el ask de rivens ROLADOS,
  // así que dividir por official_median (mediana de rivens SIN rolar) mezclaba peras y manzanas e
  // inflaba el ratio ~3×. Medido sobre 237 armas con muestra fiable: con official_median el 97% del
  // catálogo salía "burbuja" (p50=39.5×); con de_rerolled.median baja a 79% (p50=13.4×). Un flag que
  // se dispara en casi todo no informa de nada.
  const _deReMed = (meta.de_rerolled && meta.de_rerolled.median) || 0;
  const _deRePop = (meta.de_rerolled && meta.de_rerolled.pop) || 0;
  // ¿El denominador es comparable de verdad? Solo si DE trae muestra de rivens ROLADOS. Con pop<3
  // (el 61% del catálogo: 371 de 608 armas) hay que caer a official_median, que es de rivens SIN
  // ROLAR, y el ratio se dispara por construcción: Cestra tiene UNA venta registrada y sale 56×
  // (ask 1016 / unrolled 18). Cantar "sobreprecio" con eso es inventarse un veredicto, así que se
  // marca la referencia como no fiable y más abajo se informa de la falta de datos.
  const refFiable = _deReMed > 0 && _deRePop >= 3;
  let typical = refFiable ? _deReMed : (b.typical || meta.official_median || 0);
  const wfm = meta.wfm_avg_price || meta.wfm_avg || 0;
  const vol = b.vol_dia != null ? b.vol_dia : (meta.wfm_market_sample || 0);
  const trend = b.trend != null ? b.trend : (meta.trend_7d_pct || 0);

  // band.typical viene de la banda servida (snapshot al init); si tenemos el historial semanal
  // en vivo del arma, mezclamos su mediana de trades reales para que la clasificación
  // (meta/burbuja/ilíquido) no se quede anclada a una banda desactualizada.
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

  // UMBRAL. El 8 original venía de la intuición "ask sano = 1.5-3× el valor real", pero el mercado
  // entero de rivens pide muy por encima de lo que se vende: con el denominador correcto la mediana
  // del catálogo es 13.4× y el p75 son 23.6×. Con 8 se marcaba el 79% de las armas. 24 ≈ p75 deja
  // "burbuja" para el cuartil realmente especulativo, que es lo que el badge quiere decir.
  // Ojo al leerlo: que un arma NO sea burbuja no significa que su ask sea justo — la inflación de
  // los asks es sistémica (ver el 0.3 del tier godroll, que ya se descuenta por credibilidad).
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
    // Ni burbuja ni sano: simplemente no hay con qué juzgarlo. Decirlo es más útil que fingir.
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
  // `refFiable` sale fuera para que la UI no pinte el ratio cuando el denominador no es comparable:
  // "piden 56× su valor" es falso si ese 56 nace de dividir entre la mediana de rivens sin rolar.
  return { flag, label, emoji, ratio, vol, trend, advice, refFiable };
}
