import { fraccionCambiada } from "./frame_hash.js";

export const SWITCH_FRAMES = 2;
export const RELEASE_FRAMES = 3;

// excludes RELICS to REWARD: on relic selection OCR garbage reads as REWARD
export const TRANSICIONES_ESPERADAS = Object.freeze({
  REWARD: ["RELICS", "MISSION_COMPLETE"],
  TRADE: ["INVENTORY"],
  INVENTORY: ["TRADE"],
});

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
    const suelta = unknownCount >= RELEASE_FRAMES;
    return {
      latched: suelta ? "UNKNOWN" : s.latched,
      unknownCount,
      pending: suelta ? null : s.pending,
      pendingCount: suelta ? 0 : s.pendingCount,
    };
  }

  if (raw === s.latched) {
    return { latched: s.latched, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  if (s.latched === "UNKNOWN" || TRANSICIONES_ESPERADAS[s.latched]?.includes(raw)) {
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

const TOPE_HEADER_ESTABLE = 3;

export const FRANJA_TITULO = Object.freeze({ x: 0.21, y: 0.30, w: 0.79, h: 0.42, cols: 64, filas: 8 });
export const RECORTE_CABECERA = Object.freeze({ w: 0.45, h: 0.12 });
export const FRANJA_TITULO_VIDEO = Object.freeze({
    x: RECORTE_CABECERA.w * FRANJA_TITULO.x, y: RECORTE_CABECERA.h * FRANJA_TITULO.y,
    w: RECORTE_CABECERA.w * FRANJA_TITULO.w, h: RECORTE_CABECERA.h * FRANJA_TITULO.h, cols: 64, filas: 8,
});
export const FRANJA_CATEGORIA_VIDEO = Object.freeze({ x: 0.03, y: 0.10, w: 0.10, h: 0.034, cols: 32, filas: 4 });
export const FRACCION_TITULO = 0.04;
export function tituloHaCambiado(ahora, base) { return fraccionCambiada(ahora, base) >= FRACCION_TITULO; }

const INTERVALO_ESTABLE_MS = 300;
const INTERVALO_MAXIMO_MS = 1200;
export const INTERVALO_FIN_MISION_MS = 3000;

export function intervaloCabecera(estable = 0, latched = "UNKNOWN") {
    if (latched === "MISSION_COMPLETE" && estable >= TOPE_HEADER_ESTABLE) return INTERVALO_FIN_MISION_MS;
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

export const CADUCIDAD_CABECERA_MS = 10000;
