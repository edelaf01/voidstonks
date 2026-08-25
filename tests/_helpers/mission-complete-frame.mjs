/**
 * Frame sintético de la pantalla MISSION COMPLETE, para probar el acotado sin capturas.
 *
 * Solo dibuja lo que la detección mira: el título (de donde sale el color del tema) y los
 * ✓ de las casillas ocupadas. El arte de los iconos no hace falta — la máscara del color
 * del tema lo descarta igual.
 */

function px(data, width, x, y, [r, g, b]) {
  const i = (y * width + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
}

function fillRect(data, width, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) px(data, width, x, y, color);
  }
}

/** Anillo cuadrado: el ✓ del juego tiene el centro hueco, y eso lo separa de una letra. */
function ring(data, width, x0, y0, side, color) {
  // Grosor ~11% del lado: deja el relleno en ~0.36, dentro del rango que exige el detector.
  const t = Math.max(1, Math.round(side * 0.113));
  fillRect(data, width, x0, y0, side, t, color);
  fillRect(data, width, x0, y0 + side - t, side, t, color);
  fillRect(data, width, x0, y0, t, side, color);
  fillRect(data, width, x0 + side - t, y0, t, side, color);
}

/**
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.gridX      x de la primera columna de casillas
 * @param {number} o.gridY      y de la primera fila
 * @param {number} o.pitch      lado de la casilla (las celdas son cuadradas)
 * @param {Array<[number,number]>} o.cells  [fila, columna] de cada casilla OCUPADA
 * @param {[number,number,number]} [o.accent=[240,126,4]]  color del tema
 * @param {Array<[number,number]>} [o.phantoms=[]]  cuadrados del color del tema FUERA de la
 *        retícula (la lupa de SEARCH, las letras de IMPORTANCE, el ✓ de un tooltip)
 * @param {Array<[number,number]>} [o.labels=[]]  [fila, columna] de las casillas que llevan
 *        ROTULO: una barra del color del tema en su franja inferior, donde el juego imprime
 *        el nombre. Las que no aparezcan quedan sin rótulo, como las cartas de mod.
 * @param {[number,number,number]} [o.bg=[20,25,32]]
 */
export function makeMissionCompleteFrame(o) {
  const { width, height, gridX, gridY, pitch, cells, phantoms = [], labels = [] } = o;
  const accent = o.accent || [240, 126, 4];
  const bg = o.bg || [20, 25, 32];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }

  // Título centrado: trazos sueltos, suficientes para promediar el color del tema.
  const ty = Math.round(height * 0.045);
  const th = Math.max(2, Math.round(height * 0.02));
  for (let k = 0; k < 12; k++) {
    fillRect(data, width, Math.round(width * 0.36) + k * Math.round(width * 0.02), ty, Math.max(2, Math.round(width * 0.008)), th, accent);
  }

  const side = Math.max(3, Math.round(height * 0.0208));
  const inset = Math.round(side * 0.4);
  for (const [row, col] of cells) {
    ring(data, width, gridX + col * pitch + inset, gridY + row * pitch + inset, side, accent);
  }
  for (const [x, y] of phantoms) ring(data, width, x, y, side, accent);

  // Rótulo: una barra centrada en la franja inferior. No imita letras porque el clasificador
  // solo mide CUÁNTA tinta del tema hay ahí, no qué forma tiene.
  for (const [row, col] of labels) {
    const bw = Math.round(pitch * 0.5), bh = Math.max(1, Math.round(pitch * 0.05));
    fillRect(data, width,
      gridX + col * pitch + Math.round((pitch - bw) / 2),
      gridY + row * pitch + Math.round(pitch * 0.8),
      bw, bh, accent);
  }

  return { data, width, height };
}
