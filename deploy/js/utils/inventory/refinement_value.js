import { relicOpenEV } from "./relic_drop_odds.utils.js";

// Lo que cuesta refinar una reliquia en el juego. Intacta es gratis; radiante son 100
// vestigios, que es ~5 runs de reactivo, así que el gasto tiene que salir a cuenta.
export const TRACE_COST = { intact: 0, exceptional: 25, flawless: 50, radiant: 100 };

export const REFINEMENT_ORDER = ["intact", "exceptional", "flawless", "radiant"];

// Por debajo de esto el refinamiento no se recomienda aunque gane: 1p de más por 100
// vestigios es ruido de precios, no una decisión. 0,05 p/vestigio = 5p por radiante.
export const MIN_PLAT_PER_TRACE = 0.05;

/**
 * Con qué refinamiento renta MÁS PLATINO abrir esta reliquia.
 *
 * Es una pregunta distinta de la que contesta `bestRefinementFor`, y por eso hacían falta las
 * dos: aquella busca cerrar el set en menos runs y contesta "intacta" en cuanto las piezas que
 * faltan son comunes —correcto, porque refinar BAJA la tasa de comunes—. Pero si en esa misma
 * reliquia la rara vale 60p, abrirla intacta tira 60p al 2 % en vez de al 10 %, y el consejo de
 * "intacta" sale carísimo aunque cierre el set antes.
 *
 * El veredicto se da en platino por vestigio, no en platino a secas: los vestigios son el
 * recurso escaso, así que lo que decide dónde gastarlos es el rendimiento, no el bruto. Así
 * "+38p por 100 vestigios" y "+12p por 25" quedan comparables (0,38 vs 0,48: gana el segundo).
 *
 * @param drops     los 6 premios de la reliquia, con `chance` para deducir la rareza
 * @param valueOf   (premio) => platino. Sin él no hay veredicto posible y se devuelve null.
 * @returns {{ev: Record<string,number>, best: string, gain: number, traces: number,
 *            perTrace: number, worth: boolean}|null}
 */
export function refinementValue(drops, opts = {}) {
  const { squadSize = 1 } = opts;
  // `valueOf` NO se puede desestructurar: sin pasarlo se hereda Object.prototype.valueOf, que
  // es una función y cuela por cualquier `typeof === "function"`. Llamarla suelta revienta con
  // "Cannot convert undefined or null to object" en vez de devolver null.
  const valueOf = Object.hasOwn(opts, "valueOf") ? opts.valueOf : null;
  if (!Array.isArray(drops) || drops.length === 0 || typeof valueOf !== "function") return null;

  const ev = {};
  for (const ref of REFINEMENT_ORDER) {
    ev[ref] = relicOpenEV(drops, { refinement: ref, squadSize, valueOf });
  }
  if (!Object.values(ev).some((v) => v > 0)) return null;

  // Gana el mejor platino por vestigio, no el mejor platino: radiante casi siempre da el EV más
  // alto cuando hay algo caro dentro, y eligiéndolo por EV el consejo sería "radiante" en todas
  // las reliquias del juego, que es tanto como no aconsejar nada. Intacta es la referencia y
  // entra fuera del bucle porque su coste es 0 y dividir por él da Infinity.
  let best = "intact";
  let mejorPerTrace = 0;
  for (const ref of REFINEMENT_ORDER) {
    if (TRACE_COST[ref] === 0) continue;
    const perTrace = (ev[ref] - ev.intact) / TRACE_COST[ref];
    if (perTrace > mejorPerTrace) { mejorPerTrace = perTrace; best = ref; }
  }

  const gain = ev[best] - ev.intact;
  const traces = TRACE_COST[best];
  return {
    ev, best, gain, traces,
    perTrace: mejorPerTrace,
    worth: best !== "intact" && mejorPerTrace >= MIN_PLAT_PER_TRACE,
  };
}
