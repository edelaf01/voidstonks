/** Frame con un rótulo de letras pseudoaleatorias en la franja del título (a 640×360: x 60-288, y 13-31). */
export function conRotulo(semilla, { W = 640, H = 360 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const x0 = Math.floor(W * 0.0945), x1 = Math.floor(W * 0.45), y0 = Math.floor(H * 0.036), y1 = Math.floor(H * 0.086);
  let x = semilla * 2654435761 >>> 0;
  const tinta = new Map();
  for (let c = x0; c < x1; c++) { x = (x * 1103515245 + 12345) >>> 0; tinta.set(c, (c % 9) < 4 && ((x >>> 16) % 3) !== 0); }
  for (let y = 0; y < H; y++) for (let c = 0; c < W; c++) {
    const i = (y * W + c) * 4;
    const v = y >= y0 && y < y1 && tinta.get(c) && ((y + c * semilla) % 5) < 3 ? 230 : 30;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { videoWidth: W, videoHeight: H, width: W, height: H, data };
}
