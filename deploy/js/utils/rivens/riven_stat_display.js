import { state } from "../../state.js";
import { canBeNegative } from "../../config.js";

// Los dos adaptadores que comparten el tasador, el índice y la ficha de meta-stats para
// enseñar y filtrar stats. El conocimiento de fondo vive en config.js; aquí solo se traduce a
// lo que la interfaz necesita.

const LOCALIZED_STAT_NAMES_MAP = {
  "Critical Damage": "Daño Crítico",
  "Critical Chance": "Prob. Crítica",
  "Multishot": "Multidisparo",
  "Damage": "Daño",
  "Base Damage / Melee Damage": "Daño Base",
  "Zoom": "Zoom",
  "Impact Damage": "Daño de Impacto",
  "Puncture Damage": "Daño de Perforación",
  "Slash Damage": "Daño de Cortante",
  "Fire Rate / Attack Speed": "Cadencia / Vel. Ataque",
  "Reload Speed": "Vel. Recarga",
  "Ammo Maximum": "Munición Máxima",
  "Status Duration": "Duración de Estado",
  "Status Chance": "Prob. Estado",
  "Punch Through": "Atravesar",
  "Range": "Alcance",
  "Recoil": "Retroceso",
  "Weapon Recoil": "Retroceso",
  "Magazine Capacity": "Capacidad de Cargador",
  "Toxin Damage": "Daño de Toxina",
  "Heat Damage": "Daño de Calor",
  "Electric Damage": "Daño de Electricidad",
  "Cold Damage": "Daño de Frío",
  "Damage Vs Corpus": "Daño vs Corpus",
  "Damage Vs Grineer": "Daño vs Grineer",
  "Damage Vs Infested": "Daño vs Infestados",
  "Critical Chance On Slide Attack": "CC en Deslizamiento",
  "Finisher Damage": "Daño de Remate",
  "Combo Duration": "Duración de Combo",
  "Initial Combo": "Combo Inicial",
  "Heavy Attack Efficiency": "Eficiencia de Ataque Pesado",
  "Heavy Attack Damage": "Daño de Ataque Pesado",
  "Channeling Damage": "Combo Inicial",
  "Channeling Efficiency": "Eficiencia de Ataque Pesado"
};

export function getLocalizedStatName(nameEn) {
  if (!nameEn) return "";
  let normName = nameEn;
  if (normName === "Channeling Damage") {
    normName = "Initial Combo";
  } else if (normName === "Channeling Efficiency") {
    normName = "Heavy Attack Efficiency";
  } else if (normName === "Charge Damage") {
    normName = "Heavy Attack Damage";
  }
  if (state.currentLang !== "es") return normName;
  return LOCALIZED_STAT_NAMES_MAP[normName] || normName;
}

// Stats that can only roll POSITIVE on a riven — never as a negative/curse — so they must
// never appear in any negatives list: elemental damage (Heat/Cold/Electric/Toxin) and
// Punch Through. ("punch" no matchea "Puncture Damage", que sí puede ser negativa.)
// La regla vive en config.js (canBeNegative), junto al resto del conocimiento de stats; aquí
// solo se adapta a la interfaz `.test(nombre)` que ya usan las listas de recomendaciones.
export const CANT_BE_NEGATIVE = { test: (s) => !canBeNegative(s) };
