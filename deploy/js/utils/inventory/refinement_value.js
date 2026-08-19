import { relicOpenEV } from "./relic_drop_odds.utils.js";

export const TRACE_COST = { intact: 0, exceptional: 25, flawless: 50, radiant: 100 };

export const REFINEMENT_ORDER = ["intact", "exceptional", "flawless", "radiant"];

export const MIN_PLAT_PER_TRACE = 0.05;

export function refinementValue(drops, opts = {}) {
  const { squadSize = 1 } = opts;
  // cannot destructure valueOf or inherited Object.prototype.valueOf passes typeof function
  const valueOf = Object.hasOwn(opts, "valueOf") ? opts.valueOf : null;
  if (!Array.isArray(drops) || drops.length === 0 || typeof valueOf !== "function") return null;

  const ev = {};
  for (const ref of REFINEMENT_ORDER) {
    ev[ref] = relicOpenEV(drops, { refinement: ref, squadSize, valueOf });
  }
  if (!Object.values(ev).some((v) => v > 0)) return null;

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
