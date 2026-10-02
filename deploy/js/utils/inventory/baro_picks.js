// Cuántas copias de una pieza puedes llevar a Baro sin romper un set: se guardan las de los sets que
// ya puedes montar y, si no hay ninguno completo, las que pide el set que estás juntando.
export function copiasQueSobran(pieza, deps) {
  const { primeInventory = {}, setsDatabase = {}, getSetName, getRequiredCount = () => 1 } = deps;
  const tengo = primeInventory[pieza] || 0;
  const set = getSetName?.(pieza);
  const piezas = setsDatabase[set];
  if (!tengo || !Array.isArray(piezas) || !piezas.includes(pieza)) return { sobran: tengo, guardas: 0, completos: 0 };
  const pide = (p) => Math.max(1, getRequiredCount(set, p) || 1);
  const completos = Math.min(...piezas.map((p) => Math.floor((primeInventory[p] || 0) / pide(p))));
  const guardas = Math.min(tengo, Math.max(1, completos) * pide(pieza));
  return { sobran: tengo - guardas, guardas, completos };
}

// Las copias que sobran y rentan más en ducados que vendidas, de mejor a peor ducados por platino.
// `precioDe` devuelve null si el precio aún no se conoce: esas piezas se quedan fuera hasta tenerlo.
export function piezasParaBaro(deps) {
  const { primeInventory = {}, ducadosDe, precioDe, rentaFundir, respetaSets = true } = deps;
  const lista = [];
  for (const [name, qty] of Object.entries(primeInventory)) {
    const ducats = ducadosDe(name) || 0;
    if (!(qty > 0) || !ducats) continue;
    const sobran = respetaSets ? copiasQueSobran(name, deps).sobran : qty;
    const plat = precioDe(name);
    if (!sobran || plat === null || !rentaFundir(ducats, plat)) continue;
    lista.push({ name, qty: sobran, ducats, plat, ratio: plat > 0 ? ducats / plat : Infinity });
  }
  return lista.sort((a, b) => b.ratio - a.ratio || b.ducats - a.ducats);
}
