/**
 * Congela un frame de vídeo en un canvas reutilizable.
 *
 * Existe porque el pipeline de recompensas leía del `<video>` EN VIVO en cada etapa, y entre la
 * primera y la última pasan segundos (3 presets × 2 pasadas de Tesseract): la banda se detectaba
 * en un frame, cada OCR leía otro, y la foto que se enseñaba era la de después de todo — con la
 * pantalla ya movida. Congelando uno, todas las etapas miran la MISMA imagen.
 *
 * El canvas se reutiliza entre llamadas: crear uno por frame deja backing stores que el
 * navegador libera mucho más despacio que el heap normal (mismo motivo que documenta el
 * escáner de inventario).
 *
 * @param source  <video>, canvas o cualquier CanvasImageSource
 * @param prev    canvas de una llamada anterior, o null la primera vez
 * @returns el canvas con el frame, listo para pasar a las etapas siguientes
 */
/**
 * Suelta el canvas: 0×0 libera el backing store, que en 2560×1440 son ~15 MB. Se llama al salir
 * de la pantalla que lo usaba, para no arrastrarlo el resto de la sesión.
 */
export function releaseFrame(cvs) {
  if (!cvs) return null;
  cvs.width = 0;
  cvs.height = 0;
  return null;
}

export function freezeFrame(source, width, height, prev = null) {
  const cvs = prev || document.createElement("canvas");
  // Reasignar width/height limpia el canvas, así que solo se toca cuando cambia de verdad:
  // el stream puede llegar reescalado a mitad de sesión (ver notas del escáner en vivo).
  if (cvs.width !== width || cvs.height !== height) {
    cvs.width = width;
    cvs.height = height;
  }
  cvs.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, width, height);
  return cvs;
}
