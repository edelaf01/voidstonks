import { DROP_RATES_BY_RARITY, rarityFromChance, normalizeRarity } from "./relic_drop_odds.utils.js";
import { rewardValue } from "./reward_value.js";
import { setHelpOf } from "./reward_set_pick.js";

/**
 * Qué puede salir de las reliquias que lleva la ESCUADRA en este run.
 *
 * No sirve `relicOpenEV`: ese modela N copias de la MISMA reliquia con el MISMO
 * refinamiento, y en una fisura real cada jugador trae la suya y refinada a su manera.
 * La pantalla de recompensas saca una tarjeta por reliquia y el grupo se queda con una,
 * así que lo que vale el run es la esperanza del MÁXIMO de N tiradas independientes y
 * distintas — con reliquias iguales esta función devuelve exactamente lo mismo que
 * relicOpenEV, y el test lo comprueba.
 *
 * Puro: todo entra por `deps`.
 */

// Sin paréntesis leído se asume intacta, que es como sale del inventario si nadie la
// refina. Equivocarse por aquí infravalora el run; hacerlo al revés promete premios.
const DEFAULT_REFINEMENT = "intact";

function dropProbability(drop, refinement) {
  const rarity = rarityFromChance(drop?.chance) ?? normalizeRarity(drop?.rarity);
  return (rarity && DROP_RATES_BY_RARITY[rarity]?.[refinement]) || 0;
}

/**
 * La distribución de valor de UNA reliquia: pares { value, p } ordenados de menor a mayor
 * y con masa total 1. Lo que la tabla no cubra entra como premio de valor 0 —una rareza
 * que no se reconoce no puede valorarse, y colgarla del premio más caro regalaría valor.
 */
function valueDistribution(drops, refinement, valueOf) {
  const entries = drops
    .map((d) => ({ value: Math.max(0, valueOf(d) || 0), p: dropProbability(d, refinement) }))
    .sort((a, b) => a.value - b.value);
  const listed = entries.reduce((s, e) => s + e.p, 0);
  if (listed < 1) entries.unshift({ value: 0, p: 1 - listed });
  return entries;
}

/** F(v) de una distribución ya ordenada: probabilidad de sacar como mucho `v`. */
function cdfAt(entries, v) {
  let acc = 0;
  for (const e of entries) {
    if (e.value > v) break;
    acc += e.p;
  }
  return acc;
}

/**
 * @param relics  [{ name, refinement }] tal como salen del panel de escuadra.
 * @param deps.relicsDatabase  nombre de reliquia -> [{ name, chance, rarity, ducats }]
 * @param deps.getPrice        (pieza) => platino ya resuelto (sync); lo que no sepa vale 0.
 * @param deps                 además, lo que necesitan rewardValue/setHelpOf:
 *                             setsDatabase, primeInventory, getSetName, getRequiredCount.
 * @returns {{ relics: Array, drops: Array, runEV: number }}
 *          `drops` es la UNIÓN de las tablas, con `chance` = probabilidad de que esa pieza
 *          aparezca en alguna de las tarjetas del run.
 */
export function squadRunOutlook(relics, deps = {}) {
  const { relicsDatabase = {}, getPrice = () => 0 } = deps;

  const valued = new Map(); // pieza -> { plat, value, help }
  const valueOfDrop = (drop) => {
    const name = drop?.name;
    if (!name) return 0;
    if (!valued.has(name)) {
      const value = rewardValue({ name, price: getPrice(name), ducats: drop.ducats, qty: 1 }, deps);
      valued.set(name, { plat: value.plat, value, help: setHelpOf(name, deps) });
    }
    return valued.get(name).plat;
  };

  const carried = (relics || [])
    .map((r) => {
      const drops = relicsDatabase[r?.name] || [];
      const refinement = r?.refinement || DEFAULT_REFINEMENT;
      return { name: r?.name, refinement, assumedRefinement: !r?.refinement, drops };
    })
    .filter((r) => r.drops.length > 0);

  if (!carried.length) return { relics: [], drops: [], runEV: 0 };

  const dists = carried.map((r) => valueDistribution(r.drops, r.refinement, valueOfDrop));

  // EV en solitario de cada reliquia: es lo que compara "quién trajo la buena". La
  // contribución marginal al run diría otra cosa (una reliquia cara aporta poco si otra
  // ya cubre ese premio) y no es lo que se pregunta al mirar el panel.
  const relicsOut = carried.map((r, i) => ({
    name: r.name,
    refinement: r.refinement,
    assumedRefinement: r.assumedRefinement,
    ev: dists[i].reduce((s, e) => s + e.value * e.p, 0),
  }));

  const dropsOut = new Map();
  carried.forEach((r) => {
    r.drops.forEach((d) => {
      if (!d?.name) return;
      const p = dropProbability(d, r.refinement);
      const prev = dropsOut.get(d.name);
      // P(sale en alguna tarjeta) = 1 - Π(1 - p_i). Se acumula como el complementario
      // para que una pieza que está en dos reliquias del squad no se cuente dos veces.
      if (prev) prev.miss *= (1 - p);
      else dropsOut.set(d.name, { name: d.name, ducats: d.ducats || 0, miss: 1 - p });
    });
  });

  const drops = [...dropsOut.values()].map((d) => {
    const v = valued.get(d.name) || { plat: 0, value: null, help: null };
    return {
      name: d.name,
      ducats: d.ducats,
      chance: 1 - d.miss,
      plat: v.plat,
      route: v.value?.route || "none",
      help: v.help,
    };
  }).sort((a, b) => b.plat - a.plat || b.chance - a.chance);

  // E[máximo]: se recorren los valores posibles de menor a mayor y cada uno se cobra por
  // la probabilidad de que TODAS las tarjetas se queden en él o por debajo, menos la de
  // que se queden en el anterior.
  const levels = [...new Set(dists.flat().map((e) => e.value))].sort((a, b) => a - b);
  let runEV = 0;
  let prevProduct = 0;
  for (const v of levels) {
    const product = dists.reduce((acc, d) => acc * cdfAt(d, v), 1);
    runEV += v * (product - prevProduct);
    prevProduct = product;
  }

  return { relics: relicsOut, drops, runEV };
}
