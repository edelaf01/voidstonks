import { getRivenSlug } from "../utils/slugs.utils.js";

export const RIVEN_API_BASE = "https://rivens.voidstonks.com/api";

export const ARB_API_BASE = "https://arb.voidstonks.com/api";

export async function fetchCurrentRivens() {
  const response = await fetch(`${RIVEN_API_BASE}/rivens`);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  return await response.json();
}

export async function fetchArbitrage() {
  const response = await fetch(`${ARB_API_BASE}/arbitrage`);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  return await response.json();
}

export async function fetchLiveOrders(slug) {
  const response = await fetch(`${ARB_API_BASE}/orders?slug=${encodeURIComponent(slug)}`);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  return await response.json();
}

export async function fetchWeaponHistory(weaponName) {
  const slug = getRivenSlug(weaponName);
  const response = await fetch(`${RIVEN_API_BASE}/history?weapon=${slug}`);
  if (!response.ok) {
    throw new Error(`HTTP Error for historical logs of ${weaponName}`);
  }
  const result = await response.json();
  return Array.isArray(result) ? result : (result.data || []);
}
