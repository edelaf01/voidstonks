import { relicOpenEV } from "./relic_drop_odds.utils.js";

// in-game cost of refining a relic, in vestiges
export const TRACE_COST = { intact: 0, exceptional: 25, flawless: 50, radiant: 100 };

export const REFINEMENT_ORDER = ["intact", "exceptional", "flawless", "radiant"];

// below this the refinement is not recommended even if it wins: price noise. 0.05 p/vestige = 5p per
// radiant
export const MIN_PLAT_PER_TRACE = 0.05;

/**
 * The refinement that makes the MOST PLATINUM from opening this relic. Not the same question as
 * `bestRefinementFor`, which closes the set in fewer runs and says "intact" when the missing parts are
 * common, even if the rare one is worth 60p.
 *
 * The verdict is plat per vestige, not plain plat: vestiges are the scarce resource.
 *
 * @param drops     the relic's 6 rewards, with `chance` to tell the rarity
 * @param valueOf   (reward) => platinum. Without it there is no verdict and null is returned.
 * @returns {{ev: Record<string,number>, best: string, gain: number, traces: number,
 *            perTrace: number, worth: boolean}|null}
 */
export function refinementValue(drops, opts = {}) {
  const { squadSize = 1 } = opts;
  // `valueOf` cannot be destructured: without it Object.prototype.valueOf is inherited and passes any
  // `typeof === "function"`
  const valueOf = Object.hasOwn(opts, "valueOf") ? opts.valueOf : null;
  if (!Array.isArray(drops) || drops.length === 0 || typeof valueOf !== "function") return null;

  const ev = {};
  for (const ref of REFINEMENT_ORDER) {
    ev[ref] = relicOpenEV(drops, { refinement: ref, squadSize, valueOf });
  }
  if (!Object.values(ev).some((v) => v > 0)) return null;

  // best plat per vestige wins, not best plat, or radiant would win every relic. Intact is the reference
  // outside the loop: its cost is 0
  let best = "intact";
  let mejorPerTrace = 0;
  for (const ref of REFINEMENT_ORDER) {
    if (TRACE_COST[ref] === 0) continue;
    const perTrace = (ev[ref] - ev.intact) / TRACE_COST[ref];
    if (perTrace > mejorPerTrace) { mejorPerTrace = perTrace; best = ref; }
  }

  const gain = ev[best] - ev.intact;
  const traces = TRACE_COST[best];
  return {
    ev, best, gain, traces,
    perTrace: mejorPerTrace,
    worth: best !== "intact" && mejorPerTrace >= MIN_PLAT_PER_TRACE,
  };
}
