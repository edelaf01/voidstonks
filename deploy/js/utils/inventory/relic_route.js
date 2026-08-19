/**
 * Farm route to close a set you have half done: the missing parts, the relics they drop from, how many
 * of those you own, where to farm the rest, and what can run NOW because a fissure of its era is open.
 *
 * Pure: everything comes in through `deps`, testable without a browser or live data.
 */

function setProgress(setName, parts, primeInventory, getRequiredCount) {
  const req = (p) => getRequiredCount(setName, p) || 1;
  const sets = new Map(parts.map((p) => [p, Math.floor((primeInventory[p] || 0) / req(p))]));

  const built = Math.min(...sets.values());
  const porEncima = [...sets.values()].filter((n) => n > built);
  const target = porEncima.length > 0 ? Math.min(...porEncima) : built + 1;

  const missingParts = [];
  const needed = {};
  for (const p of parts) {
    const faltan = target * req(p) - (primeInventory[p] || 0);
    if (faltan > 0) {
      missingParts.push(p);
      needed[p] = faltan;
    }
  }
  // sets unlocked by closing it: that is why "farm 4 blueprints" makes sense
  return { built, missingParts, needed, target, setsUnlocked: target - built };
}

/**
 * Typical minutes per run of each mission type, load and extraction included. Observed durations, not
 * from an API: without them "effort" would be the run count.
 */
const MISSION_MINUTES = {
  Capture: 2, Extermination: 4, Rescue: 5, Sabotage: 4, Spy: 6,
  "Mobile Defense": 6, Assault: 5,
  Survival: 5, Defense: 5, Interception: 7, Excavation: 7, Disruption: 6,
  "Void Cascade": 6, "Void Flood": 6, Alchemy: 5, "Conjunction Survival": 6,
};
const DEFAULT_MINUTES = 6;

/** Minutes of a fissure; "Dark Sector Defense" counts as Defense. */
export function missionMinutes(type) {
  const t = String(type || "");
  if (MISSION_MINUTES[t]) return MISSION_MINUTES[t];
  for (const k of Object.keys(MISSION_MINUTES)) if (t.includes(k)) return MISSION_MINUTES[k];
  return DEFAULT_MINUTES;
}

/**
 * Best fissure of a list: fastest first, then the one with more time left.
 */
export function bestFissure(fissures = []) {
  if (!fissures.length) return null;
  // Date.parse, not Number: the worldstate sends expiry as ISO
  const restante = (f) => Date.parse(f?.expiry) || Number(f?.expiry) || 0;
  return [...fissures].sort((a, b) =>
    (missionMinutes(a.type) - missionMinutes(b.type))
    || (restante(b) - restante(a)))[0];
}

/** Eras are normalized: the worldstate calls Axi "Vanguard". */
export function normalizeTier(tier) {
  return tier === "Vanguard" ? "Axi" : tier;
}

// an Omnia fissure (Lua / Zariman / Deimos) takes any CLASSIC relic, so it counts for the four eras.
// Requiem is a different system
const CLASSIC_TIERS = ["Lith", "Meso", "Neo", "Axi"];

export function tiersOpenedBy(fissure) {
  const tier = normalizeTier(fissure?.tier);
  return tier === "Omnia" ? [...CLASSIC_TIERS] : [tier];
}

/**
 * @param setName                set to close
 * @param deps.setsDatabase       { [set]: [parts] }
 * @param deps.primeInventory     { [part]: count }
 * @param deps.itemsDatabase      { [part]: [{ relic, tier, rarity, chance }] }
 * @param deps.relicCounts        { [relic without " Relic"]: copies owned }
 * @param deps.relicSources       { [relic without " Relic"]: [{ location, mission, rotation, chance }] }
 * @param deps.fissures           [{ node, type, tier, eta, isSP }] active now
 * @param deps.getRequiredCount   (set, part) => how many are needed
 * @param deps.getPrice           (name) => platinum, 0 when unknown. Optional: without it the route is
 *   built unvalued.
 * @param deps.expectedRuns       (part) => average runs for one copy. Optional.
 * @param deps.relicRuns          (itemsDatabase entry) => average runs for the part from THAT relic, with
 *   the player's refinement and squad. Takes the whole entry because the source's `rarity` label is not
 *   reliable (see rarityFromChance). Optional.
 * @returns null when nothing is missing for the next set, or the set does not exist.
 */
export function buildSetRoute(setName, deps) {
  const {
    setsDatabase = {}, primeInventory = {}, itemsDatabase = {},
    relicCounts = {}, relicSources = {}, fissures = [],
    getRequiredCount = () => 1,
    getPrice = null, expectedRuns = null, relicRuns = null, refinementRuns = null,
    preferTier = "", refinementValueOf = null,
  } = deps;

  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  // whole sets you already have: with spare parts you are one part from the next set
  const { built, missingParts, needed, target, setsUnlocked } =
    setProgress(setName, parts, primeInventory, getRequiredCount);
  if (missingParts.length === 0) return null;

  const fissuresByTier = new Map();
  for (const f of fissures) {
    for (const tier of tiersOpenedBy(f)) {
      if (!fissuresByTier.has(tier)) fissuresByTier.set(tier, []);
      fissuresByTier.get(tier).push(f);
    }
  }

  const bare = (relic) => String(relic).replace(/\s+Relic$/, "").trim();

  const missing = missingParts.map((part) => {
    const relics = (itemsDatabase[part] || []).map((src) => {
      const key = bare(src.relic);
      const tier = normalizeTier(src.tier);
      return {
        relic: key,
        tier,
        rarity: src.rarity,
        chance: src.chance,
        // average runs with THIS relic; `chance` is the intact one (see relicRuns)
        runs: relicRuns ? relicRuns(src) : null,
        owned: relicCounts[key] || 0,
        sources: (relicCounts[key] || 0) > 0 ? [] : (relicSources[key] || []),
        fissures: fissuresByTier.get(tier) || [],
      };
    });

    // fewest runs first, copies only break ties
    const byRuns = (a, b) =>
      (Number.isFinite(a.runs) && Number.isFinite(b.runs)) ? a.runs - b.runs : 0;

    relics.sort((a, b) =>
      // a tier chosen in the filter rules over everything else
      (preferTier ? (b.tier === preferTier) - (a.tier === preferTier) : 0)
      || (b.owned > 0 && b.fissures.length > 0) - (a.owned > 0 && a.fissures.length > 0)
      || byRuns(a, b)
      || (b.owned - a.owned)
      || (b.chance - a.chance));
    return {
      part,
      // copies needed, not always 1 (see setProgress)
      needed: needed[part] || 1,
      relics,
      ready: relics.some((r) => r.owned > 0 && r.fissures.length > 0),
      fissure: bestFissure(relics[0]?.fissures),
      // refining may pay even if the route closes sooner intact: a separate question (see refinementValue)
      refValue: (refinementValueOf && relics[0]) ? refinementValueOf(relics[0].relic) : null,
    };
  });

  // what you GAIN by closing it, not what the set is worth: the parts you own sell loose today. Without
  // prices it stays null
  let gain = null;
  let setValue = null;
  if (getPrice) {
    setValue = getPrice(`${setName} Set`) || 0;
    const held = parts.reduce((sum, p) => {
      const req = getRequiredCount(setName, p) || 1;
      const have = Math.min(primeInventory[p] || 0, req * target) - req * built;
      return sum + Math.max(0, have) * (getPrice(p) || 0);
    }, 0);
    // the prize is EVERY set unlocked: 4 blueprints give 4 Hydroid
    gain = setValue > 0 ? Math.round(setValue * setsUnlocked - held) : null;
  }

  // effort = average runs of each missing part × its fastest mission, in minutes. The chosen relic rules
  // when known: expectedRuns() assumes the relic where the part drops best
  let minutes = null;
  if (expectedRuns || relicRuns) {
    minutes = 0;
    for (const m of missing) {
      const elegida = m.relics[0]?.runs;
      const runs = Number.isFinite(elegida) ? elegida : expectedRuns?.(m.part);
      if (!Number.isFinite(runs)) { minutes = null; break; }
      // × missing copies: four blueprints are four times the farm
      minutes += runs * m.needed * missionMinutes(m.fissure?.type);
    }
    if (minutes !== null) minutes = Math.round(minutes);
  }

  const refino = bestRefinementFor(missing, refinementRuns);

  return {
    setName,
    totalParts: parts.length,
    // "intact" | "exceptional" | "flawless" | "radiant"
    bestRefinement: refino ? refino.best : null,
    refinementRunsBy: refino ? refino.runsBy : null,
    // already built; the route aims at `target`, not always built + 1
    built,
    // sets built when the route completes: more than 1 when surplus waits for the bottleneck part
    setsUnlocked,
    missingCount: missingParts.length,
    readyCount: missing.filter((m) => m.ready).length,
    setValue,
    gain,
    minutes,
    // what sorts: platinum per farm hour
    platPerHour: gain !== null && minutes ? Math.round((gain / minutes) * 60) : null,
    missing,
  };
}

// cheapest to dearest in vestiges: on equal runs the cheaper wins
export const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"];

/**
 * Which refinement closes this route sooner. Not always radiant: refining raises rare and uncommon but
 * LOWERS common, so a set missing only commons gets slower with 100 vestiges. For each refinement, each
 * part takes its best relic WITH that refinement; lowest total wins, the cheaper on a tie.
 *
 * @param missing            route parts, with `relics` and `needed`
 * @param refinementRuns     (drop, refinement) => average runs, or null when unknown
 * @returns {{best: string, runsBy: Record<string, number>}|null}
 */
export function bestRefinementFor(missing, refinementRuns) {
  if (typeof refinementRuns !== "function" || !Array.isArray(missing) || missing.length === 0) return null;

  const runsBy = {};
  for (const ref of REFINEMENTS) {
    let total = 0;
    for (const m of missing) {
      let mejor = Infinity;
      for (const rel of m.relics || []) {
        const r = refinementRuns(rel, ref);
        if (Number.isFinite(r) && r < mejor) mejor = r;
      }
      if (!Number.isFinite(mejor)) { total = Infinity; break; }
      total += mejor * (m.needed || 1);
    }
    if (Number.isFinite(total)) runsBy[ref] = total;
  }

  const candidatos = REFINEMENTS.filter((r) => Number.isFinite(runsBy[r]));
  if (candidatos.length === 0) return null;
  // `<`, not `<=`, walking by cost: the first to tie stays, the cheap one
  const best = candidatos.reduce((a, b) => (runsBy[b] < runsBy[a] ? b : a));
  return { best, runsBy };
}

export const ROUTE_SORTS = {
  // the default: closeness rules, p/h breaks ties
  near: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || (a.missingCount - b.missingCount)
    || ((b.platPerHour ?? -1) - (a.platPerHour ?? -1))
    || (b.readyCount - a.readyCount),
  perHour: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || ((b.platPerHour ?? -1) - (a.platPerHour ?? -1))
    || (a.missingCount - b.missingCount),
  gain: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || ((b.gain ?? -1) - (a.gain ?? -1))
    || (a.missingCount - b.missingCount),
};

export function buildFarmRoutes(deps, limit = 8) {
  const { setsDatabase = {} } = deps;
  const routes = [];
  for (const setName of Object.keys(setsDatabase)) {
    const parts = setsDatabase[setName];
    if (!Array.isArray(parts) || parts.length === 0) continue;
    // EVERY set, touched or not: what decides is how many parts are missing
    const route = buildSetRoute(setName, deps);
    if (route) routes.push(route);
  }
  // what cannot run now goes last. A part may drop from relics of DIFFERENT eras, so "not now" means none
  // of its relics has a fissure: `ready` per part
  routes.sort(ROUTE_SORTS[deps.sortBy] || ROUTE_SORTS.near);
  return routes.slice(0, limit);
}
