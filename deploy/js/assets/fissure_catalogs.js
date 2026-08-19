/**
 * Catálogos de la pestaña de fisuras: tipos de misión, planetas y eras.
 *
 * Son datos, no render, y por eso salen de ui_fissures.js. Ojo con lo que dice el comentario de
 * abajo: **no son la fuente de verdad**. El panel los fusiona con los tipos que traen los datos
 * reales, así que un tipo nuevo de DE sigue siendo filtrable sin tocar esta lista — lo que hay
 * aquí es el orden y la agrupación con que se enseñan.
 */

// Tipos de misión que el usuario puede activar/desactivar, agrupados como los agrupa el juego:
// velocidad (objetivo único), continuas (una reliquia por rotación) y Omnia (Lua/Zariman/Deimos,
// admiten cualquier reliquia clásica). Excluidos a propósito porque DE nunca los rota como
// fisura: Asesinato, Deserción, Salvamento Infestado, Índice y Arena.
// La lista NO es la fuente de verdad: renderFissureFiltersPanel la fusiona con los tipos
// realmente presentes en los datos, así un tipo nuevo sigue siendo filtrable sin tocar código.
export const AVAILABLE_MISSION_TYPES = [
  // Velocidad (objetivo único)
  "Capture",
  "Extermination",
  "Rescue",
  "Sabotage",
  "Spy",
  "Mobile Defense",
  "Assault", // solo Fortaleza Kuva
  // Continuas (consumen reliquia por rotación)
  "Survival",
  "Defense",
  "Interception",
  "Excavation",
  "Disruption",
  // Omnia (admiten cualquier reliquia clásica)
  "Void Cascade",
  "Void Flood",
  "Alchemy",
  "Conjunction Survival",
];

// Tipos de misión que rotan en Arbitración (endless). "Dark Sector X" cuenta como X
// en el matcher, así que no hace falta listarlos.
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

// Localizaciones donde pueden aparecer fisuras (el planeta se extrae del nodo, p.ej.
// "Kiliken (Venus)"). "Veil" es la Proxima del Velo, exclusiva de Railjack.
export const FISSURE_PLANETS = [
  "Earth", "Venus", "Mercury", "Mars", "Phobos", "Deimos", "Ceres", "Jupiter",
  "Europa", "Saturn", "Uranus", "Neptune", "Pluto", "Sedna", "Eris",
  "Void", "Lua", "Kuva Fortress", "Zariman", "Veil",
];

export const FISSURE_TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"];
