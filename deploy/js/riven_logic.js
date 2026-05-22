import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS } from "./config.js";

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