// Un <canvas> y un `document` de mentira, con lo justo para correr el código de visión en Node.
//
// El repo no lleva dependencias externas ni en los tests, así que nada de jsdom ni node-canvas:
// aquí solo hacen falta píxeles en memoria. `vision.service.js` crea sus canvases AL IMPORTARSE,
// así que `installFakeDocument()` tiene que ejecutarse antes del import dinámico del módulo.
//
// `drawImage` interpola (bilineal) cuando reescala y `imageSmoothingEnabled` está puesto, igual
// que el navegador. No es un lujo: media pipeline de visión depende de ese suavizado —el badge
// de cantidad se amplía y se re-binariza para redondear los trazos, y varios tests miden
// justamente qué se rompe al reescalar un frame. Con vecino más cercano esos tests pasan por el
// motivo equivocado.

/** ImageData mínimo: `data`, `width`, `height`. */
function crearImageData(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}

export class FakeCanvas {
  constructor(width = 300, height = 150) {
    this._w = width;
    this._h = height;
    this._data = new Uint8ClampedArray(width * height * 4);
    this._ctx = crearContexto(this);
  }

  // Igual que el canvas real: cambiar el tamaño REINICIA el contenido. Varios sitios del
  // escáner dependen de eso para no arrastrar píxeles del frame anterior.
  get width() { return this._w; }
  set width(v) {
    this._w = Math.max(0, Math.round(v) || 0);
    this._data = new Uint8ClampedArray(this._w * this._h * 4);
  }

  get height() { return this._h; }
  set height(v) {
    this._h = Math.max(0, Math.round(v) || 0);
    this._data = new Uint8ClampedArray(this._w * this._h * 4);
  }

  getContext() { return this._ctx; }

  // Un canvas real no tiene `data`, pero varias funciones de visión aceptan indistintamente un
  // canvas o un ImageData ({width, height, data}). Exponerlo permite pasarles el mismo objeto.
  get data() { return this._data; }

  toDataURL() { return "data:image/png;base64,"; }

  /** Color de un píxel, para comprobar resultados. */
  px(x, y) {
    const i = (y * this._w + x) * 4;
    return [this._data[i], this._data[i + 1], this._data[i + 2], this._data[i + 3]];
  }
}

function crearContexto(canvas) {
  return {
    canvas,
    filter: "none",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    globalAlpha: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",

    createImageData: (w, h) => crearImageData(w, h),

    getImageData(x = 0, y = 0, w = canvas.width, h = canvas.height) {
      const out = new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const sx = x + i, sy = y + j;
          const dst = (j * w + i) * 4;
          if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
          const src = (sy * canvas.width + sx) * 4;
          out[dst] = canvas._data[src];
          out[dst + 1] = canvas._data[src + 1];
          out[dst + 2] = canvas._data[src + 2];
          out[dst + 3] = canvas._data[src + 3];
        }
      }
      return crearImageData(w, h, out);
    },

    putImageData(img, dx = 0, dy = 0) {
      for (let j = 0; j < img.height; j++) {
        for (let i = 0; i < img.width; i++) {
          const tx = dx + i, ty = dy + j;
          if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
          const src = (j * img.width + i) * 4;
          const dst = (ty * canvas.width + tx) * 4;
          canvas._data[dst] = img.data[src];
          canvas._data[dst + 1] = img.data[src + 1];
          canvas._data[dst + 2] = img.data[src + 2];
          canvas._data[dst + 3] = img.data[src + 3];
        }
      }
    },

    /**
     * Acepta las tres formas del canvas real: (img, dx, dy), (img, dx, dy, dw, dh) y
     * (img, sx, sy, sw, sh, dx, dy, dw, dh). La fuente puede ser otro FakeCanvas o el objeto
     * `{width, height, data}` que devuelve decodePng.
     */
    drawImage(source, ...args) {
      const src = source?._data
        ? { data: source._data, width: source.width, height: source.height }
        : { data: source.data, width: source.width, height: source.height };
      if (!src.data) return;

      let sx = 0, sy = 0, sw = src.width, sh = src.height;
      let dx = 0, dy = 0, dw, dh;
      if (args.length >= 8) {
        [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      } else if (args.length >= 4) {
        [dx, dy, dw, dh] = args;
      } else {
        [dx = 0, dy = 0] = args;
      }
      if (dw === undefined) dw = sw;
      if (dh === undefined) dh = sh;
      if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;

      const escala = dw !== sw || dh !== sh;
      const suaviza = escala && this.imageSmoothingEnabled !== false;

      const leer = (x, y, c) => {
        const cx = Math.min(src.width - 1, Math.max(0, x));
        const cy = Math.min(src.height - 1, Math.max(0, y));
        return src.data[(cy * src.width + cx) * 4 + c];
      };

      for (let j = 0; j < dh; j++) {
        const ty = Math.round(dy) + j;
        if (ty < 0 || ty >= canvas.height) continue;
        for (let i = 0; i < dw; i++) {
          const tx = Math.round(dx) + i;
          if (tx < 0 || tx >= canvas.width) continue;
          const d = (ty * canvas.width + tx) * 4;

          if (!suaviza) {
            const sxx = sx + Math.floor((i * sw) / dw);
            const syy = sy + Math.floor((j * sh) / dh);
            if (sxx < 0 || syy < 0 || sxx >= src.width || syy >= src.height) continue;
            const s = (syy * src.width + sxx) * 4;
            canvas._data[d] = src.data[s];
            canvas._data[d + 1] = src.data[s + 1];
            canvas._data[d + 2] = src.data[s + 2];
            canvas._data[d + 3] = src.data[s + 3];
            continue;
          }

          // Centro del texel de destino proyectado sobre la fuente: sin el medio píxel, la
          // imagen se desplaza al ampliar y la rejilla detectada sale corrida.
          const fx = sx + ((i + 0.5) * sw) / dw - 0.5;
          const fy = sy + ((j + 0.5) * sh) / dh - 0.5;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const wx = fx - x0, wy = fy - y0;

          for (let c = 0; c < 4; c++) {
            const arriba = leer(x0, y0, c) * (1 - wx) + leer(x0 + 1, y0, c) * wx;
            const abajo = leer(x0, y0 + 1, c) * (1 - wx) + leer(x0 + 1, y0 + 1, c) * wx;
            canvas._data[d + c] = Math.round(arriba * (1 - wy) + abajo * wy);
          }
        }
      }
    },

    // El código de visión las llama por costumbre; aquí no pintan nada porque nada de lo que se
    // comprueba depende de ellas.
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    strokeText() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    // `arc` faltaba y el fondo animado (canvas.js) lo usa para la cabeza y la cola del trazo.
    // Solo se llega a esas ramas si la partícula tiene camino recorrido, que depende de
    // Math.random(): canvas.test.mjs fallaba con "ctx.arc is not a function" en ~1 de cada 5
    // ejecuciones, y culpaba al tema que tocase en esa vuelta del bucle.
    arc() {}, arcTo() {}, ellipse() {}, rect() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    // El fondo animado tiñe cada trazo con un degradado cola->cabeza; sin esto, canvas.test.mjs
    // muere con "ctx.createLinearGradient is not a function" en cuanto una partícula avanza.
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

/**
 * Instala un `document` mínimo en globalThis. Devuelve el objeto por si el test quiere
 * inspeccionarlo. Llamar ANTES de importar módulos que crean canvases al cargarse.
 */
export function installFakeDocument() {
  const elementos = new Map();
  const crear = (tag) => {
    if (tag === "canvas") return new FakeCanvas();
    return {
      tagName: String(tag).toUpperCase(),
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      children: [],
      appendChild(n) { this.children.push(n); return n; },
      removeChild() {},
      remove() {},
      setAttribute() {},
      getAttribute: () => null,
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      replaceChildren() {},
      insertAdjacentHTML() {},
    };
  };

  const doc = {
    createElement: crear,
    createElementNS: (_ns, tag) => crear(tag),
    getElementById: (id) => elementos.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    head: crear("head"),
    body: crear("body"),
    documentElement: crear("html"),
    /** Para los tests que necesiten que un id exista. */
    _registrar(id, el) { elementos.set(id, el); return el; },
  };

  globalThis.document = doc;
  if (!globalThis.Image) {
    globalThis.Image = class { set src(v) { this._src = v; } get src() { return this._src; } };
  }
  return doc;
}

/**
 * Canvas ya relleno, para las pruebas de píxeles puras.
 * @param pixeles función (x, y) -> [r, g, b] o [r, g, b, a]
 */
export function fakeCanvas(width, height, pixeles = () => [0, 0, 0, 255]) {
  const c = new FakeCanvas(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixeles(x, y);
      const i = (y * width + x) * 4;
      c._data[i] = r; c._data[i + 1] = g; c._data[i + 2] = b; c._data[i + 3] = a;
    }
  }
  return c;
}

/** Relleno uniforme. */
export const canvasLiso = (w, h, rgb) => fakeCanvas(w, h, () => rgb);
