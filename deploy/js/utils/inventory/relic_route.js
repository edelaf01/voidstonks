// farm routes to close partially completed sets using owned relics and open fissures

function setProgress(setName, parts, primeInventory, getRequiredCount) {
  const req = (p) => getRequiredCount(setName, p) || 1;
  const sets = new Map(parts.map((p) => [p, Math.floor((primeInventory[p] || 0) / req(p))]));

  const built = Math.min(...sets.values());
  const porEncima = [...sets.values()].filter((n) => n > built);
  const unSoloCuello = [...sets.values()].filter((n) => n === built).length === 1;
  const target = (unSoloCuello && porEncima.length > 0) ? Math.min(...porEncima) : built + 1;

  const missingParts = [];
  const needed = {};
  for (const p of parts) {
    const faltan = target * req(p) - (primeInventory[p] || 0);
    if (faltan > 0) {
      missingParts.push(p);
      needed[p] = faltan;
    }
  }
  return { built, missingParts, needed, target, setsUnlocked: target - built };
}

// observed mission durations including load and extraction, not from an API
const MISSION_MINUTES = {
  Capture: 2, Extermination: 4, Rescue: 5, Sabotage: 4, Spy: 6,
  "Mobile Defense": 6, Assault: 5,
  Survival: 5, Defense: 5, Interception: 7, Excavation: 7, Disruption: 6,
  "Void Cascade": 6, "Void Flood": 6, Alchemy: 5, "Conjunction Survival": 6,
};
const DEFAULT_MINUTES = 6;

export function missionMinutes(type) {
  const t = String(type || "");
  if (MISSION_MINUTES[t]) return MISSION_MINUTES[t];
  for (const k of Object.keys(MISSION_MINUTES)) if (t.includes(k)) return MISSION_MINUTES[k];
  return DEFAULT_MINUTES;
}

export function bestFissure(fissures = []) {
  if (!fissures.length) return null;
  const restante = (f) => Date.parse(f?.expiry) || Number(f?.expiry) || 0;
  return [...fissures].sort((a, b) =>
    (missionMinutes(a.type) - missionMinutes(b.type))
    || (restante(b) - restante(a)))[0];
}

export function normalizeTier(tier) {
  return tier === "Vanguard" ? "Axi" : tier;
}

const CLASSIC_TIERS = ["Lith", "Meso", "Neo", "Axi"];

export function tiersOpenedBy(fissure) {
  const tier = normalizeTier(fissure?.tier);
  return tier === "Omnia" ? [...CLASSIC_TIERS] : [tier];
}

const nodoBase = (texto) => String(texto || "").split("(")[0].trim().toLowerCase();

export function eraDeLaMision(mision, fissures = []) {
  const nodo = nodoBase(mision);
  if (!nodo) return null;
  const eras = new Set(fissures.filter((f) => nodoBase(f?.node) === nodo).map((f) => normalizeTier(f.tier)));
  if (eras.size !== 1) return null;
  const [era] = eras;
  return era === "Omnia" ? null : era;
}

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
        runs: relicRuns ? relicRuns(src) : null,
        owned: relicCounts[key] || 0,
        sources: (relicCounts[key] || 0) > 0 ? [] : (relicSources[key] || []),
        fissures: fissuresByTier.get(tier) || [],
      };
    });

    const byRuns = (a, b) =>
      (Number.isFinite(a.runs) && Number.isFinite(b.runs)) ? a.runs - b.runs : 0;

    relics.sort((a, b) =>
      (preferTier ? (b.tier === preferTier) - (a.tier === preferTier) : 0)
      || (b.owned > 0 && b.fissures.length > 0) - (a.owned > 0 && a.fissures.length > 0)
      || byRuns(a, b)
      || (b.owned - a.owned)
      || (b.chance - a.chance));
    return {
      part,
      needed: needed[part] || 1,
      relics,
      ready: relics.some((r) => r.owned > 0 && r.fissures.length > 0),
      fissure: bestFissure(relics[0]?.fissures),
      refValue: (refinementValueOf && relics[0]) ? refinementValueOf(relics[0].relic) : null,
    };
  });

  let gain = null;
  let setValue = null;
  if (getPrice) {
    setValue = getPrice(`${setName} Set`) || 0;
    const held = parts.reduce((sum, p) => {
      const req = getRequiredCount(setName, p) || 1;
      const have = Math.min(primeInventory[p] || 0, req * target) - req * built;
      return sum + Math.max(0, have) * (getPrice(p) || 0);
    }, 0);
    gain = setValue > 0 ? Math.round(setValue * setsUnlocked - held) : null;
  }

  let minutes = null;
  if (expectedRuns || relicRuns) {
    minutes = 0;
    for (const m of missing) {
      const elegida = m.relics[0]?.runs;
      const runs = Number.isFinite(elegida) ? elegida : expectedRuns?.(m.part);
      if (!Number.isFinite(runs)) { minutes = null; break; }
      minutes += runs * m.needed * missionMinutes(m.fissure?.type);
    }
    if (minutes !== null) minutes = Math.round(minutes);
  }

  const refino = bestRefinementFor(missing, refinementRuns);

  return {
    setName,
    totalParts: parts.length,
    bestRefinement: refino ? refino.best : null,
    refinementRunsBy: refino ? refino.runsBy : null,
    built,
    setsUnlocked,
    missingCount: missingParts.length,
    readyCount: missing.filter((m) => m.ready).length,
    setValue,
    gain,
    minutes,
    platPerHour: gain !== null && minutes ? Math.round((gain / minutes) * 60) : null,
    missing,
  };
}

export const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"];

// refining lowers common chance, so a set missing only commons gets slower with vestiges
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
  const best = candidatos.reduce((a, b) => (runsBy[b] < runsBy[a] ? b : a));
  return { best, runsBy };
}

export const ROUTE_SORTS = {
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
    const route = buildSetRoute(setName, deps);
    if (route) routes.push(route);
  }
  routes.sort(ROUTE_SORTS[deps.sortBy] || ROUTE_SORTS.near);
  return routes.slice(0, limit);
}
