import { DROP_RATES_BY_RARITY, rarityFromChance, normalizeRarity } from "./relic_drop_odds.utils.js";
import { rewardValue } from "./reward_value.js";
import { setHelpOf } from "./reward_set_pick.js";

const DEFAULT_REFINEMENT = "intact";

function dropProbability(drop, refinement) {
  const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
  return (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0;
}

function valueDistribution(drops, refinement, valueOf) {
  const entries = drops
    .map((d) => ({ value: Math.max(0, valueOf(d) || 0), p: dropProbability(d, refinement) }))
    .sort((a, b) => a.value - b.value);
  const listed = entries.reduce((s, e) => s + e.p, 0);
  if (listed < 1) entries.unshift({ value: 0, p: 1 - listed });
  return entries;
}

function cdfAt(entries, v) {
  let acc = 0;
  for (const e of entries) {
    if (e.value > v) break;
    acc += e.p;
  }
  return acc;
}

export function squadRunOutlook(relics, deps = {}) {
  const { relicsDatabase = {}, getPrice = () => 0 } = deps;

  const valued = new Map();
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
      // kept as complement so a part in two squad relics is not counted twice
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
