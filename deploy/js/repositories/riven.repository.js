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
