import { relicSetValue } from "./relic_set_value.js";
import { bestFissure, missionMinutes, tiersOpenedBy } from "./relic_route.js";

/** The era is the first word of the name ("Lith G1"). "Vanguard" is what the worldstate calls Axi. */
export function tierOfRelic(relicName) {
  const tier = String(relicName || "").trim().split(/\s+/)[0] || "";
  return tier === "Vanguard" ? "Axi" : tier;
}

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

    picks.push({
      // estimated minutes until something you miss drops: average runs × its era's fastest mission
      minutes: (Number.isFinite(v.runs) && fisura)
        ? Math.round(v.runs * missionMinutes(fisura.type))
        : null,
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
      parts: v.missing.map((m) => m.part),
      ready: suyas.length > 0,
    });
  }

  picks.sort((a, b) =>
    ((b.ready) - (a.ready))
    || (b.useful - a.useful)
    || (b.odds - a.odds)
    || (a.runs - b.runs));
  return picks.slice(0, limit);
}

/**
 * Sorts of the "by relic" view. All start with `ready` on purpose, like ROUTE_SORTS.
 */
export const PICK_SORTS = {
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
  const { query = "", era = "", readyOnly = false, sortBy = "useful" } = prefs;
  const q = String(query).trim().toLowerCase();

  const out = picks.filter((p) => {
    if (era && p.tier !== era) return false;
    if (readyOnly && !p.ready) return false;
    if (!q) return true;
    return p.relic.toLowerCase().includes(q)
      || (p.sets || []).some((s) => String(s).toLowerCase().includes(q))
      || (p.parts || []).some((x) => String(x).toLowerCase().includes(q));
  });
  out.sort((a, b) => (b.ready - a.ready) || (PICK_SORTS[sortBy] || PICK_SORTS.useful)(a, b));
  return out;
}
