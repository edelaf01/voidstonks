import { detectRewardBand } from "./grid_detect.js";

/**
 * ¿Es creíble lo que acaba de detectar la visión?
 *
 * Las dos guardas de aquí responden a la misma pregunta para dos detecciones distintas, y las
 * dos existen por el mismo motivo: una detección basura gana siempre a "no he detectado nada",
 * porque quien la recibe la da por buena y se salta el camino calibrado que sí funcionaba.
 * Rechazar solo cuesta volver a ese camino.
 */

/**
 * Guarda de plausibilidad para una calibración de rejilla GUARDADA (manual) que se
 * va a usar como fallback cuando el auto-grid no da señal este frame. La calibración
 * manual deriva las columnas de un simple ratio de aspecto de la caja arrastrada
 * (live_calibration.saveGrid), así que una caja mal dibujada (p.ej. toda la pantalla)
 * produce una rejilla basura —celdas enormes, columnas equivocadas, la zona invade el
 * panel de venta de la derecha— y recorta ítems/badges partidos. Preferimos NO escanear
 * a escanear con una rejilla basura.
 *
 * Una rejilla de inventario real ocupa ~11% del ancho por celda y ~20% del alto por
 * fila, y su zona no llega al panel lateral (~65% del ancho). Se rechaza si la zona
 * abarca casi todo el frame o si las celdas son desproporcionadamente grandes.
 *
 * @returns {boolean} true si la calibración es implausible y NO debe usarse.
 */
export function isImplausibleFallbackGrid(calib, frameW, frameH) {
    if (!calib || !frameW || !frameH) return true;
    const zone = calib.gridZone;
    if (!zone || !zone.w || !zone.h) return true;
    if (zone.w > frameW * 0.85) return true; // zona invade el panel de venta / todo el ancho
    if (calib.cellW && calib.cellW > frameW * 0.16) return true; // celdas demasiado anchas (pocas columnas)
    if (calib.cellH && calib.cellH > frameH * 0.28) return true; // filas demasiado altas
    return false;
}

/**
 * ¿Puede este rect ser de verdad la fila de recompensas?
 *
 * La referencia es la geometría fija con la que se calibró el recorte cuando no hay detección
 * (prepareRewardOCRCanvas): las cards ocupan el 84 % del ancho, el 25,5 % del alto empezando al
 * 18,5 %, o sea una franja de proporción ~6:1 centrada al 31 % de altura. Cada corte de abajo
 * deja margen de sobra frente a eso y descarta lo que se enganchaba en vivo sobre frames de
 * 2560x1440: el chat (804x437), el panel de progreso (881x749), la pantalla de carga
 * (1394x693), la mancha de esquina de 319x166 que dejaba un recorte de 210x124 donde no hay
 * nada que leer, y la banda de y=667 alto 773 con la que el escáner leía los nombres de la
 * escuadra en vez de las recompensas.
 *
 * Rechazar solo cuesta volver al recorte fijo, que es el calibrado: un falso rechazo degrada al
 * comportamiento de siempre, nunca a algo peor. Por eso los cortes son severos — la detección
 * solo debe pisar al recorte calibrado cuando de verdad ha visto una fila de cards.
 */
export function isImplausibleRewardBand(rect, frameW, frameH) {
    if (!rect || !frameW || !frameH) return true;
    const { w, h, y = 0 } = rect;
    if (!w || !h) return true;
    if (w < frameW * 0.25) return true;  // la fila de cards nunca cabe en un cuarto del ancho
    if (h > frameH * 0.35) return true;  // eso no es una franja de nombres, es medio HUD
    if (w / h < 2.5) return true;        // una fila de nombres es mucho más ancha que alta
    // La fila vive en la mitad de ARRIBA: su centro está al 31 % en la geometría de referencia.
    // Lo de abajo son los nombres de escuadra, el bonus de Steel Path y el kill feed, que juntos
    // tienen MÁS masa de texto que los nombres de ítem — que es justo con lo que se queda
    // pickBest, así que sin este corte gana el HUD inferior.
    if ((y + h / 2) > frameH * 0.70) return true;
    return false;
}

/**
 * detectRewardBand con la guarda puesta: devuelve null en vez de un recorte imposible, y se
 * queda solo con el ALTO de la banda.
 *
 * La guarda va aquí y no dentro de detectRewardBand porque su REWARD_DEFAULTS admite
 * `minCards: 1` a propósito —una recompensa suelta es legítima— y es ese 1 el que deja pasar
 * cualquier mancha de texto del frame. La detección se queda con su criterio; la plausibilidad
 * se decide fuera.
 *
 * Lo del ancho es lo que hacía que con 4 recompensas en pantalla se leyera UNA. El rect que
 * devuelve la detección es la caja que envuelve los nombres QUE ENCONTRÓ, así que si la señal
 * de bordes solo engancha uno —lo normal cuando un nombre queda sobre arte claro— el recorte
 * se cierra sobre esa card y las otras tres se quedan fuera de la imagen que llega al OCR. No
 * hay parseo posterior que las recupere: no están.
 *
 * El alto sí es fiable, y además es lo único que justifica la detección: existe porque con una
 * webcam apuntando a un monitor el juego no llena el encuadre y el 18,5 %-44 % fijo cae sobre
 * fondo vacío. Horizontalmente el camino fijo ya usaba el ancho completo. Sobra encuadre a los
 * lados, sí, pero es fondo que el matcher descarta —resuelve contra el catálogo— y no cuesta
 * resolución: el canvas se escala por un factor fijo, así que las letras miden lo mismo.
 */
export function detectPlausibleRewardBand(img, opts = {}) {
    const rect = detectRewardBand(img, opts);
    // La guarda juzga la detección REAL, antes de ensanchar: si no, el ancho completo aprobaría
    // siempre el corte de "más de un cuarto del frame".
    if (isImplausibleRewardBand(rect, img?.width, img?.height)) return null;
    return { ...rect, x: 0, w: img.width };
}
