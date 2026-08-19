export const SWITCH_FRAMES = 2;
export const RELEASE_FRAMES = 3;

export const INITIAL_LATCH = Object.freeze({
  latched: "UNKNOWN",
  unknownCount: 0,
  pending: null,
  pendingCount: 0,
});

export function nextLatchedContext(prev, raw) {
  const s = { ...INITIAL_LATCH, ...prev };

  if (raw === "UNKNOWN") {
    const unknownCount = s.unknownCount + 1;
    return {
      latched: unknownCount >= RELEASE_FRAMES ? "UNKNOWN" : s.latched,
      unknownCount,
      pending: null,
      pendingCount: 0,
    };
  }

  if (raw === s.latched) {
    return { latched: s.latched, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  if (s.latched === "UNKNOWN") {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  const pendingCount = s.pending === raw ? s.pendingCount + 1 : 1;
  if (pendingCount >= SWITCH_FRAMES) {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }
  return { latched: s.latched, unknownCount: 0, pending: raw, pendingCount };
}
