/**
 * Which on-screen reward gets you closest to closing a set. The modal already marked the most plat and
 * the best ducat ratio ("what do I sell"); this answers what CLOSES something.
 *
 * Pure: everything comes in through `deps`.
 */

/**
 * How much a part helps, or null when it does not (already owned, or in no set). `left` = parts the set
 * would still miss AFTER taking it; 0 = closes it.
 */
export function setHelpOf(part, deps) {
  const { setsDatabase = {}, primeInventory = {}, getSetName, getRequiredCount = () => 1 } = deps;
  const setName = getSetName?.(part);
  if (!setName || setName === "Otros") return null;
  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const falta = (p, extra = 0) =>
    ((primeInventory[p] || 0) + extra) < (getRequiredCount(setName, p) || 1);

  // already covered: taking it does not get the set closer
  if (!falta(part)) return null;

  const left = parts.filter((p) => falta(p, p === part ? 1 : 0)).length;
  return { set: setName, left, total: parts.length };
}

/**
 * The reward that gets a set closest, or null when none helps. Fewest left wins; ties go to the SMALLEST
 * set, the one that really closes first.
 */
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
