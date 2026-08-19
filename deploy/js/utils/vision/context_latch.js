/**
 * Qué contexto de pantalla se da por bueno, a partir del que dice el OCR de cabecera.
 *
 * El OCR de cabecera sale a ratos ilegible incluso sin cambiar de pantalla: en la selección de
 * reliquias se leen cosas como "WARFRAVE", "go TC" o "(ims sovo Mesh". Creerse cada frame hace
 * que el escáner salte de RELICS a REWARD y a INVENTORY_MODS y vuelva, recortando y pasando OCR
 * sobre zonas que no tocan.
 *
 * La histéresis era de un solo lado: UNKNOWN necesitaba 3 frames para engancharse, pero
 * cualquier otro contexto enganchaba con UNO. Un único frame de basura que casara con REWARD
 * cambiaba el pipeline entero.
 *
 * Aquí es simétrica: confirmar el contexto que ya está no cuesta nada, CAMBIARLO pide 2 frames
 * seguidos de acuerdo, y soltarlo a UNKNOWN pide 3 — soltar es más caro que confirmar porque en
 * una transición real la cabecera pasa por ilegible antes de estabilizarse.
 *
 * Puro: entra el estado y sale el estado siguiente, para poder probarlo sin navegador.
 */

// Frames seguidos que hacen falta para cambiar de un contexto conocido a otro.
export const SWITCH_FRAMES = 2;
// Frames seguidos de UNKNOWN que hacen falta para soltar el contexto enganchado.
export const RELEASE_FRAMES = 3;

export const INITIAL_LATCH = Object.freeze({
  latched: "UNKNOWN",
  unknownCount: 0,
  pending: null,
  pendingCount: 0,
});

/**
 * @param prev  estado anterior: { latched, unknownCount, pending, pendingCount }
 * @param raw   contexto que dice el OCR de este frame
 * @returns el estado nuevo (objeto nuevo; no muta `prev`)
 */
export function nextLatchedContext(prev, raw) {
  const s = { ...INITIAL_LATCH, ...prev };

  if (raw === "UNKNOWN") {
    const unknownCount = s.unknownCount + 1;
    return {
      latched: unknownCount >= RELEASE_FRAMES ? "UNKNOWN" : s.latched,
      unknownCount,
      // Una racha de UNKNOWN corta cualquier candidato a medias: dos frames de REWARD
      // separados por basura no son dos frames seguidos de acuerdo.
      pending: null,
      pendingCount: 0,
    };
  }

  if (raw === s.latched) {
    return { latched: s.latched, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  // Salir de UNKNOWN engancha YA. Los dos frames existen para que un frame de basura no le
  // robe el contexto a otro ya confirmado; venir de "no sé qué miro" no es cambiar de opinión,
  // es adquirir, y ahí esperar solo retrasa la primera lectura de la pantalla de recompensas.
  if (s.latched === "UNKNOWN") {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }

  const pendingCount = s.pending === raw ? s.pendingCount + 1 : 1;
  if (pendingCount >= SWITCH_FRAMES) {
    return { latched: raw, unknownCount: 0, pending: null, pendingCount: 0 };
  }
  return { latched: s.latched, unknownCount: 0, pending: raw, pendingCount };
}
