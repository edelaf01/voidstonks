/**
 * How many RUNS a relic costs to give you something you miss. Computed by REFINEMENT and SQUAD SIZE: in
 * a squad of 4, 4 relics open and you keep the best reward.
 */

/**
 * Chance of ONE given part when opening the relic: 3 commons, 2 uncommons and 1 rare, the tier's chance
 * split among the parts that share it.
 */
export function partDropChance(chance, dropChances) {
  if (chance < 5) return dropChances.rare;
  if (chance < 20) return dropChances.uncommon / 2;
  return dropChances.common / 3;
}

/**
 * @param drops                relic parts: [{ name, chance }]
 * @param deps.setsDatabase     { [set]: [part names] }
 * @param deps.primeInventory   { [part]: count }
 * @param deps.getSetName       (part) => its set
 * @param deps.getRequiredCount (set, part) => how many are needed (Systems x1, Forma x2...)
 * @param deps.dropChances      DROP_CHANCES tier of the refinement in use
 * @param deps.squadSize        how many open at once (4 by default)
 * @param deps.stock            copies of this relic you OWN
 * @returns {{runs:number, odds:number, missing:Array, bestSet:string|null,
 *           bestSetMissing:number, bestSetTotal:number, bestSetStarted:boolean}}
 *         runs = Infinity and odds = 0 when the relic drops nothing you miss. odds = chance of getting
 *         something you miss spending ALL your copies.
 */
export function relicSetValue(drops, deps) {
  const {
    setsDatabase = {}, primeInventory = {},
    getSetName, getRequiredCount, dropChances, squadSize = 4, stock = 1,
  } = deps;
  const none = {
    runs: Infinity, odds: 0, missing: [],
    bestSet: null, bestSetMissing: 0, bestSetTotal: 0, bestSetStarted: false,
  };
  if (!Array.isArray(drops) || drops.length === 0) return none;

  const isMissing = (set, part) => (primeInventory[part] || 0) < getRequiredCount(set, part);

  // missing parts per set, cached within the call: parts of one relic are often from the same set
  const setStatCache = new Map();
  const statsOfSet = (set) => {
    if (!setStatCache.has(set)) {
      const parts = setsDatabase[set] || [];
      const miss = parts.filter((p) => isMissing(set, p)).length;
      // "started" = you own a part already: otherwise small sets win
      setStatCache.set(set, { missing: miss, total: parts.length, started: miss < parts.length });
    }
    return setStatCache.get(set);
  };

  const missing = [];
  let pNothing = 1;
  for (const drop of drops) {
    const set = getSetName(drop.name);
    // "others" are Forma, Kuva and such: no set to complete
    if (!set || !setsDatabase[set]) continue;
    if (!isMissing(set, drop.name)) continue;

    const single = partDropChance(drop.chance, dropChances);
    const squad = 1 - Math.pow(1 - single, squadSize);
    pNothing *= (1 - squad);
    const st = statsOfSet(set);
    missing.push({
      part: drop.name, set, chance: squad, single,
      setMissing: st.missing || 1, setTotal: st.total, setStarted: st.started,
    });
  }

  if (missing.length === 0) return none;
  const pSomething = 1 - pNothing;

  // the closest set labels the row: started beats untouched, then fewest missing, then the most likely
  // part
  const rank = (m) => (m.setStarted ? m.setMissing : Number.MAX_SAFE_INTEGER);
  const best = missing.reduce((a, b) =>
    (rank(b) < rank(a) || (rank(b) === rank(a) && b.chance > a.chance)) ? b : a);

  return {
    runs: pSomething > 0 ? 1 / pSomething : Infinity,
    odds: 1 - Math.pow(pNothing, Math.max(1, stock)),
    missing,
    bestSet: best.set,
    bestSetMissing: best.setMissing,
    bestSetTotal: best.setTotal,
    bestSetStarted: best.setStarted,
  };
}

/**
 * Which set to track when opening a relic's card, or `null` to leave it. Kept apart from the painter:
 * these two rules stop browsing relics from overwriting the panel.
 */
export function pickSetToTrack(value, currentSet) {
  if (!value?.bestSet) return null;
  // the set you already track drops here: respected
  if (currentSet && value.missing.some((m) => m.set === currentSet)) return null;
  return value.bestSet;
}

/**
 * Formatted texts of a result, the component only wraps them in HTML.
 */
export function describeRelicRuns(r, t) {
  if (!Number.isFinite(r.runs)) return { none: t.nothing };
  return {
    runs: `≈${r.runs < 10 ? r.runs.toFixed(1) : Math.round(r.runs)} ${t.runs} · ${Math.round(r.odds * 100)}%`,
    // "2 of 5 missing" places what is left against the set size
    set: `${r.bestSet} · ${r.bestSetMissing === 1 ? t.lastPart : `${t.missing} ${r.bestSetMissing}/${r.bestSetTotal}`}`,
    more: r.missing.length > 1 ? `+${r.missing.length - 1}` : "",
  };
}
