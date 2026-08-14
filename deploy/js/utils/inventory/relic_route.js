/**
 * Ruta de farmeo para cerrar un set que tienes a medias.
 *
 * Responde la pregunta entera, no un trozo: para terminar Gara Prime te faltan estas
 * piezas, salen de estas reliquias, de esas tienes N en el inventario y las que no tienes
 * se farmean aquí — y de todo eso, esto es lo que puedes correr AHORA porque hay fisura
 * de su era abierta.
 *
 * Es puro: todo entra por `deps` para poder probarlo sin navegador ni datos vivos.
 */

/**
 * Progreso hacia el SIGUIENTE set completo.
 *
 * `built` son los sets enteros que ya te salen (el mínimo de copias entre todas las
 * piezas). Lo que falta se mide contra el siguiente: si ya tienes uno montado y te sobran
 * piezas de tres de las cuatro partes, lo que falta es la cuarta — y esa es la
 * recomendación útil, no "ya lo tienes, no hagas nada".
 */
function setProgress(setName, parts, primeInventory, getRequiredCount) {
  let built = Infinity;
  for (const p of parts) {
    const req = getRequiredCount(setName, p) || 1;
    built = Math.min(built, Math.floor((primeInventory[p] || 0) / req));
  }
  if (!Number.isFinite(built)) built = 0;
  const target = built + 1;
  const missingParts = parts.filter(
    (p) => (primeInventory[p] || 0) < (getRequiredCount(setName, p) || 1) * target,
  );
  return { built, missingParts };
}

/** Las eras se normalizan porque el worldstate llama "Vanguard" a lo que el juego llama Axi. */
export function normalizeTier(tier) {
  return tier === "Vanguard" ? "Axi" : tier;
}

/**
 * @param setName          set a cerrar
 * @param deps.setsDatabase        { [set]: [piezas] }
 * @param deps.primeInventory      { [pieza]: cantidad }
 * @param deps.itemsDatabase       { [pieza]: [{ relic, tier, rarity, chance }] }
 * @param deps.relicCounts         { [nombre de reliquia sin " Relic"]: copias que tienes }
 * @param deps.relicSources        { [nombre de reliquia sin " Relic"]: [{ location, mission, rotation, chance }] }
 * @param deps.fissures            [{ node, type, tier, eta, isSP }] activas ahora
 * @param deps.getRequiredCount    (set, pieza) => cuántas hacen falta
 * @returns null si no falta nada para el siguiente set, o si el set no existe.
 */
export function buildSetRoute(setName, deps) {
  const {
    setsDatabase = {}, primeInventory = {}, itemsDatabase = {},
    relicCounts = {}, relicSources = {}, fissures = [],
    getRequiredCount = () => 1,
  } = deps;

  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  // Cuántos sets ENTEROS te salen ya con lo que tienes. Sin esto, un set completo salía de
  // la lista aunque tuvieras 3 cañones y 2 receptores sueltos: estás a una pieza del
  // segundo set y eso es justo lo que hay que farmear.
  const { built, missingParts } = setProgress(setName, parts, primeInventory, getRequiredCount);
  if (missingParts.length === 0) return null;

  // Fisuras vivas agrupadas por era: es lo que decide qué de la ruta se puede hacer ya.
  const fissuresByTier = new Map();
  for (const f of fissures) {
    const tier = normalizeTier(f.tier);
    if (!fissuresByTier.has(tier)) fissuresByTier.set(tier, []);
    fissuresByTier.get(tier).push(f);
  }

  const bare = (relic) => String(relic).replace(/\s+Relic$/, "").trim();

  const missing = missingParts.map((part) => {
    const relics = (itemsDatabase[part] || []).map((src) => {
      const key = bare(src.relic);
      const tier = normalizeTier(src.tier);
      return {
        relic: key,
        tier,
        rarity: src.rarity,
        chance: src.chance,
        owned: relicCounts[key] || 0,
        // Solo hace falta saber DÓNDE farmearla si no la tienes ya.
        sources: (relicCounts[key] || 0) > 0 ? [] : (relicSources[key] || []),
        fissures: fissuresByTier.get(tier) || [],
      };
    });
    // Primero lo que puedes abrir ya (la tienes Y hay fisura), luego lo que tienes, luego
    // por probabilidad: es el orden en que uno decide qué hacer.
    relics.sort((a, b) =>
      (b.owned > 0 && b.fissures.length > 0) - (a.owned > 0 && a.fissures.length > 0)
      || (b.owned - a.owned)
      || (b.chance - a.chance));
    return { part, relics, ready: relics.some((r) => r.owned > 0 && r.fissures.length > 0) };
  });

  return {
    setName,
    totalParts: parts.length,
    // Sets completos que ya te salen; la ruta apunta al siguiente (built + 1).
    built,
    missingCount: missingParts.length,
    // Piezas que puedes ir a por ellas ahora mismo sin farmear reliquias antes.
    readyCount: missing.filter((m) => m.ready).length,
    missing,
  };
}

/**
 * Rutas de todos los sets EMPEZADOS y sin terminar, mejor primero.
 *
 * "A medias" incluye el set del que ya tienes uno montado pero te sobran piezas: estás a
 * medias del SIGUIENTE. Los que no has tocado quedan fuera a propósito — con el inventario
 * casi vacío, "todos los sets del juego" no es una recomendación, es un listado.
 */
export function buildFarmRoutes(deps, limit = 8) {
  const { setsDatabase = {}, primeInventory = {}, getRequiredCount = () => 1 } = deps;
  const routes = [];
  for (const setName of Object.keys(setsDatabase)) {
    const parts = setsDatabase[setName];
    if (!Array.isArray(parts) || parts.length === 0) continue;
    const { missingParts } = setProgress(setName, parts, primeInventory, getRequiredCount);
    // Sin empezar (no tienes NADA que valga para el siguiente set) no es recomendación,
    // es el catálogo del juego. Ya cerrado del todo tampoco: no falta nada.
    if (missingParts.length === 0 || missingParts.length === parts.length) continue;
    const route = buildSetRoute(setName, deps);
    if (route) routes.push(route);
  }
  // Lo que más cerca está de cerrarse y, a igualdad, lo que más se puede avanzar hoy.
  routes.sort((a, b) => (a.missingCount - b.missingCount) || (b.readyCount - a.readyCount));
  return routes.slice(0, limit);
}
