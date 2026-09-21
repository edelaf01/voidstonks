// computes expected runs for a relic to drop a missing part by refinement and squad size

export function partDropChance(chance, dropChances) {
  if (chance < 5) return dropChances.rare;
  if (chance < 20) return dropChances.uncommon / 2;
  return dropChances.common / 3;
}

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

  const setStatCache = new Map();
  const statsOfSet = (set) => {
    if (!setStatCache.has(set)) {
      const parts = setsDatabase[set] || [];
      const miss = parts.filter((p) => isMissing(set, p)).length;
      // started means owning a part already: otherwise small sets always win
      setStatCache.set(set, { missing: miss, total: parts.length, started: miss < parts.length });
    }
    return setStatCache.get(set);
  };

  const missing = [];
  let pNothing = 1;
  for (const drop of drops) {
    const set = getSetName(drop.name);
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

export function pickSetToTrack(value, currentSet) {
  if (!value?.bestSet) return null;
  if (currentSet && value.missing.some((m) => m.set === currentSet)) return null;
  return value.bestSet;
}

export function describeRelicRuns(r, t) {
  if (!Number.isFinite(r.runs)) return { none: t.nothing };
  return {
    runs: `≈${r.runs < 10 ? r.runs.toFixed(1) : Math.round(r.runs)} ${t.runs} · ${Math.round(r.odds * 100)}%`,
    set: `${r.bestSet} · ${r.bestSetMissing === 1 ? t.lastPart : `${t.missing} ${r.bestSetMissing}/${r.bestSetTotal}`}`,
    more: r.missing.length > 1 ? `+${r.missing.length - 1}` : "",
  };
}
