// picks the reward that gets closest to closing an uncompleted set

export function setHelpOf(part, deps) {
  const { setsDatabase = {}, primeInventory = {}, getSetName, getRequiredCount = () => 1 } = deps;
  const setName = getSetName?.(part);
  if (!setName || setName === "Otros") return null;
  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const falta = (p, extra = 0) =>
    ((primeInventory[p] || 0) + extra) < (getRequiredCount(setName, p) || 1);

  if (!falta(part)) return null;

  const left = parts.filter((p) => falta(p, p === part ? 1 : 0)).length;
  return { set: setName, left, total: parts.length };
}

// fewest left wins, ties go to the smallest set because it closes first
export function pickBestForSets(items, deps) {
  let mejor = null;
  for (const item of items || []) {
    const ayuda = setHelpOf(item?.name, deps);
    if (!ayuda) continue;
    const cand = { name: item.name, ...ayuda };
    if (!mejor
        || cand.left < mejor.left
        || (cand.left === mejor.left && cand.total < mejor.total)) {
      mejor = cand;
    }
  }
  return mejor;
}
