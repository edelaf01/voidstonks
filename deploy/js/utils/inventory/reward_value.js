import { closenessWeight } from "./relic_picks.js";
import { setHelpOf } from "./reward_set_pick.js";

/**
 * Platinum you really take home from each reward on the screen. EVERYTHING goes to one unit (platinum
 * you end up with): a set is only worth it if the whole set is worth MORE than its parts, and that
 * premium is all closing it adds.
 *
 * Pure: everything comes in through `deps`.
 */

/**
 * Ducats per platinum, named so it changes in one place.
 */
export const DUCATS_PER_PLAT = 10;

/**
 * A 2p part does not sell: below FLOOR it is worth 0 as a loose sale, above FULL what it lists for, and
 * interpolated in between so two similar prices do not sort backwards around a threshold.
 */
export const SALE_FLOOR_PLAT = 2;
export const SALE_FULL_PLAT = 8;

export function saleValue(price) {
  const p = Number(price) || 0;
  if (p <= SALE_FLOOR_PLAT) return 0;
  if (p >= SALE_FULL_PLAT) return p;
  return p * ((p - SALE_FLOOR_PLAT) / (SALE_FULL_PLAT - SALE_FLOOR_PLAT));
}

/**
 * Melting into ducats beats selling loose. Same comparison as rewardValue without the set premium; the
 * Ducanator uses it too.
 */
export function ducatsBeatSale(ducats, price) {
  return (Number(ducats) || 0) / DUCATS_PER_PLAT > saleValue(price);
}

/**
 * Platinum value of ONE reward, with the breakdown.
 *
 * @param item  { name, price, ducats, qty }
 * @param deps.getPrice  (name) => resolved platinum (sync). Unknown is 0 and that route adds nothing.
 * @param deps.setsDatabase / primeInventory / getSetName / getRequiredCount  what setHelpOf needs.
 * @returns {{plat:number, route:"set"|"sell"|"ducats"|"none", sale:number, ducatPlat:number,
 *           setGain:number, premium:number, set:string|null, left:number|null}}
 */
export function rewardValue(item, deps = {}) {
  const { getPrice = () => 0, getRequiredCount = () => 1, setsDatabase = {} } = deps;
  const qty = Math.max(1, Number(item?.qty) || 1);
  const price = Number(item?.price) || 0;
  const ducats = Number(item?.ducats) || 0;

  const sale = saleValue(price) * qty;
  const ducatPlat = (ducats / DUCATS_PER_PLAT) * qty;

  const help = setHelpOf(item?.name, deps);
  const parts = help ? (setsDatabase[help.set] || []) : [];
  const known = parts.map((p) => Number(getPrice(p)) || 0).filter((n) => n > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;

  let premium = 0;
  let setGain = 0;
  if (help && known.length > 0) {
    const partsApart = parts.reduce(
      (s, p) => s + saleValue(Number(getPrice(p)) || avg) * (getRequiredCount(help.set, p) || 1), 0);
    // the premium is never negative: you can always sell the parts apart
    premium = Math.max(0, saleValue(getPrice(`${help.set} Set`)) - partsApart);
    // `left` counts what is missing AFTER taking it, closenessWeight what is missing BEFORE: hence the +1
    setGain = premium * closenessWeight(help.left + 1);
  }

  // two routes and the part takes one: keep it (sell or set) or melt it. Sum within a route, max between
  // them
  const keep = sale + setGain;
  const plat = Math.max(keep, ducatPlat);

  let route = "none";
  if (plat > 0) route = ducatPlat > keep ? "ducats" : (setGain > sale ? "set" : "sell");

  return {
    plat, route, sale, ducatPlat, setGain, premium,
    set: help?.set || null,
    left: help ? help.left : null,
  };
}

/**
 * Minimum margin to say a reward WINS instead of "about the same": warframe.market prices are not that
 * precise.
 */
export const CLEAR_WIN_RATIO = 1.15;
export const CLEAR_WIN_PLAT = 1;

export function rankRewards(items, deps) {
  return (items || [])
    .map((item) => ({ ...item, value: rewardValue(item, deps) }))
    .sort((a, b) => b.value.plat - a.value.plat);
}

/**
 * The reward to mark, or null when none is worth anything. `clear` tells "this wins" from "wins by a
 * hair".
 */
export function pickBestReward(items, deps) {
  const ranked = rankRewards(items, deps);
  const best = ranked[0];
  if (!best || best.value.plat <= 0) return null;
  const second = ranked[1]?.value.plat || 0;
  return {
    name: best.name,
    value: best.value,
    clear: best.value.plat >= second * CLEAR_WIN_RATIO
      && best.value.plat - second >= CLEAR_WIN_PLAT,
  };
}
