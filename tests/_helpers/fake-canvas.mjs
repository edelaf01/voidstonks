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

  // like the real canvas, resizing resets the content; the scanner relies on it
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

  get data() { return this._data; }

  toDataURL() { return "data:image/png;base64,"; }

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

          // destination texel center projected onto source: without the half pixel the image shifts
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

    clearRect() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    strokeText() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc() {}, arcTo() {}, ellipse() {}, rect() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
}

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
    _registrar(id, el) { elementos.set(id, el); return el; },
  };

  globalThis.document = doc;
  if (!globalThis.Image) {
    globalThis.Image = class { set src(v) { this._src = v; } get src() { return this._src; } };
  }
  return doc;
}

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

export const canvasLiso = (w, h, rgb) => fakeCanvas(w, h, () => rgb);
