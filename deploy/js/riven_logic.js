import { RIVEN_BASE_STATS, WEAPON_TYPE_IDX, RIVEN_WEIGHTS } from "./config.js";


export function calculateRivenGrade(weaponData, statName, statValue, allStats) {
  if (!weaponData) return null;
  const dispo = weaponData.d || 1.0;
  const type = weaponData.t || "Rifle";

  const validStats = allStats.filter(s => s?.name);
  
  const curses = validStats.filter(s => s.isPenaltySlot === true);
  const hasCurse = curses.length > 0;
  const totalStats = validStats.length;

  let buffCount = 2;
  if (totalStats === 2) buffCount = 2;
  else if (totalStats === 3 && !hasCurse) buffCount = 3; 
  else if (totalStats === 3 && hasCurse) buffCount = 2; 
  else if (totalStats === 4) buffCount = 3;

  const typeIdx = WEAPON_TYPE_IDX[type] ?? 0;
  const baseCoef = RIVEN_BASE_STATS[statName]?.[typeIdx];

  if (baseCoef === undefined || baseCoef === 0) {
      return { grade: "?", pct: 0, range: "N/A", isGodRoll: false };
  }

  const currentStatObj = allStats.find(s => s.name === statName && s.projected === statValue);
  const isThisStatCurse = currentStatObj ? currentStatObj.isPenaltySlot : false;

  const wKey = `${buffCount}-${hasCurse ? 1 : 0}`;
  const w = RIVEN_WEIGHTS[wKey] || RIVEN_WEIGHTS["2-0"];
  
  const multiplier = isThisStatCurse ? w.curse : w.buff;

  const SCALING_FACTOR = 9; 
  
  let theoreticalVal = baseCoef * dispo * multiplier * SCALING_FACTOR;
  

  const idealMag = Math.abs(theoreticalVal);
  const minMag = idealMag * 0.9;
  const maxMag = idealMag * 1.1;

  const userMag = Math.abs(statValue);
  
  let pct = (userMag - minMag) / (maxMag - minMag) * 100;
  pct = Math.max(0, Math.min(100, pct)); 

  let grade = "F";

  if (pct >= 98)      grade = "SSS"; 
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
    isGodRoll: pct >= 95
  };
}