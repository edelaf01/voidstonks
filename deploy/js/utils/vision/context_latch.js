export const SWITCH_FRAMES = 2;
export const RELEASE_FRAMES = 3;

export const INITIAL_LATCH = Object.freeze({
  latched: "UNKNOWN",
  unknownCount: 0,
  pending: null,
  pendingCount: 0,
});

/**
 * @param prev  previous state: { latched, unknownCount, pending, pendingCount }
 * @param raw   context the OCR reads on this frame
 * @returns the new state (a new object, `prev` is not mutated)
 */
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

  // leaving UNKNOWN latches AT ONCE: that is acquiring, not changing its mind, and waiting only delays the
  // first read of the rewards screen
  if (s.latched === "UNKNOWN") {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  const pendingCount = s.pending === raw ? s.pendingCount + 1 : 1;
  if (pendingCount >= SWITCH_FRAMES) {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }
  return { latched: s.latched, unknownCount: 0, pending: raw, pendingCount };
}

/** Contexts that CANCEL the riven grace: reaching any of them means you are no longer on a mods screen. */
export const CANCELAN_GRACIA = Object.freeze(["RELICS", "REWARD", "MISSION_COMPLETE"]);

/**
 * Where the frame goes given the riven grace. The grace covers the gaps where the riven screen header is
 * unreadable so a card is not dropped half read, and only those gaps.
 */
export function enrutaGraciaRiven(raw, graciaActiva, tipoGracia) {
  if (!graciaActiva) return { contexto: raw, cancelar: false };
  if (CANCELAN_GRACIA.includes(raw)) return { contexto: raw, cancelar: true };
  if (raw === "UNKNOWN" || raw === "INVENTORY") {
    return { contexto: tipoGracia || "INVENTORY_MODS", cancelar: false };
  }
  return { contexto: raw, cancelar: false };
}

export const TOL_HEADER_BASE = 6;
const TOPE_HEADER_ESTABLE = 3;

export function toleranciaCabecera(estable = 0) {
    return TOL_HEADER_BASE * (1 + Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE));
}

const INTERVALO_ESTABLE_MS = 300;
const INTERVALO_MAXIMO_MS = 1200;

/**
 * How often the header OCR may repeat. The hash cut is not enough: an ANIMATED icon in the crop corner
 * changes it every frame. So once the context has been still for a while the FREQUENCY is capped (~1 read
 * per second); right after a change nothing is capped.
 */
export function intervaloCabecera(estable = 0) {
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

export function caducidadCabecera(contexto) {
  return contexto === "MISSION_COMPLETE" ? 10000 : 2500;
}
