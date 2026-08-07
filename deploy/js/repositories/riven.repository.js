import { getRivenSlug } from "../utils/slugs.utils.js";

export const RIVEN_API_BASE = "https://soft-mountain-28fe.edelamf0.workers.dev/api";

// Worker SEPARADO para el arbitrage (arbitrage-worker.js).
export const ARB_API_BASE = "https://wf-tool-proxy-worker.edelamf0.workers.dev/api";

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
 * Fetches the global arbitrage (buy/sell flip) snapshot from the worker.
 * @returns {Promise<{generated:number, scanned:number, total:number, opportunities:Array}>}
 */
export async function fetchArbitrage() {
  const response = await fetch(`${ARB_API_BASE}/arbitrage`);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  return await response.json();
}

/**
 * Live-verifies a single item's current best buy/sell via the worker proxy.
 * @param {string} slug warframe.market url_name
 * @returns {Promise<{sell:number, buy:number, spread:number, rank:(number|null)}>}
 */
export async function fetchLiveOrders(slug) {
  const response = await fetch(`${ARB_API_BASE}/orders?slug=${encodeURIComponent(slug)}`);
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
// Prefijos y sufijos que marcan una VARIANTE del mismo arma base. Se exportan porque la misma
// lista hacía falta en dos sitios con propósitos distintos —resolver datos de familia y agrupar el
// buscador— y estaban duplicadas: al añadir 'Ceti' en una, Ceti Lacera seguía saliendo suelta en el
// buscador porque la otra copia no se tocó.
export const VARIANT_PREFIXES = [
  'Kuva ', 'Tenet ', 'Prisma ', 'Dex ', 'Mara ', 'Mk1-', 'Mk1 ', 'Ceti ',
  'Mutalist ', 'Sancti ', 'Secura ', 'Rakta ', 'Telos ',
  'Synoid ', 'Vaykor ', 'Coda ', 'Carmine ', 'Shadow ',
];

export const VARIANT_SUFFIXES = [
  ' Prime', ' Wraith', ' Vandal', ' Prisma', ' Dex',
  ' Blueprint', ' Umbra', ' Coda',
];

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

  const prefixes = VARIANT_PREFIXES;
  const suffixes = VARIANT_SUFFIXES;

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
