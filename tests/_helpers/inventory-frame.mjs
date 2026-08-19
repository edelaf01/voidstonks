/**
 * Generador de frames sintéticos del inventario de Warframe.
 * Exportable para reutilizar en múltiples archivos de test.
 */

/** PRNG determinista (mulberry32) para que el "noise" de fondo sea reproducible. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function setPixel(data, width, height, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = 255;
}

/**
 * Genera un frame sintético del inventario.
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.gridX
 * @param {number} opts.gridY
 * @param {number} opts.cellW
 * @param {number} opts.cellH
 * @param {number} opts.cols
 * @param {number} [opts.rows=3]
 * @param {number[]|"all"} [opts.filled="all"] índices de celda (row*cols+col) ocupadas
 * @param {number[]} [opts.twoLineNames=[]] índices con nombre a 2 líneas
 * @param {boolean} [opts.badges=false] pinta badge de cantidad top-left
 * @param {number} [opts.noise=0] 0..1 ruido de fondo tenue (brillo <120)
 * @param {boolean} [opts.bgGradient=false] gradiente de fondo tenue (brillo <120)
 * @param {number} [opts.seed=1] semilla del PRNG de ruido
 * @param {[number,number,number]} [opts.bgColor] color base del fondo (por defecto oscuro [30,25,35]);
 *        úsalo p.ej. con un tema de fondo CLARO (magenta) para probar la invariancia al tema.
 * @param {[number,number,number]} [opts.textColor=[240,235,220]] color del texto de los nombres
 *        (blanco/crema por defecto; p.ej. teal oscuro del tema "Tenno" para probar texto oscuro-sobre-claro).
 * @param {boolean} [opts.clampBgDark=true] recorta el fondo a <120 de brillo (solo tiene sentido con el fondo oscuro por defecto).
 * @param {[number,number,number]} [opts.art] si se da, pinta en cada celda un "arte" METÁLICO rayado de ALTO
 *        contraste en la zona de ilustración (0.10–0.55·cellH) con ese color. Simula el render 3D del ítem, que
 *        tiene MÁS densidad de bordes que el texto → estresa el anclaje de fila (edge-based) para que se ancle
 *        al arte en vez del nombre. Combínalo con textColor de bajo contraste (cerca del fondo) para el peor caso.
 */
export function makeInventoryFrame(opts) {
  const {
    width,
    height,
    gridX = 0,
    gridY = 0,
    cellW,
    cellH,
    cols,
    rows = 3,
    filled = "all",
    twoLineNames = [],
    badges = false,
    noise = 0,
    bgGradient = false,
    seed = 1,
    bgColor = null,
    textColor = [240, 235, 220],
    clampBgDark = bgColor === null,
    art = null,
  } = opts;

  const data = new Uint8ClampedArray(width * height * 4);
  const rand = mulberry32(seed);
  const [bgR, bgG, bgB] = bgColor || [30, 25, 35];
  const [txR, txG, txB] = textColor;
  const [artR, artG, artB] = art || [0, 0, 0];

  // Fondo (oscuro por defecto, o el color de tema dado) con arte/gradientes/ruido tenue.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = bgR, g = bgG, b = bgB;
      if (bgGradient) {
        const d = Math.round(15 * Math.sin(x / 137) + 10 * Math.cos(y / 97));
        r += d; g += d; b += d;
      }
      if (noise > 0) {
        const n = Math.round(rand() * 80 * noise);
        r += n; g += n; b += n;
      }
      const hi = clampBgDark ? 119 : 255;
      setPixel(
        data, width, height, x, y,
        Math.max(0, Math.min(hi, r)),
        Math.max(0, Math.min(hi, g)),
        Math.max(0, Math.min(hi, b)),
      );
    }
  }

  const filledSet = filled === "all"
    ? new Set(Array.from({ length: rows * cols }, (_, i) => i))
    : new Set(filled);
  const twoLineSet = new Set(twoLineNames);

  // Patrón de "letras": 3px pintados / 2px sin pintar, imita texto real
  // (no un bloque sólido) sin dejar de ser un bloque continuo para blocksInBand.
  function drawStripe(x0, x1, y0, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - x0) % 5 < 3) setPixel(data, width, height, x, y, txR, txG, txB);
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!filledSet.has(idx)) continue;
      const cellX = gridX + c * cellW;
      const cellY = gridY + r * cellH;
      const w = Math.round(cellW * 0.6);
      const x0 = Math.round(cellX + (cellW - w) / 2);
      const lh = Math.round(cellH * 0.12);

      // Arte metálico rayado de ALTO contraste en la zona de ilustración
      // (0.10–0.55·cellH): más ancho y con más bordes que el nombre, para que un
      // anclaje por densidad de bordes se enganche AQUÍ en vez de en el nombre.
      if (art) {
        const aw = Math.round(cellW * 0.7);
        const ax0 = Math.round(cellX + (cellW - aw) / 2);
        const ay0 = Math.round(cellY + cellH * 0.10);
        const ay1 = Math.round(cellY + cellH * 0.55);
        for (let y = ay0; y <= ay1; y++) {
          for (let x = ax0; x <= ax0 + aw; x++) {
            if ((x - ax0) % 4 < 2) setPixel(data, width, height, x, y, artR, artG, artB);
          }
        }
      }

      if (twoLineSet.has(idx)) {
        // Dos renglones de 0.12*cellH separados por un gap de 3px
        // (< mergeGapY=12 del módulo => deben fundirse en una sola banda).
        // BOTTOM-ANCHORED como el juego real: la ÚLTIMA línea comparte baseline
        // con los nombres de 1 línea y la primera crece hacia ARRIBA (verificado
        // en capturas reales: la base y1 de la banda queda equidistante entre
        // filas, el top y0 salta ~una línea). Antes crecía hacia abajo (irreal).
        const y0Last = Math.round(cellY + cellH * 0.80);
        drawStripe(x0, x0 + w, y0Last, y0Last + lh - 1);
        const y0First = y0Last - lh - 3;
        drawStripe(x0, x0 + w, y0First, y0First + lh - 1);
      } else {
        // Banda de nombre de una línea, anclada en su baseline (0.92 * cellH).
        const y0 = Math.round(cellY + cellH * 0.80);
        drawStripe(x0, x0 + w, y0, y0 + lh - 1);
      }

      if (badges) {
        // Badge de cantidad: pequeño bloque sólido top-left, ~10% del área del nombre.
        const bw = Math.round(cellW * 0.12);
        const bh = Math.round(cellH * 0.06);
        const bx0 = cellX + 2;
        const by0 = Math.round(cellY + cellH * 0.04);
        for (let y = by0; y < by0 + bh; y++) {
          for (let x = bx0; x < bx0 + bw; x++) {
            setPixel(data, width, height, x, y, txR, txG, txB);
          }
        }
      }
    }
  }

  return { data, width, height };
}
