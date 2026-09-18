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

/** Corte por hash de la cabecera, y cuánto lo multiplica una racha de contexto estable. */
export const TOL_HEADER_BASE = 6;
const TOPE_HEADER_ESTABLE = 3;

/**
 * Cuánto puede moverse el recorte de cabecera antes de volver a pasarle el OCR.
 *
 * Arranca ESTRICTO (con 18 el salto gameplay->recompensas quedaba por debajo del corte y se
 * reutilizaba texto viejo) y se afloja mientras el contexto no cambie. Medido en el navegador:
 * sobre una pantalla quieta el hash se mueve igual —el recorte es píxel crudo del stream y el
 * ruido de vídeo basta— así que se re-OCReaba en CADA frame, 206-287 ms de los ~300 del tick.
 *
 * Aflojar aquí no puede dejar ciego al escáner más de lo que ya permite su TTL, que fuerza la
 * relectura pase lo que pase; y en cuanto el contexto cambia, se vuelve al corte estricto.
 */
export function toleranciaCabecera(estable = 0) {
    return TOL_HEADER_BASE * (1 + Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE));
}

/** Cada cuánto se puede repetir el OCR de cabecera, en ms, según la racha de contexto estable. */
const INTERVALO_ESTABLE_MS = 300;
const INTERVALO_MAXIMO_MS = 1200;

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
export function intervaloCabecera(estable = 0) {
    const rachas = Math.min(Math.max(estable, 0), TOPE_HEADER_ESTABLE);
    return Math.min(rachas * INTERVALO_ESTABLE_MS, INTERVALO_MAXIMO_MS);
}

/**
 * Cuánto vale el texto de cabecera sin releerlo, aunque el hash se mueva.
 *
 * 2,5 s en general: INVENTORY e INVENTORY_MODS solo se distinguen por una palabra del rótulo
 * ("SELL"/"MODS"), que en un hash de 16×9 no mueve nada, así que ahí es el reloj quien detecta
 * el cambio. En fin de misión no hay transición sutil —de ahí se sale al orbitador o a la
 * misión, y eso el hash lo ve— y la pantalla se queda quieta hasta que el jugador pulsa: releer
 * las tres pasadas de cabecera cada frame era el mayor coste fijo de esa pantalla.
 */
export function caducidadCabecera(contexto) {
  return contexto === "MISSION_COMPLETE" ? 10000 : 2500;
}
