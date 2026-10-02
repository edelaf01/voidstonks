const RE_GRUPO = /^[a-z]{1,16}$/;
const MAX_PANELES = 8;
const MAX_BLOQUES = 30;
const MAX_FILAS = 40;

export function peticionValida(p) {
  if (!p || typeof p !== "object" || !RE_GRUPO.test(p.grupo ?? "") || !Array.isArray(p.paneles) || p.paneles.length > MAX_PANELES) return false;
  for (const panel of p.paneles) {
    if (!panel || typeof panel !== "object") return false;
    const bloques = Array.isArray(panel.bloques) ? panel.bloques : [];
    const filas = bloques.reduce((n, b) => n + (Array.isArray(b?.filas) ? b.filas.length : 0), 0);
    if (bloques.length > MAX_BLOQUES || filas > MAX_FILAS) return false;
  }
  return true;
}

export function firmaDe(p) {
  return JSON.stringify([p.paneles, !!p.mismoAncho]);
}

export function rectEnDip(rect, factor) {
  const f = factor > 0 ? factor : 1;
  return {
    x: Math.round(rect.x / f),
    y: Math.round(rect.y / f),
    width: Math.round(rect.width / f),
    height: Math.round(rect.height / f),
  };
}
