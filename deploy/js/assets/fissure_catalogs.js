/**
 * Catálogos de la pestaña de fisuras: tipos de misión, planetas y eras.
 *
 */

export const AVAILABLE_MISSION_TYPES = [
  // single objective
  "Capture",
  "Extermination",
  "Rescue",
  "Sabotage",
  "Spy",
  "Mobile Defense",
  "Assault", // Kuva Fortress only
  // endless
  "Survival",
  "Defense",
  "Interception",
  "Excavation",
  "Disruption",
  // Omnia 
  "Void Cascade",
  "Void Flood",
  "Alchemy",
  "Conjunction Survival",
];

// mission types that rotate in Arbitrations
export const ARBY_MISSION_TYPES = [
  "Defense",
  "Survival",
  "Interception",
  "Excavation",
  "Disruption",
  "Defection",
  "Infested Salvage",
  "Alchemy",
];

// Localizaciones donde pueden aparecer fisuras
export const FISSURE_PLANETS = [
  "Earth", "Venus", "Mercury", "Mars", "Phobos", "Deimos", "Ceres", "Jupiter",
  "Europa", "Saturn", "Uranus", "Neptune", "Pluto", "Sedna", "Eris",
  "Void", "Lua", "Kuva Fortress", "Zariman", "Veil",
];

export const FISSURE_TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
