import { fraccionCambiada } from "./frame_hash.js";
/**
 * Which screen context is taken as good, from what the header OCR says. The header OCR reads garbage now and
 * then even without a screen change, and trusting every frame made the scanner jump between contexts.
 *
 * Confirming the current context is free, CHANGING it takes 2 agreeing frames with no other context in
 * between, and releasing to UNKNOWN takes 3 in a row: in a real transition the header goes unreadable
 * before settling.
 *
 * Pure: state in, next state out.
 */

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
    const suelta = unknownCount >= RELEASE_FRAMES;
    return {
      latched: suelta ? "UNKNOWN" : s.latched,
      unknownCount,
      // unreadable is not disagreement: clearing the candidate left a header readable every other frame (endless
      // fissure SELECT RELIC) stuck on the previous screen
      pending: suelta ? null : s.pending,
      pendingCount: suelta ? 0 : s.pendingCount,
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

const TOPE_HEADER_ESTABLE = 3;

/**
 * Title strip inside the header crop (864×129 at 1440p), in fractions. Starts at 0.21 to leave out the
 * avatar and the animated glyph, and reaches the edge because "VOID FISSURE/REWARDS" ends at 0.97.
 */
export const FRANJA_TITULO = Object.freeze({ x: 0.21, y: 0.30, w: 0.79, h: 0.42, cols: 64, filas: 8 });
/** Header crop in frame fractions (drawn by VisionService.prepareVirtualCanvas). */
export const RECORTE_CABECERA = Object.freeze({ w: 0.45, h: 0.12 });
/**
 * The strip in FRAME fractions, to sample it without drawing the header, which only the OCR needs. Base and
 * sample always come from here: the same image differs up to 13 % between both methods.
 */
export const FRANJA_TITULO_VIDEO = Object.freeze({
    x: RECORTE_CABECERA.w * FRANJA_TITULO.x, y: RECORTE_CABECERA.h * FRANJA_TITULO.y,
    w: RECORTE_CABECERA.w * FRANJA_TITULO.w, h: RECORTE_CABECERA.h * FRANJA_TITULO.h, cols: 64, filas: 8,
});
/**
 * Fraction of changed strip samples that means another title: the same screen changes 0 %, the closest
 * real change (another session's inventory) 7 %.
 */
export const FRACCION_TITULO = 0.04;
export function tituloHaCambiado(ahora, base) { return fraccionCambiada(ahora, base) >= FRACCION_TITULO; }

const INTERVALO_ESTABLE_MS = 300;
const INTERVALO_MAXIMO_MS = 1200;
export const INTERVALO_FIN_MISION_MS = 3000;

/**
 * How often the header OCR may repeat. The hash cut is not enough: an ANIMATED icon in the crop corner
 * changes it every frame. So once the context has been still for a while the FREQUENCY is capped (~1 read
 * per second); right after a change nothing is capped.
 */
export function intervaloCabecera(estable = 0, latched = "UNKNOWN") {
    // mission end: the ledger does not need the header and the animated scene behind the title kept moving the
    // strip. Leaving is still detected, up to 3 s later
    if (latched === "MISSION_COMPLETE" && estable >= TOPE_HEADER_ESTABLE) return INTERVALO_FIN_MISION_MS;
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

/**
 * How long the header text stays valid without rereading while the title strip does not move; the cap only
 * bounds a collision.
 */
export const CADUCIDAD_CABECERA_MS = 10000;
