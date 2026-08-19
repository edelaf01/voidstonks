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
        // bottom-anchored like the game: the last line shares the baseline and the first grows up
        const y0Last = Math.round(cellY + cellH * 0.80);
        drawStripe(x0, x0 + w, y0Last, y0Last + lh - 1);
        const y0First = y0Last - lh - 3;
        drawStripe(x0, x0 + w, y0First, y0First + lh - 1);
      } else {
        const y0 = Math.round(cellY + cellH * 0.80);
        drawStripe(x0, x0 + w, y0, y0 + lh - 1);
      }

      if (badges) {
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
