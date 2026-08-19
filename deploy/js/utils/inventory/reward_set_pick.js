/**
 * Cuál de las recompensas en pantalla te deja más cerca de cerrar un set.
 *
 * El modal ya marcaba la que más platino vale y la de mejor ratio de ducados, que responden a
 * "qué vendo". Falta la tercera pregunta, que es la que suele decidir el clic: cuál me CIERRA
 * algo. Una pieza de 5 platino que completa un set vale más que una de 40 de un set que no has
 * empezado.
 *
 * Puro: todo entra por `deps`.
 */

/**
 * Cuánto ayuda una pieza, o null si no ayuda nada (ya la tienes, o no es de ningún set).
 *
 * `left` son las piezas que le quedarían al set DESPUÉS de coger esta. 0 = lo cierra.
 */
export function setHelpOf(part, deps) {
  const { setsDatabase = {}, primeInventory = {}, getSetName, getRequiredCount = () => 1 } = deps;
  const setName = getSetName?.(part);
  if (!setName || setName === "Otros") return null;
  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const falta = (p, extra = 0) =>
    ((primeInventory[p] || 0) + extra) < (getRequiredCount(setName, p) || 1);

  // Si esta pieza ya está cubierta, cogerla no acerca el set: no es "la que te cierra algo".
  if (!falta(part)) return null;

  const left = parts.filter((p) => falta(p, p === part ? 1 : 0)).length;
  return { set: setName, left, total: parts.length };
}

/**
 * El nombre de la recompensa que más acerca un set, o null si ninguna aporta.
 *
 * Gana la que menos deje pendiente; a igualdad, la del set MÁS PEQUEÑO, porque es el que antes
 * se cierra de verdad. Sin ese desempate, un warframe de 5 piezas al que le faltan 2 empataba
 * con un arma de 2 a la que le falta 1 sola, y se elegía por orden de lectura.
 */
export function pickBestForSets(items, deps) {
  let mejor = null;
  for (const item of items || []) {
    const ayuda = setHelpOf(item?.name, deps);
    if (!ayuda) continue;
    const cand = { name: item.name, ...ayuda };
    if (!mejor
        || cand.left < mejor.left
        || (cand.left === mejor.left && cand.total < mejor.total)) {
      mejor = cand;
    }
  }
  return mejor;
}
