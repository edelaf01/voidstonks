import { state } from "../../state.js";
import { normalizeStatName } from "../../utils/rivens/riven_naming.js";
import {
  getRivenStatRange,
  calculateAdvancedPredictivePrice,
  calculateHybridTiers,
  gradeWeaponStats,
  STAT_TIER_TOP,
  STAT_TIER_MID,
} from "../../utils/rivens/riven_logic.js";
import { getMetaStats } from "./riven_market.service.js?v=1.9";
import { metaConPesosDeFamilia } from "./riven_weights.service.js";

// Riven roll appraisal: what it is worth and what it compares against. Returns data, never HTML.

export function computeDesirabilityMultiplier(stats, meta, weaponData) {
  const wType = (weaponData?.t || "").toLowerCase();
  const isMelee = wType === "melee" || wType === "zaw" || wType === "glaive";

  const _grado = gradeWeaponStats(metaConPesosDeFamilia(meta || {}, meta?.name || weaponData?.name),
    state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);
  const _gBest = _grado && _grado.best.length ? _grado.best : null;
  const _gMid = _grado && _grado.best.length ? _grado.mid : null;

  // Universal fallbacks, only without weapon weights and prior (ML bundle not loaded).
  // Plain "Damage" matches 13 stats: matchMeta special-cases it.
  const universalGodPos = isMelee
    ? ["Melee Damage", "Critical Chance", "Critical Damage", "Damage", "Range", "Attack Speed"]
    : ["Multishot", "Critical Chance", "Critical Damage", "Damage"];
  // Heat/Cold/Toxin are not measured mids; they stay because this is the last resort.
  const universalMidPos = isMelee
    ? ["Initial Combo", "Combo Duration", "Toxin", "Heat", "Cold", "Electricity"]
    : ["Fire Rate", "Toxin", "Heat", "Cold", "Electricity"];
  const universalCriticalNegs = ["Critical Chance", "Critical Damage", "Damage", "Base Damage", "Multishot", "Fire Rate", "Attack Speed", "Melee Damage", "Range", "Status Duration"];
  const brickNegs = ["Damage", "Base Damage", "Multishot", "Critical Chance", "Critical Damage", "Melee Damage", "Status Chance"];
  const ruinedNegs = ["Damage", "Base Damage", "Multishot", "Critical Chance", "Critical Damage", "Status Chance"];

  let positiveCount = 0;
  let metaMatches = 0;
  let trashCount = 0;
  let hasNegative = false;
  let hasBrickNegative = false;

  stats.forEach(s => {
    const normalized = normalizeStatName(s.name, weaponData?.t);
    const normLower = normalized.toLowerCase();
    const matchMeta = (m) => {
      const ml = m.toLowerCase();
      if (ml === "damage") return normLower === "damage" || normLower === "base damage" || normLower === "melee damage";
      return normLower.includes(ml) || ml.includes(normLower);
    };

    if (s.value < 0) {
      hasNegative = true;
      const isFactionDmgNeg = normLower.includes(" to ") || normLower.includes("vs");
      const isGoodNeg = isFactionDmgNeg ||
        (Array.isArray(meta?.neg) && meta.neg.some(matchMeta)) ||
        (Array.isArray(meta?.midNeg) && meta.midNeg.some(matchMeta)) ||
        ["zoom", "recoil", "ammo maximum", "status duration", "magazine capacity"].some(t => normLower.includes(t));

      // A negative hurts as much as the weapon wants that stat as a positive (same idea as NEG_KILLER).
      const _pesoNeg = _grado && _grado.pesos
        ? (Object.entries(_grado.pesos).find(([k]) => matchMeta(k)) || [null, 0])[1] : null;
      const isBrick = !isFactionDmgNeg && (_pesoNeg != null
        ? _pesoNeg >= STAT_TIER_TOP : brickNegs.includes(normalized));
      const isRuined = !isFactionDmgNeg && (_pesoNeg != null
        ? _pesoNeg >= STAT_TIER_TOP : ruinedNegs.includes(normalized));
      const isUniversalBadNeg = !isFactionDmgNeg && (_pesoNeg != null
        ? _pesoNeg >= STAT_TIER_MID : universalCriticalNegs.includes(normalized));

      if (isBrick) hasBrickNegative = true;

      if (isRuined) {
        trashCount += 2.0;
      } else if (isUniversalBadNeg && !isGoodNeg) {
        trashCount += 0.5;
      }
    } else {
      positiveCount++;
      const isMeta = _gBest ? _gBest.some(matchMeta) : (Array.isArray(meta?.pos) && meta.pos.some(matchMeta));
      const isMid = _gMid ? _gMid.some(matchMeta) : (Array.isArray(meta?.midPos) && meta.midPos.some(matchMeta));
      const isExplicitTrash = (Array.isArray(meta?.neg) && meta.neg.some(matchMeta)) ||
        ["zoom", "recoil"].some(t => normLower.includes(t));
      const isUniGod = universalGodPos.includes(normalized);
      const isUniMid = universalMidPos.includes(normalized);

      if (isMeta) {
        metaMatches++;
      } else if (isMid) {
        metaMatches += 0.8;
      } else if (isUniGod) {
        metaMatches += 0.9;
      } else if (isUniMid) {
        metaMatches += 0.65;
      } else if (isExplicitTrash) {
        trashCount += 1.0;
      } else {
        trashCount += 0.35;
      }
    }
  });

  let desirabilityMultiplier = 1.0;
  if (positiveCount > 0) {
    const metaRatio = Math.min(1.0, Math.max(metaMatches / 2, metaMatches / positiveCount));
    const trashPenalty = trashCount * 0.15;
    desirabilityMultiplier = 0.5 + (0.5 * metaRatio) - trashPenalty;
  }

  if (!hasNegative) {
    if (positiveCount === 1) desirabilityMultiplier -= 0.40;
    else if (positiveCount === 2) desirabilityMultiplier -= 0.50;
    else if (positiveCount >= 3) desirabilityMultiplier -= 0.35;
  }

  if (hasBrickNegative) desirabilityMultiplier = 0.05;

  return Math.max(0.1, Math.min(1.0, desirabilityMultiplier));
}

/**
 * Unified riven appraisal: the same tiers and price for the riven tab, the scanner HUD and
 * the two-card comparison. stats: {name, value, isPositive}.
 * @returns {{meta:Object, tiers:Object, prediction:Object}|null}
 */
export function appraiseParsedRiven(weaponName, stats, meta = null) {
  const m = meta || getMetaStats(weaponName, state.weaponMap?.[weaponName]?.t);
  if (!m) return null;

  const weaponData = { ...(state.weaponMap?.[weaponName] || {}), name: weaponName };
  const buffCount = stats.filter(s => s.isPositive).length;
  const hasNeg = stats.some(s => !s.isPositive);

  const desirabilityMultiplier = computeDesirabilityMultiplier(
    stats.map(s => ({ name: s.name, value: s.isPositive ? s.value : -s.value })),
    m, weaponData
  );
  const tiers = calculateHybridTiers(m, state.currentWeaponHistory ?? null);
  const itemAttributes = stats.map(s => {
    const internalName = normalizeStatName(s.name, weaponData.t);
    const rangeInfo = getRivenStatRange(weaponData, internalName, !s.isPositive, buffCount, hasNeg) || { min: 0, max: 0 };
    return { isPositive: s.isPositive, name: internalName, value: Math.abs(s.value), minIdeal: Math.abs(rangeInfo.min), maxIdeal: Math.abs(rangeInfo.max) };
  });
  const prediction = calculateAdvancedPredictivePrice(m, itemAttributes, tiers, desirabilityMultiplier, weaponData, state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);

  // the model appraisal runs in each visible view, not here, to avoid duplicate predictions
  return { meta: m, tiers, prediction, itemAttributes };
}
