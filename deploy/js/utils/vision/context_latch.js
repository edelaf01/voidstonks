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

export const CANCELAN_GRACIA = Object.freeze(["RELICS", "REWARD", "MISSION_COMPLETE"]);

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

export function intervaloCabecera(estable = 0) {
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

export function caducidadCabecera(contexto) {
  return contexto === "MISSION_COMPLETE" ? 10000 : 2500;
}
