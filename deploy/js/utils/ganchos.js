const oyentes = new Map();

export function avisa(tema, datos) {
  for (const fn of oyentes.get(tema) || []) {
    try {
      fn(datos);
    } catch (e) {
      console.warn(`gancho ${tema}:`, e);
    }
  }
}

export function escucha(tema, fn) {
  if (!oyentes.has(tema)) oyentes.set(tema, new Set());
  oyentes.get(tema).add(fn);
  return () => oyentes.get(tema).delete(fn);
}

export const pistasDelLog = {
  duerme: () => false,
  firma: () => null,
  tarjetas: () => null,
  armaRiven: () => null,
  reliquiaPorGastar: () => null,
};
