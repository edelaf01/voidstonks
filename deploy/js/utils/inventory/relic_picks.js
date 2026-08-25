import { relicSetValue } from "./relic_set_value.js";
import { bestFissure, missionMinutes, tiersOpenedBy } from "./relic_route.js";

/**
 * Which of YOUR relics are worth opening now. The inverse of buildFarmRoutes: that one goes "set ->
 * which relic closes it", this one "relic -> what opening it gives".
 *
 * What ranks a relic is how close it gets you to CLOSING a set (`progress`): half a set does not sell.
 * `useful` (how many of its 6 rewards you miss) is shown but does not sort.
 *
 * Pure: everything comes in through `deps`.
 */

/**
 * How much a missing part brings you closer to CASHING IN, by what is left of its set. `1 / left²`, not
 * `1 / left`: half a set does not sell.
 */
export function closenessWeight(setMissing) {
  const quedan = Math.max(1, setMissing || 1);
  return 1 / (quedan * quedan);
}

/** The era is the first word of the name ("Lith G1"). "Vanguard" is what the worldstate calls Axi. */
export function tierOfRelic(relicName) {
  const tier = String(relicName || "").trim().split(/\s+/)[0] || "";
  return tier === "Vanguard" ? "Axi" : tier;
}

/**
 * @param deps.relicCounts    { [relic without " Relic"]: copies }
 * @param deps.relicsDatabase { [relic]: [{ name, chance }] }
 * @param deps.fissures       active fissures [{ node, type, tier, eta }]: the open eras AND the mission
 *        to go to. Empty = unknown, and nothing is marked ready.
 * @param deps.getPrice       (name) => platinum. Optional: without it picks go unvalued.
 * @param deps.setsDatabase / primeInventory / getSetName / getRequiredCount / dropChances / squadSize
 *        what relicSetValue needs.
 * @param limit  how many to return.
 * @returns [{ relic, tier, owned, progress, closes, closeOdds, useful, odds, runs, ready,
 *           parts: [{ name, set, missing, total }] }], sorted.
 */
export function rankRelicPicks(deps, limit = 8) {
  const {
    relicCounts = {}, relicsDatabase = {}, fissures = [], getPrice = null,
    setsDatabase, primeInventory, getSetName, getRequiredCount, dropChances, squadSize = 4,
  } = deps;

  // live fissures by era; an Omnia opens the four classic ones (tiersOpenedBy)
  const porEra = new Map();
  for (const f of fissures) {
    for (const t of tiersOpenedBy(f)) {
      if (!porEra.has(t)) porEra.set(t, []);
      porEra.get(t).push(f);
    }
  }

  const picks = [];
  for (const [relic, owned] of Object.entries(relicCounts)) {
    if (!(owned > 0)) continue;
    const drops = relicsDatabase[relic] || relicsDatabase[`${relic} Relic`];
    if (!Array.isArray(drops) || drops.length === 0) continue;

    const v = relicSetValue(drops, {
      setsDatabase, primeInventory, getSetName, getRequiredCount,
      dropChances, squadSize, stock: owned,
    });
    // nothing missing: opening it brings you no closer to a set
    if (v.missing.length === 0) continue;

    const tier = tierOfRelic(relic);
    const suyas = porEra.get(tier) || [];
    // the concrete fissure, picked by speed and time left
    const fisura = bestFissure(suyas);

    let valor = null;
    if (getPrice) {
      const precios = v.missing.map((m) => getPrice(m.part) || 0).filter((n) => n > 0);
      if (precios.length > 0) valor = Math.round(precios.reduce((a, b) => a + b, 0) / precios.length);
    }

    // the ones that CLOSE a set in one crack, and how likely
    const cierran = v.missing.filter((m) => m.setMissing === 1);
    const setsCerrados = [...new Set(cierran.map((m) => m.set))];

    picks.push({
      // estimated minutes until something you miss drops: average runs × its era's fastest mission
      minutes: (Number.isFinite(v.runs) && fisura)
        ? Math.round(v.runs * missionMinutes(fisura.type))
        : null,
      closes: setsCerrados,
      // chance of closing ANY of them in one crack, not the sum
      closeOdds: 1 - cierran.reduce((p, m) => p * (1 - m.chance), 1),
      progress: v.missing.reduce((s, m) => s + m.chance * closenessWeight(m.setMissing), 0),
      fissure: fisura,
      value: valor,
      relic,
      tier,
      owned,
      // DIFFERENT rewards you need
      useful: v.missing.length,
      odds: v.odds,
      runs: v.runs,
      // sets it feeds, no repeats: one relic can give two parts of the same set
      sets: [...new Set(v.missing.map((m) => m.set))],
      parts: v.missing.map((m) => ({
        name: m.part, set: m.set, missing: m.setMissing, total: m.setTotal,
      })),
      ready: suyas.length > 0,
    });
  }

  // what can be opened NOW first, then `progress`. Counting useful rewards does not sort: with a half
  // inventory most relics have all 6
  picks.sort((a, b) =>
    ((b.ready) - (a.ready))
    || (b.progress - a.progress)
    || (b.odds - a.odds)
    || (a.runs - b.runs));
  return picks.slice(0, limit);
}

/**
 * Sorts of the "by relic" view. All start with `ready` on purpose, like ROUTE_SORTS.
 */
export const PICK_SORTS = {
  // the default: closest to closing a set (see closenessWeight)
  best: (a, b) => (b.progress - a.progress) || (b.odds - a.odds) || (a.runs - b.runs),
  useful: (a, b) => (b.useful - a.useful) || (b.odds - a.odds) || (a.runs - b.runs),
  odds: (a, b) => (b.odds - a.odds) || (b.useful - a.useful),
  // unvalued goes last instead of tying at 0
  value: (a, b) => ((b.value ?? -1) - (a.value ?? -1)) || (b.useful - a.useful),
  // lowest first; without minutes (no fissure) last
  minutes: (a, b) => ((a.minutes ?? Infinity) - (b.minutes ?? Infinity)) || (b.useful - a.useful),
};

/**
 * Filters and reorders picks already computed: changing a filter must not recompute the odds of the
 * whole relic inventory.
 */
export function filterRelicPicks(picks, prefs = {}) {
  const { query = "", era = "", readyOnly = false, sortBy = "best" } = prefs;
  const q = String(query).trim().toLowerCase();

  const out = picks.filter((p) => {
    if (era && p.tier !== era) return false;
    if (readyOnly && !p.ready) return false;
    if (!q) return true;
    return p.relic.toLowerCase().includes(q)
      || (p.sets || []).some((s) => String(s).toLowerCase().includes(q))
      || (p.parts || []).some((x) => String(x?.name || x).toLowerCase().includes(q));
  });
  out.sort((a, b) => (b.ready - a.ready) || (PICK_SORTS[sortBy] || PICK_SORTS.best)(a, b));
  return out;
}
