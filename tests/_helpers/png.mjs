import zlib from "node:zlib";

// ===========================================================================
// Decodificador/codificador PNG mínimo para fixtures de test (sin dependencias).
// Soporta 8-bit sin entrelazado en colorType 2 (RGB), 6 (RGBA) y 3 (indexado/
// paleta, con PLTE y tRNS opcional — p.ej. capturas guardadas como PNG-8).
// Devuelve/consume { width, height, data } con data RGBA (layout de ImageData).
// ===========================================================================

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(buf) {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error("No es un PNG");
  }
  let width = 0, height = 0, colorType = 0;
  let palette = null;   // Uint8Array RGB (colorType 3)
  let transAlpha = null; // Uint8Array alfa por entrada de paleta (tRNS)
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6 && colorType !== 3) || data[12] !== 0) {
        throw new Error(`PNG no soportado (depth=${depth} colorType=${colorType} interlace=${data[12]})`);
      }
    } else if (type === "PLTE") {
      palette = Uint8Array.from(data);
    } else if (type === "tRNS") {
      transAlpha = Uint8Array.from(data);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (colorType === 3 && !palette) throw new Error("PNG indexado sin PLTE");
  // bytes por muestra usados por el filtrado (índice=1, RGB=3, RGBA=4)
  const bpp = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    // Des-filtrado in-place sobre `raw` (los filtros 2-4 leen la fila anterior ya des-filtrada)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;      // izquierda
      const b = prev ? prev[x] : 0;                 // arriba
      const c = x >= bpp && prev ? prev[x - bpp] : 0; // diagonal
      let v = line[x];
      switch (filter) {
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
          v = (v + pred) & 0xff;
          break;
        }
      }
      line[x] = v;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = line[x];
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = transAlpha && idx < transAlpha.length ? transAlpha[idx] : 255;
      } else {
        out[o] = line[x * bpp];
        out[o + 1] = line[x * bpp + 1];
        out[o + 2] = line[x * bpp + 2];
        out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
      }
    }
  }
  return { width, height, data: out };
}

export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = data[y * stride + x];
    }
  }
  const chunk = (type, payload) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from(SIG),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
