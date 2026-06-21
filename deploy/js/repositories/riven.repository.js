import { getRivenSlug } from "../utils/slugs.utils.js";

export const RIVEN_API_BASE = "https://soft-mountain-28fe.edelamf0.workers.dev/api";

/**
 * Fetches global Riven market data from the worker API.
 * @returns {Promise<Object>}
 */
export async function fetchCurrentRivens() {
  const response = await fetch(`${RIVEN_API_BASE}/rivens`);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  return await response.json();
}

/**
 * Fetches historical price logs for a specific weapon.
 * @param {string} weaponName
 * @returns {Promise<Array>}
 */
export async function fetchWeaponHistory(weaponName) {
  const slug = getRivenSlug(weaponName);
  const response = await fetch(`${RIVEN_API_BASE}/history?weapon=${slug}`);
  if (!response.ok) {
    throw new Error(`HTTP Error for historical logs of ${weaponName}`);
  }
  const result = await response.json();
  // Worker may return { data: [...], pos, neg } — extract just the price array
  return Array.isArray(result) ? result : (result.data || []);
}

/**
 * Extracts base family name from a weapon.
 * E.g., "Soma Prime" -> "Soma", "Kuva Bramma" -> "Bramma"
 */
export function extractFamilyName(weaponName) {
  const overrides = {
    "prisma dual decurions": "Dual Decurion",
    "dual decurions": "Dual Decurion",
    "prisma dual decurion": "Dual Decurion",
    "dex furis": "Afuris",
    "dex afuris": "Afuris",
    "pangolin prime": "Pangolin Sword",
    "prime laser rifle": "Laser Rifle",
    "prime burst laser": "Burst Laser",
    "prime robo-deth": "Robo-Deth",
    "prime deth machine rifle": "Deth Machine Rifle",
    "vaykor marelok": "Marelok",
    "vaykor hek": "Hek"
  };

  const lowerName = weaponName.trim().toLowerCase();
  if (overrides[lowerName]) {
    return overrides[lowerName];
  }

  const prefixes = [
    'Kuva ', 'Tenet ', 'Prisma ', 'Dex ', 'Mara ', 'Mk1-',
    'Mutalist ', 'Sancti ', 'Secura ', 'Rakta ', 'Telos ',
    'Synoid ', 'Vaykor ', 'Coda ', 'Carmine ', 'Shadow ',
  ];

  const suffixes = [
    ' Prime', ' Wraith', ' Vandal', ' Prisma', ' Dex',
    ' Blueprint', ' Umbra',
  ];

  let name = weaponName.trim();

  for (const prefix of prefixes) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      name = name.substring(prefix.length).trim();
      break;
    }
  }

  for (const suffix of suffixes) {
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      name = name.substring(0, name.length - suffix.length).trim();
      break;
    }
  }

  return name;
}
