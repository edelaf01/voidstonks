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

// Tasar un roll: cuánto vale y contra qué se compara. Devuelve datos, nunca HTML.
//
// Vivía en ui_rivens.js y el escáner de rivens lo alcanzaba con un import() dinámico desde
// services/ — un salto de capa que además era frágil: al partir ui_rivens.js el nombre dejó de
// estar entre sus exports y la llamada se habría quedado en `undefined` sin que nada avisara.

export function computeDesirabilityMultiplier(stats, meta, weaponData) {
  const wType = (weaponData?.t || "").toLowerCase();
  const isMelee = wType === "melee" || wType === "zaw" || wType === "glaive";

  // PRIMERO los pesos del ML de este arma, con el prior global interpolado por liquidez para los
  // stats que el arma no tiene medidos. Antes esta función solo miraba `meta.pos`/`meta.midPos`, que
  // dependía de que el panel los hubiese rellenado antes (acoplamiento por orden de render), y si no
  // caía en las listas universales de abajo.
  const _grado = gradeWeaponStats(metaConPesosDeFamilia(meta || {}, meta?.name || weaponData?.name),
    state.rivenStatBaseline?.stat_weights ?? state.rivenStatPrior ?? null);
  const _gBest = _grado && _grado.best.length ? _grado.best : null;
  const _gMid = _grado && _grado.best.length ? _grado.mid : null;

  // Universal fallbacks: solo se usan si no hay NI pesos del arma NI prior (bundle de ML sin cargar).
  // Ojo con "Damage" a secas: por el matching tolerante empareja con 13 stats distintos y `find`
  // devolvería Critical Damage. `matchMeta` lo trata como caso especial más abajo; no lo copies a una
  // lista nueva sin ese cuidado.
  const universalGodPos = isMelee
    ? ["Melee Damage", "Critical Chance", "Critical Damage", "Damage", "Range", "Attack Speed"]
    : ["Multishot", "Critical Chance", "Critical Damage", "Damage"];
  // Heat/Cold/Toxin NO son "mid" medidos: en melee dan 0.67×/0.83× y en fuego Heat 0.83× y Cold
  // 0.80× (por debajo de 1 = restan). Solo Toxin en fuego llega a 1.15×. Se dejan porque este camino
  // es el último recurso y prefiere no marcar basura un elemento, pero el dato manda cuando existe.
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

      // Una negativa arruina el riven en la medida en que el ARMA quiere ese stat como positivo: es
      // la misma idea que usa la tasación (NEG_KILLER) y evita las listas fijas, que fallaban en los
      // dos sentidos — `brickNegs` marcaba Status Chance como ruina cuando mide 0.95× (neutro), y
      // `universalCriticalNegs` incluía Status Duration (0.97×, neutro) mientras dejaba fuera -Range
      // en melee, que sí es de las peores (el arma lo valora 1.00 y -Range mide 0.78×).
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
      // Negativas inofensivas (Finisher Damage, recoil, daño por facción, etc.) no penalizan
    } else {
      positiveCount++;
      // El grado del ML manda; `meta.pos` queda como respaldo.
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
 * Unified riven appraisal. Given a parsed riven (weaponName + stats as {name, value, isPositive}),
 * returns the SAME tiers + predictive price the riven tab shows. Single source of truth so the
 * riven tab, the scanner HUD and the two-card comparison all value a riven identically.
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

  // Nota: la tasación del MODELO (XGBoost slim, anclada a banda robusta) se calcula en cada vista
  // visible (HUD del escáner y tarjetas del estimador), no aquí, para no duplicar predicciones.
  return { meta: m, tiers, prediction, itemAttributes };
}
