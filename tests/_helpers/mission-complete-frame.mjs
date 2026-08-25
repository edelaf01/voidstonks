function px(data, width, x, y, [r, g, b]) {
  const i = (y * width + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
}

function fillRect(data, width, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) px(data, width, x, y, color);
  }
}

function ring(data, width, x0, y0, side, color) {
  // thickness ~11% of the side leaves the fill at ~0.36, inside the detector range
  const t = Math.max(1, Math.round(side * 0.113));
  fillRect(data, width, x0, y0, side, t, color);
  fillRect(data, width, x0, y0 + side - t, side, t, color);
  fillRect(data, width, x0, y0, t, side, color);
  fillRect(data, width, x0 + side - t, y0, t, side, color);
}

export function makeMissionCompleteFrame(o) {
  const { width, height, gridX, gridY, pitch, cells, phantoms = [], labels = [] } = o;
  const accent = o.accent || [240, 126, 4];
  const bg = o.bg || [20, 25, 32];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }

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

  for (const [row, col] of labels) {
    const bw = Math.round(pitch * 0.5), bh = Math.max(1, Math.round(pitch * 0.05));
    fillRect(data, width,
      gridX + col * pitch + Math.round((pitch - bw) / 2),
      gridY + row * pitch + Math.round(pitch * 0.8),
      bw, bh, accent);
  }

  return { data, width, height };
}
