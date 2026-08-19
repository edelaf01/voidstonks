const PROD_WORKER_URL = "https://api.voidstonks.com/";

/**
 * URL del worker, con desvío opcional a un `wrangler dev` local.
 *
 * El worker se despliega aparte del sitio, así que un endpoint recién escrito todavía no
 * existe en api.voidstonks.com: la pestaña que lo consume sale vacía y no hay forma de
 * probarla desde el navegador. Con esto:
 *
 *     localStorage.setItem("vs_worker_url", "http://127.0.0.1:8787/")   // y recarga
 *
 * SOLO desde localhost a propósito. En producción, cualquiera capaz de escribir en el
 * localStorage del usuario redirigiría todas las peticiones —incluidas las que llevan el
 * JWT de warframe.market— a un servidor ajeno.
 */
function resolveWorkerUrl() {
  const loc = globalThis.location;
  if (!loc || typeof globalThis.localStorage === "undefined") return PROD_WORKER_URL;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(loc.hostname)) return PROD_WORKER_URL;
  try {
    const raw = globalThis.localStorage.getItem("vs_worker_url");
    // http(s) explícito: el valor acaba en fetch() y una URL de otro esquema no es un worker.
    if (!raw || !/^https?:\/\//.test(raw)) return PROD_WORKER_URL;
    const url = raw.endsWith("/") ? raw : `${raw}/`;
    // Aviso ruidoso a propósito. Un desvío olvidado apuntando a un `wrangler dev` que ya
    // no está levantado hace que TODA la app se quede sin datos, y el síntoma (pestañas
    // vacías, "no se pudo cargar") no apunta hacia aquí por ningún lado.
    console.warn(
      `[CONFIG] Worker desviado a ${url} (vs_worker_url). Si la app no carga datos, ` +
      "el worker local no está levantado: localStorage.removeItem(\"vs_worker_url\") y recarga.",
    );
    return url;
  } catch {
    return PROD_WORKER_URL;
  }
}

export const WORKER_URL = resolveWorkerUrl();
export const APP_VERSION = "2.8";
// TEXTS y UPDATE_HISTORY_DATA son tablas de datos, no configuración: viven en assets/ y se
// reexportan aquí porque medio repo las importa de config.js.
export { TEXTS } from "./assets/texts.js";
export { UPDATE_HISTORY_DATA } from "./assets/update_history.js";
export const TIER_URLS = {
  Lith: "https://wiki.warframe.com/images/LithRelicIntact.png?ee7d7",
  Meso: "https://wiki.warframe.com/images/MesoRelicIntact.png?a9b4a",
  Neo: "https://wiki.warframe.com/images/NeoRelicIntact.png?6dc86",
  Axi: "https://wiki.warframe.com/images/AxiRelicIntact.png?6cadf",
  Requiem: "https://wiki.warframe.com/images/RequiemRelicIntact.png?03821",
};

export const DROP_CHANCES = {
  Intact: { rare: 0.02, uncommon: 0.22, common: 0.76 },
  Exceptional: { rare: 0.04, uncommon: 0.26, common: 0.7 },
  Flawless: { rare: 0.06, uncommon: 0.34, common: 0.6 },
  Rad: { rare: 0.1, uncommon: 0.4, common: 0.5 },
};

export const RIVEN_STATS = [
  // --- BÁSICOS ---
  { slug: "critical_chance", name_en: "Crit Chance", name_es: "Prob. Crítica" },
  { slug: "critical_damage", name_en: "Crit Damage", name_es: "Daño Crítico" },
  { slug: "multishot", name_en: "Multishot", name_es: "Multidisparo" },
  {
    slug: "base_damage_/_melee_damage",
    name_en: "Damage",
    name_es: "Daño Base",
  },
  {
    slug: "fire_rate_/_attack_speed",
    name_en: "Fire Rate / Attack Speed",
    name_es: "Cadencia / Vel. Ataque",
  },
  { slug: "status_chance", name_en: "Status Chance", name_es: "Prob. Estado" },
  {
    slug: "status_duration",
    name_en: "Status Duration",
    name_es: "Duración de Estado",
  },

  // --- ELEMENTALES ---
  { slug: "toxin_damage", name_en: "Toxin", name_es: "Toxina" },
  { slug: "heat_damage", name_en: "Heat", name_es: "Calor" },
  { slug: "electric_damage", name_en: "Electric", name_es: "Electricidad" },
  { slug: "cold_damage", name_en: "Cold", name_es: "Frío" },

  // --- FÍSICOS ---
  { slug: "impact_damage", name_en: "Impact", name_es: "Impacto" },
  { slug: "puncture_damage", name_en: "Puncture", name_es: "Perforación" },
  { slug: "slash_damage", name_en: "Slash", name_es: "Cortante" },

  // --- UTILIDAD ARMAS DE FUEGO ---
  { slug: "weapon_recoil", name_en: "Recoil", name_es: "Retroceso" },
  {
    slug: "magazine_capacity",
    name_en: "Magazine Capacity",
    name_es: "Capacidad Cargador",
  },
  { slug: "ammo_maximum", name_en: "Ammo Maximum", name_es: "Munición Máxima" },
  { slug: "reload_speed", name_en: "Reload Speed", name_es: "Vel. Recarga" },
  {
    slug: "projectile_flight_speed",
    name_en: "Projectile Speed",
    name_es: "Vel. Proyectil",
  },
  { slug: "punch_through", name_en: "Punch Through", name_es: "Atravesar" },
  { slug: "zoom", name_en: "Zoom", name_es: "Zoom" },

  // --- MELEE ESPECÍFICOS  ---
  { slug: "range", name_en: "Range", name_es: "Alcance (Rango)" },
  { slug: "initial_combo", name_en: "Initial Combo", name_es: "Combo Inicial" },
  {
    slug: "combo_duration",
    name_en: "Combo Duration",
    name_es: "Duración de Combo",
  },
  {
    slug: "chance_to_gain_extra_combo_count",
    name_en: "Chance not to gain Combo",
    name_es: "Prob. Combo Extra",
  },
  {
    slug: "critical_chance_on_slide_attack",
    name_en: "Slide Attack Critical Chance",
    name_es: "Crit en Deslizamiento",
  },
  {
    slug: "heavy_attack_efficiency",
    name_en: "Heavy Attack Efficiency",
    name_es: "Eficiencia Ataque Pesado",
  },
  {
    slug: "finisher_damage",
    name_en: "Finisher Damage",
    name_es: "Daño de Remate",
  },

  // --- FACCIONES ---
  {
    slug: "damage_vs_grineer",
    name_en: "Damage to Grineer",
    name_es: "Daño a Grineer",
  },
  {
    slug: "damage_vs_corpus",
    name_en: "Damage to Corpus",
    name_es: "Daño a Corpus",
  },
  {
    slug: "damage_vs_infested",
    name_en: "Damage to Infested",
    name_es: "Daño a Infestados",
  },
];
export const WEAPON_TYPE_IDX = {
  Rifle: 0,
  Sniper: 0,
  Bow: 0,
  Launcher: 0,
  Sentinel: 0,
  Shotgun: 1,
  Pistol: 2,
  "Dual Pistols": 2,
  Thrown: 2,
  Throwing: 2,
  Kitgun: 2,
  Melee: 3,
  Zaw: 3,
  "Zaw Component": 3,
  Glaive: 3,
  Archgun: 4,
  "Arch-Gun": 4,
};

export const RIVEN_BASE_STATS = {
  // DMG
  "Critical Chance": [16.7, 10, 16.7, 20, 11.1],
  "Critical Damage": [13.3, 10, 10, 10, 8.9],
  "Status Chance": [10, 10, 10, 10, 6.7],
  "Status Duration": [11.1, 11.1, 11.1, 11.1, 11.1],
  Damage: [18.3, 18.3, 24.4, 18.3, 11.1],
  Multishot: [10, 13.3, 13.3, 0, 6.7],
  "Fire Rate": [6.7, 10, 8.3, 0, 6.7],
  "Attack Speed": [0, 0, 0, 6.1, 0],

  // ELEMENTALS
  Electric: [10, 10, 10, 10, 13.3],
  Toxin: [10, 10, 10, 10, 13.3],
  Heat: [10, 10, 10, 10, 13.3],
  Cold: [10, 10, 10, 10, 13.3],
  Impact: [13.3, 13.3, 13.3, 13.3, 10],
  Puncture: [13.3, 13.3, 13.3, 13.3, 10],
  Slash: [13.3, 13.3, 13.3, 13.3, 10],

  //UTILITY
  "Ammo Maximum": [5.5, 10, 10, 0, 11.1],
  "Magazine Capacity": [5.5, 5.5, 5.5, 0, 6.7],
  "Reload Speed": [5.5, 5.5, 5.5, 0, 11.1],
  "Projectile Speed": [10, 10, 10, 0, 11.1],
  Zoom: [6.7, 0, 8.9, 0, 6.7],
  "Punch Through": [0.3, 0.3, 0.3, 0, 0.3],
  Recoil: [-10, -10, -10, 0, -10],

  // MELEE ONLY
  Range: [0, 0, 0, 0.21, 0],
  "Combo Duration": [0, 0, 0, 0.9, 0],
  "Initial Combo": [0, 0, 0, 2.7, 0],
  "Chance not to gain Combo": [0, 0, 0, 6.5, 0],
  "Slide Attack Critical Chance": [0, 0, 0, 13.3, 0],
  "Finisher Damage": [0, 0, 0, 13.3, 0],
  "Heavy Attack Efficiency": [0, 0, 0, 8.2, 0],

  "Damage to Grineer": [5, 5, 5, 5, 5],
  "Damage to Corpus": [5, 5, 5, 5, 5],
  "Damage to Infested": [5, 5, 5, 5, 5],
};

// Bridges RIVEN_STATS.name_en → RIVEN_BASE_STATS keys where they differ.
// The scanner labels stats with name_en ("Crit Chance"), but the base-stat table is keyed by the
// long form ("Critical Chance"); without this bridge those stats grade as "?".
export const BASE_STAT_ALIAS = {
  "Crit Chance": "Critical Chance",
  "Crit Damage": "Critical Damage",
};

// Resolves the RIVEN_BASE_STATS key for a parsed stat name, given the weapon type index.
// "Fire Rate / Attack Speed" resolves per weapon type (melee idx 3 → Attack Speed, else Fire Rate).
export function resolveBaseStatKey(nameEn, typeIdx) {
  if (nameEn === "Fire Rate / Attack Speed") {
    return typeIdx === 3 ? "Attack Speed" : "Fire Rate";
  }
  return BASE_STAT_ALIAS[nameEn] || nameEn;
}

// Stats que el juego NUNCA genera como MALDICIÓN (negativa), aunque sí existan como positivo:
// los cuatro elementales y Punch Through. Un riven con "-Heat" o "-Punch Through" es imposible,
// así que si aparece uno es un error de OCR (signo mal leído) y no un roll a tasar.
// El entrenamiento ya lo filtra (IMPOSSIBLE_NEGATIVES en ML_local.py); esto pone la misma regla
// al alcance del front, que no la tenía y por tanto tasaba negativas inexistentes.
export const IMPOSSIBLE_NEGATIVE_STATS = [
  "Heat", "Cold", "Toxin", "Electric",
  "Heat Damage", "Cold Damage", "Toxin Damage", "Electric Damage",
  "Punch Through",
];

// ¿Puede este stat rolar como negativa? Tolera las variantes de nombre del OCR y del modelo
// ("Heat" vs "Heat Damage") resolviendo primero la clave canónica de RIVEN_BASE_STATS.
export function canBeNegative(nameEn, typeIdx = null) {
  const key = resolveBaseStatKey(String(nameEn || "").trim(), typeIdx);
  const nl = key.toLowerCase();
  return !IMPOSSIBLE_NEGATIVE_STATS.some(s => s.toLowerCase() === nl);
}

// (Buffs vs Curses)
export const RIVEN_WEIGHTS = {
  "2-0": { buff: 0.99, curse: 0 },
  "2-1": { buff: 1.2375, curse: 0.495 },
  "3-0": { buff: 0.75, curse: 0 },
  "3-1": { buff: 0.9375, curse: 0.75 },
};
export const AYA_STRATEGY_CONFIG = {
  minLevel: 40,
  maxLevel: 60,
  excludeSP: true,
  requiredReward: "Aya",
  priorities: [
    {
      id: "best",
      keywords: ["artifact", "hidden", "artefacto"],
      tagKey: "best",
    },
    {
      id: "fast",
      keywords: ["capture", "assassinate", "captura", "asesinato"],
      tagKey: "fast",
    },
    { id: "runnable", keywords: ["rescue", "rescate"], tagKey: "runnable" },
  ],
};

export const NODE_MAP = {
  SolNode718: "Cambire",
  SolNode719: "Persto",
  SolNode721: "Munio",
  SolNode715: "Effervo",
  SolNode716: "Anatomia",
  SolNode717: "Nex",
  // Zariman
  SolNode230: "Everview Arc",
  SolNode231: "Halako Perimeter",
  SolNode232: "Tuvul Commons",
  SolNode233: "Oro Works",
  SolNode235: "The Greenway",
  // Höllvania (1999)
  SolNode850: "Köbinn West",
  SolNode851: "Mischta Ramparts",
  SolNode852: "Old Konderuk",
  SolNode853: "Mausoleum East",
  SolNode854: "Rhu Manor",
  SolNode855: "Lower Vehrvod",
  SolNode856: "Victory Plaza",
  SolNode857: "Vehrvod District",
  SolNode858: "Solstice Square",
};

export const NODE_TO_TYPE = {
  SolNode230: "Void Flood",
  SolNode231: "Exterminate",
  SolNode232: "Void Cascade",
  SolNode233: "Void Armageddon",
  SolNode235: "Mobile Defense",
  SolNode715: "Assassination",
  SolNode716: "Assassination",
  SolNode717: "Exterminate",
  SolNode718: "Alchemy",
  SolNode719: "Survival",
  SolNode721: "Mirror Defense",
  SolNode850: "Alchemy",
  SolNode851: "Survival",
  SolNode852: "Survival",
  SolNode853: "Exterminate",
  SolNode854: "Exterminate",
  SolNode855: "Assassination",
  SolNode856: "Assassination",
  SolNode857: "Assassination",
  SolNode858: "Defense",
};
export const VANIA_NAMES = {
  Alchemy: "Legacyte Harvest",
  Survival: "Hell-Scrub",
  Exterminate: "Exterminate",
  Assassination: "Assassination",
  Defense: "Stage Defense",
  "Mobile Defense": "Mobile Defense",
};
export const CHALLENGE_MAP = {
  EntratiLabDefeatDoppelgangerChallenge: "Defeat grimoire mini boss",
  ZarimanExterminateNoPowersChallenge: "Cant use abilities",
  ZarimanAssassinateKillAngelsHardChallenge: "Kill 3 Angels",
  ZarimanKillCorpusEasyChallenge: "Kill 100 Corpus",
  EntratiLabKillVialedEnemyChallenge: "Kill enemies doused with vitriol",
  DestroyHazards: "Destroy Hazards",
  HighKill: "High Kill Count",
  SafeCracker: "Safe Cracker",
  VaniaExplodingInfested: "Exploding Infested when killed",
  DestroySpeakers: "Destroy Speakers",
  DestroyBackpacks: "Destroy Backpacks",
  DestroyVehicles: "Destroy Vehicles",
  LichVaniaHighKill: "Lich: High Kill Count",
  VaniaHighKillEasy: "Kill enemies from above (10)",
  VaniaDestroyPropsNormal: "Destroy 30 crates/stationary items",
  DestroyProps: "Destroy Props",
  VaniaInfestedCrossfire: "techrot emerges from below",
  ZarimanMobDefProtectShieldsChallenge:
    "Complete mission with objective not losing shields",
  ZarimanKillAsOperatorEasyChallenge: "Kill as Operator",
  ZarimanKillAsOperatorNormalChallenge: "Kill as Operator",
  ZarimanKillAsOperatorHardChallenge: "Kill as Operator",
  ZarimanKillAsOperatorVeryHardChallenge: "Kill as Operator",
  VaniaDestroyBackpacksVeryHard: "Destroy Backpacks",
  VaniaDestroyBackpacksHard: "Destroy Backpacks",
  ZarimanCorruptionCollectLargeOrbsEasyChallenge: "Collect Orbs",
  ZarimanUseVoidRiftsHardChallenge: "Use Lohk surges",
  ZarimanFloodCompleteWavesHardChallenge: "Complete rounds",
  ZarimanDefeatVoidAngelChallenge: "Defeat Void Angel",
  ZarimanFindMelicaCacheChallenge: "Find Melica's Cache",
  ZarimanFloodCompleteWavesVeryHardChallenge: "Complete rounds",
  VaniaSafeCracker: "Crack Safe",
  VaniaAbilityKillVeryHard: "Kill X enemies with Warframe abilities",
  VaniaAbilityKillHard: "Kill X enemies with Warframe abilities",
  VaniaAbilityKillEasy: "Kill X enemies with Warframe abilities",
  EntratiLabRangedMechWeakpointChallenge: "Mech Weakpoints",
  EntratiLabKillFlyingMurmurChallenge: "Kill Flying Murmur",
  EntratiLabKillMurmurVeryHardChallenge: "Kill Murmur",
  EntratiLabKillVoidRigHardChallenge: "Kill Necramech/S",
  EntratiLabKillVoidRigEasyChallenge: "Kill Necramech/s",
  EntratiLabLootCratesChallenge: "Destroy Crates",
  DestroyDemolystLimbs: "Destroy Demolyst Limbs",
  RangedMechWeakpoint: "Ranged Mech Weakpoint",
  LootCrates: "Loot Crates",
  KillFlyingMurmur: "Kill Flying Murmur",
  ActivateLohkSurge: "Activate Lohk Surge",
  KillMurmur: "Kill Murmur",
  ZarimanKillGrineerEasyChallenge: "Kill Grineer",
  ZarimanCorruptionCollectLargeOrbsHardChallenge: "Collect Orbs",
  ZarimanExterminateFastCompleteChallenge:
    "Finish in < 6 min(fast for exterminate)",
  ZarimanUseVoidRiftsEasyChallenge: "Use Lohk surges",
  ZarimanKillGrineerHardChallenge: "Kill Grineer",
  EntratiLabRangedMechWeakpointEasyChallenge: "Necramech Weakpoints",
  EntratiLabKillMurmurChallenge: "Kill Murmur",
};
export const ALLY_MAP = {
  QuincyAllyAgent: "Quincy",
  AmirAllyAgent: "Amir",
  EleanorAllyAgent: "Eleanor",
  AoiAllyAgent: "Aoi",
  LettieAllyAgent: "Lettie",
  ArthurAllyAgent: "Arthur",
};
export const DUAL_PATH_FACTIONS = new Set([
  "The Holdfasts",
  "Cavia",
  "The Hex",
]);
export const ZARIMAN_DATA = {
  counts: {
    normal: [1, 1, 2, 3, 4, 5],
    sp: [2, 2, 3, 5, 6, 8],
  },
  value: 2500,
};
export const BOUNTY_NAMES = {
  Ostrons: {
    "5-15": "Spy Catcher",
    "10-30": "Search and Rescue",
    "20-40": "Cull the Enemy",
    "30-50": "Capture Leader",
    "40-60": "Sabotage Lines",
    "100-100": "Sabotage Bounty",
    "50-70": "Rise and Fall",
  },
  Entrati: {
    "5-15": "Salvage",
    "15-25": "Core Samples",
    "25-30": "Anomaly Retrieval",
    "30-40": "Cleanse the Land",
    "40-60": "For Science!",
    "100-100": "Brute Force",
  },
  "Solaris United": {
    "5-15": "Scorched Earth",
    "10-30": "Bury Them",
    "20-40": "Seems Legit",
    "30-50": "Hunter-Killer",
    "40-60": "Courier Ambush",
    "100-100": "Software Subterfuge",
    "50-70": "Master's Voice",
  },
};
export const OPTIMAL_FILTERS = [
  {
    factions: ["The Holdfasts"],
    tiers: [4, 5, 6],
    types: ["Exterminate"],
    challenges: [
      "ZarimanDefeatVoidAngelChallenge",
      "ZarimanExterminateFastCompleteChallenge",
    ],
  },
  {
    // Rescate entra con Exterminio y Captura: son las tres de una pasada, que es lo que hace
    // "rápida" a una misión. El panel de fisuras ya las contaba así (DEFAULT_MISSION_TYPES);
    // aquí faltaba Rescue y las bounties de rescate nunca aparecían en "Solo óptimas".
    //
    // No se distingue camino normal de acero a propósito: checkIsOptimal no mira `isSP`, así
    // que una captura es igual de rápida en los dos y sale en ambos.
    types: ["Exterminate", "Capture", "Rescue"],
    factions: ["Ostrons", "Solaris United", "Entrati"],
  },
];
