const ESQUINA = { x0: -100, x1: -35, y0: -188, y1: -150 };
const ICONO = { x0: -45, x1: 45, y0: -150, y1: -50 };
const CONTRASTE_VACIA = 25, ICONO_APAGADO = 120, AREA_MINIMA = 6;

function lumas({ data }) {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return out;
}

function percentil(vals, p) {
  if (!vals.length) return 0;
  const s = Float32Array.from(vals).sort();
  return s[Math.round(p * (s.length - 1))];
}

function componentes(mask, w, h) {
  const visto = new Uint8Array(mask.length), out = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visto[i]) continue;
    const caja = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    const pila = [i];
    visto[i] = 1;
    while (pila.length) {
      const k = pila.pop(), x = k % w, y = (k - x) / w;
      caja.area++;
      caja.x0 = Math.min(caja.x0, x); caja.x1 = Math.max(caja.x1, x);
      caja.y0 = Math.min(caja.y0, y); caja.y1 = Math.max(caja.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && !visto[n]) { visto[n] = 1; pila.push(n); }
        }
      }
    }
    out.push(caja);
  }
  return out;
}

const hayAnidada = (cajas) => cajas.some((a) => cajas.some((b) =>
  b !== a && b.area >= AREA_MINIMA && a.x0 < b.x0 && a.x1 > b.x1 && a.y0 < b.y0 && a.y1 > b.y1));

function zona(lee, x, y, z) {
  const x0 = Math.round(x + z.x0), y0 = Math.round(y + z.y0);
  return lee(x0, y0, Math.round(x + z.x1) - x0, Math.round(y + z.y1) - y0);
}

export function esquinaDeCasilla(lee, { x, y }) {
  const esquina = zona(lee, x, y, ESQUINA);
  const icono = zona(lee, x, y, ICONO);
  if (!esquina || !icono) return null;
  const L = lumas(esquina);
  const med = percentil(L, 0.5);
  const dif = L.map((v) => Math.abs(v - med));
  const contraste = percentil(dif, 0.995);
  const encendido = percentil(lumas(icono), 0.99) >= ICONO_APAGADO;
  if (contraste < CONTRASTE_VACIA) return encendido ? "vacia" : null;
  const umbral = Math.max(contraste / 2, 15);
  const mask = Uint8Array.from(dif, (v) => (v > umbral ? 1 : 0));
  if (!hayAnidada(componentes(mask, esquina.width, esquina.height))) return null;
  return encendido ? null : "ojo";
}
