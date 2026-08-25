import { DROP_RATES_BY_RARITY, rarityFromChance, normalizeRarity } from "./relic_drop_odds.utils.js";
import { rewardValue } from "./reward_value.js";
import { setHelpOf } from "./reward_set_pick.js";

/**
 * What the relics the SQUAD carries this run can give. Not `relicOpenEV`, which models N copies of the
 * SAME relic and refinement: each player brings their own. The run is worth the expected MAX of N
 * independent different rolls; with identical relics it equals relicOpenEV (tested).
 *
 * Pure: everything comes in through `deps`.
 */

// no parenthesis read: assume intact
const DEFAULT_REFINEMENT = "intact";

function dropProbability(drop, refinement) {
  const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
  return (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0;
}

/**
 * Value distribution of ONE relic: { value, p } pairs, low to high, total mass 1. What the table does
 * not cover enters as a 0 value reward.
 */
function valueDistribution(drops, refinement, valueOf) {
  const entries = drops
    .map((d) => ({ value: Math.max(0, valueOf(d) || 0), p: dropProbability(d, refinement) }))
    .sort((a, b) => a.value - b.value);
  const listed = entries.reduce((s, e) => s + e.p, 0);
  if (listed < 1) entries.unshift({ value: 0, p: 1 - listed });
  return entries;
}

/** F(v) of a sorted distribution: chance of getting at most `v`. */
function cdfAt(entries, v) {
  let acc = 0;
  for (const e of entries) {
    if (e.value > v) break;
    acc += e.p;
  }
  return acc;
}

/**
 * @param relics  [{ name, refinement }] as read from the squad panel.
 * @param deps.relicsDatabase  relic name -> [{ name, chance, rarity, ducats }]
 * @param deps.getPrice        (part) => platinum, already resolved (sync); unknown is 0.
 * @param deps                 also what rewardValue/setHelpOf need:
 *                             setsDatabase, primeInventory, getSetName, getRequiredCount.
 * @returns {{ relics: Array, drops: Array, runEV: number }}
 *          `drops` is the UNION of the tables, with `chance` = chance of that part showing on any
 *          card of the run.
 */
export function squadRunOutlook(relics, deps = {}) {
  const { relicsDatabase = {}, getPrice = () => 0 } = deps;

  const valued = new Map(); // part -> { plat, value, help }
  const valueOfDrop = (drop) => {
    const name = drop?.name;
    if (!name) return 0;
    if (!valued.has(name)) {
      const value = rewardValue({ name, price: getPrice(name), ducats: drop.ducats, qty: 1 }, deps);
      valued.set(name, { plat: value.plat, value, help: setHelpOf(name, deps) });
    }
    return valued.get(name).plat;
  };

  const carried = (relics || [])
    .map((r) => {
      const drops = relicsDatabase[r?.name] || [];
      const refinement = r?.refinement || DEFAULT_REFINEMENT;
      return { name: r?.name, refinement, assumedRefinement: !r?.refinement, drops };
    })
    .filter((r) => r.drops.length > 0);

  if (!carried.length) return { relics: [], drops: [], runEV: 0 };

  const dists = carried.map((r) => valueDistribution(r.drops, r.refinement, valueOfDrop));

  // solo EV of each relic: what "who brought the good one" compares
  const relicsOut = carried.map((r, i) => ({
    name: r.name,
    refinement: r.refinement,
    assumedRefinement: r.assumedRefinement,
    ev: dists[i].reduce((s, e) => s + e.value * e.p, 0),
  }));

  const dropsOut = new Map();
  carried.forEach((r) => {
    r.drops.forEach((d) => {
      if (!d?.name) return;
      const p = dropProbability(d, r.refinement);
      const prev = dropsOut.get(d.name);
      // P(on any card) = 1 - Π(1 - p_i), kept as the complement so a part in two squad relics is not counted
      // twice
      if (prev) prev.miss *= (1 - p);
      else dropsOut.set(d.name, { name: d.name, ducats: d.ducats || 0, miss: 1 - p });
    });
  });

  const drops = [...dropsOut.values()].map((d) => {
    const v = valued.get(d.name) || { plat: 0, value: null, help: null };
    return {
      name: d.name,
      ducats: d.ducats,
      chance: 1 - d.miss,
      plat: v.plat,
      route: v.value?.route || "none",
      help: v.help,
    };
  }).sort((a, b) => b.plat - a.plat || b.chance - a.chance);

  // E[max]: each value, low to high, weighted by the chance that ALL cards stay at or below it minus the
  // chance they stay at or below the previous one
  const levels = [...new Set(dists.flat().map((e) => e.value))].sort((a, b) => a - b);
  let runEV = 0;
  let prevProduct = 0;
  for (const v of levels) {
    const product = dists.reduce((acc, d) => acc * cdfAt(d, v), 1);
    runEV += v * (product - prevProduct);
    prevProduct = product;
  }

  return { relics: relicsOut, drops, runEV };
}
