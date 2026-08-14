/**
 * Farm route to close a set you have half done: the missing parts, the relics they drop from, how many
 * of those you own, where to farm the rest, and what can run NOW because a fissure of its era is open.
 *
 * Pure: everything comes in through `deps`, testable without a browser or live data.
 */

function setProgress(setName, parts, primeInventory, getRequiredCount) {
  let built = Infinity;
  for (const p of parts) {
    const req = getRequiredCount(setName, p) || 1;
    built = Math.min(built, Math.floor((primeInventory[p] || 0) / req));
  }
  if (!Number.isFinite(built)) built = 0;
  const target = built + 1;
  const missingParts = parts.filter(
    (p) => (primeInventory[p] || 0) < (getRequiredCount(setName, p) || 1) * target,
  );
  return { built, missingParts };
}

/** Eras are normalized: the worldstate calls Axi "Vanguard". */
export function normalizeTier(tier) {
  return tier === "Vanguard" ? "Axi" : tier;
}

export function buildSetRoute(setName, deps) {
  const {
    setsDatabase = {}, primeInventory = {}, itemsDatabase = {},
    relicCounts = {}, relicSources = {}, fissures = [],
    getRequiredCount = () => 1,
  } = deps;

  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  // whole sets you already have: with spare parts you are one part from the next set
  const { built, missingParts } = setProgress(setName, parts, primeInventory, getRequiredCount);
  if (missingParts.length === 0) return null;

  const fissuresByTier = new Map();
  for (const f of fissures) {
    const tier = normalizeTier(f.tier);
    if (!fissuresByTier.has(tier)) fissuresByTier.set(tier, []);
    fissuresByTier.get(tier).push(f);
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
        owned: relicCounts[key] || 0,
        sources: (relicCounts[key] || 0) > 0 ? [] : (relicSources[key] || []),
        fissures: fissuresByTier.get(tier) || [],
      };
    });
    relics.sort((a, b) =>
      (b.owned > 0 && b.fissures.length > 0) - (a.owned > 0 && a.fissures.length > 0)
      || (b.owned - a.owned)
      || (b.chance - a.chance));
    return { part, relics, ready: relics.some((r) => r.owned > 0 && r.fissures.length > 0) };
  });

  return {
    setName,
    totalParts: parts.length,
    built,
    missingCount: missingParts.length,
    readyCount: missing.filter((m) => m.ready).length,
    missing,
  };
}

export function buildFarmRoutes(deps, limit = 8) {
  const { setsDatabase = {}, primeInventory = {}, getRequiredCount = () => 1 } = deps;
  const routes = [];
  for (const setName of Object.keys(setsDatabase)) {
    const parts = setsDatabase[setName];
    if (!Array.isArray(parts) || parts.length === 0) continue;
    const { missingParts } = setProgress(setName, parts, primeInventory, getRequiredCount);
    if (missingParts.length === 0 || missingParts.length === parts.length) continue;
    const route = buildSetRoute(setName, deps);
    if (route) routes.push(route);
  }
  routes.sort((a, b) => (a.missingCount - b.missingCount) || (b.readyCount - a.readyCount));
  return routes.slice(0, limit);
}
