import { fraccionCambiada } from "./frame_hash.js";
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
 * de acuerdo sin otro contexto en medio, y soltarlo a UNKNOWN pide 3 seguidos — soltar es más caro
 * que confirmar porque en una transición real la cabecera pasa por ilegible antes de estabilizarse.
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
    const suelta = unknownCount >= RELEASE_FRAMES;
    return {
      latched: suelta ? "UNKNOWN" : s.latched,
      unknownCount,
      // Ilegible no es desacuerdo: si borrara al candidato, una cabecera legible una vez sí y otra no
      // (la SELECT RELIC de una fisura sin fin) dejaba enganchada la pantalla anterior para siempre.
      pending: suelta ? null : s.pending,
      pendingCount: suelta ? 0 : s.pendingCount,
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

/**
 * Contextos que CANCELAN la gracia de rivens: haber llegado a cualquiera de ellos significa que
 * ya no estás en una pantalla de mods, por reciente que fuera la última.
 */
export const CANCELAN_GRACIA = Object.freeze(["RELICS", "REWARD", "MISSION_COMPLETE"]);

/**
 * A dónde va el frame teniendo en cuenta la gracia de rivens.
 *
 * La gracia tapa los huecos en que el header de la pantalla de rivens sale ilegible; sin ella el
 * escáner abandonaba la carta a medio leer. Pero solo debe tapar huecos: MISSION_COMPLETE faltaba
 * en la lista de cancelación, así que al terminar una misión los primeros frames —cuya cabecera
 * aún no es legible— se re-enrutaban a INVENTORY_MODS y la pantalla se iba entera en OCR de
 * rivens, dando la sensación de que el fin de misión no se detecta.
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
 * Franja del rótulo dentro del recorte de cabecera (864×129 a 1440p), en fracciones. Empieza en
 * 0.21 para dejar fuera el avatar y el "+", el glifo que baila ("CB INVENTORYSELL" / "BI
 * INVENTORYSELL"), y llega al borde porque "VOID FISSURE/REWARDS" acaba en 0.97.
 */
export const FRANJA_TITULO = Object.freeze({ x: 0.21, y: 0.30, w: 0.79, h: 0.42, cols: 64, filas: 8 });
/** Recorte de cabecera en fracciones del frame (lo dibuja VisionService.prepareVirtualCanvas). */
export const RECORTE_CABECERA = Object.freeze({ w: 0.45, h: 0.12 });
/**
 * La franja en fracciones del FRAME, para muestrearla sin dibujar la cabecera, que solo hace falta
 * para el OCR. Corpus (45 capturas): decide igual que sobre el recorte en 989 de 990 pares, pero la
 * misma imagen difiere hasta un 13 % entre los dos métodos: base y muestra salen siempre de aquí.
 */
export const FRANJA_TITULO_VIDEO = Object.freeze({
    x: RECORTE_CABECERA.w * FRANJA_TITULO.x, y: RECORTE_CABECERA.h * FRANJA_TITULO.y,
    w: RECORTE_CABECERA.w * FRANJA_TITULO.w, h: RECORTE_CABECERA.h * FRANJA_TITULO.h, cols: 64, filas: 8,
});
/**
 * Medido sobre 14 cabeceras del corpus: misma pantalla 0 % de muestras cambiadas, inventario de
 * otra sesión 7 %, INVENTORY -> INVENTORY/MODS 14-19 %, -> REWARD 23-27 %. El hash de 16×9 de
 * antes daba 19-25 de distancia para SELL -> MODS, por debajo de su tolerancia (24): no lo veía.
 */
export const FRACCION_TITULO = 0.04;
export function tituloHaCambiado(ahora, base) { return fraccionCambiada(ahora, base) >= FRACCION_TITULO; }

/** Cada cuánto se puede repetir el OCR de cabecera, en ms, según la racha de contexto estable. */
const INTERVALO_ESTABLE_MS = 300;
const INTERVALO_MAXIMO_MS = 1200;
export const INTERVALO_FIN_MISION_MS = 3000;

/**
 * Cada cuánto puede repetirse el OCR de cabecera.
 *
 * El corte por hash no basta y no es culpa del ruido: en la esquina del recorte hay un icono
 * ANIMADO, y se ve en el propio texto que devuelve el OCR —"CB INVENTORYSELL", "BI
 * INVENTORYSELL", "CBI INVENTORY SELL"— donde solo baila el glifo de delante. Con eso el hash
 * cambia siempre y se pagaban 174-287 ms en CADA frame de un bucle de ~300 ms.
 *
 * Así que cuando el contexto lleva rato quieto se limita la FRECUENCIA. El tope deja ~1 lectura
 * por segundo, y la pantalla de recompensas dura unos 15 s: sigue habiendo de sobra para
 * engancharla. Con el contexto recién cambiado no se limita nada, que es cuando importa.
 */
export function intervaloCabecera(estable = 0, latched = "UNKNOWN") {
    // Fin de misión: la pantalla dura lo que tarde el jugador en leerla, el ledger no necesita la
    // cabecera y la escena animada tras el título movía la franja y forzaba una lectura de ~200 ms
    // cada segundo. Salir se detecta igual, solo que hasta 3 s más tarde, y ahí no hay nada urgente.
    if (latched === "MISSION_COMPLETE" && estable >= TOPE_HEADER_ESTABLE) return INTERVALO_FIN_MISION_MS;
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

/**
 * Cuánto vale el texto de cabecera sin releerlo aunque la franja del rótulo no se mueva. Antes
 * eran 2,5 s porque el reloj era lo único que detectaba SELL -> MODS; ahora lo ve la franja y el
 * tope solo acota una colisión.
 */
export const CADUCIDAD_CABECERA_MS = 10000;
