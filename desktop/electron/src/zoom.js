import fs from "node:fs";

const MIN = 0.6;
const MAX = 2;

export const zoomPorDefecto = (anchoPantalla) => (anchoPantalla >= 2400 ? 1.2 : anchoPantalla >= 1800 ? 1.1 : 1);

export function creaZoom(ruta, { porDefecto = 1 } = {}) {
  let actual = porDefecto;
  try {
    const z = Number(JSON.parse(fs.readFileSync(ruta, "utf8")).zoom);
    if (z >= MIN && z <= MAX) actual = z;
  } catch { }
  const fija = (z) => {
    actual = Math.round(Math.min(MAX, Math.max(MIN, z)) * 100) / 100;
    try { fs.writeFileSync(ruta, JSON.stringify({ zoom: actual }), { mode: 0o600 }); } catch { }
    return actual;
  };
  return {
    get: () => actual,
    sube: () => fija(actual + 0.1),
    baja: () => fija(actual - 0.1),
    reinicia: () => fija(porDefecto),
  };
}
