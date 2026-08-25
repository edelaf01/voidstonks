import { closenessWeight } from "./relic_picks.js";
import { setHelpOf } from "./reward_set_pick.js";

/**
 * Cuánto platino te llevas de verdad con cada recompensa de la pantalla.
 *
 * Las tres etiquetas que ya había —más platino, mejor ducados, cierra set— contestan tres
 * preguntas distintas y ninguna decide: en una pantalla con un receptor de 7p y el
 * plano que cierra Akbronco, las tres pueden señalar tarjetas diferentes y el usuario
 * elige a ojo en los 15 segundos que dura la pantalla.
 *
 * Aquí se pasa TODO a la misma unidad —platino que acabas teniendo— para poder compararlas:
 * un set solo vale la pena si el set entero vale MÁS que sus piezas por separado, y esa
 * diferencia (la prima de montarlo) es lo único que aporta cerrarlo. Akbronco cierra un set
 * y aun así pierde contra 7p sueltos si el set vale lo que ya valían sus piezas.
 *
 * Puro: todo entra por `deps`.
 */

/**
 * Cuántos ducados equivalen a 1 platino. Ya estaba implícito en el modal
 * (`potential = max(ducats, price * 10)`); aquí se nombra para poder cambiarlo en un sitio.
 */
export const DUCATS_PER_PLAT = 10;

/**
 * Una pieza de 2p no se vende: nadie monta un trade por eso, así que su platino teórico no
 * es platino que vayas a tener. Por debajo de FLOOR vale 0 como venta suelta y por encima
 * de FULL vale lo que marca; en medio se interpola en vez de saltar, para que dos piezas de
 * precio parecido no se ordenen al revés por caer a distinto lado de un umbral.
 *
 * Esto es justo lo que hace que cerrar un set de piezas invendibles valga el set ENTERO:
 * si las piezas sueltas no tienen salida, todo lo que cobras sale de montarlo.
 */
export const SALE_FLOOR_PLAT = 2;
export const SALE_FULL_PLAT = 8;

/** Platino que de verdad esperas cobrar por vender una pieza suelta a ese precio. */
export function saleValue(price) {
  const p = Number(price) || 0;
  if (p <= SALE_FLOOR_PLAT) return 0;
  if (p >= SALE_FULL_PLAT) return p;
  return p * ((p - SALE_FLOOR_PLAT) / (SALE_FULL_PLAT - SALE_FLOOR_PLAT));
}

/**
 * Valor en platino de UNA recompensa, con el desglose de por qué.
 *
 * @param item  { name, price, ducats, qty }
 * @param deps.getPrice  (nombre) => platino ya resuelto (sync). Lo que no sepa vale 0, y
 *        entonces esa vía simplemente no suma: sin precios la función degrada a "vende la
 *        más cara", que es lo que hacía el modal antes.
 * @param deps.setsDatabase / primeInventory / getSetName / getRequiredCount  lo de setHelpOf.
 * @returns {{plat:number, route:"set"|"sell"|"ducats"|"none", sale:number, ducatPlat:number,
 *            setGain:number, premium:number, set:string|null, left:number|null}}
 */
export function rewardValue(item, deps = {}) {
  const { getPrice = () => 0, getRequiredCount = () => 1, setsDatabase = {} } = deps;
  const qty = Math.max(1, Number(item?.qty) || 1);
  const price = Number(item?.price) || 0;
  const ducats = Number(item?.ducats) || 0;

  const sale = saleValue(price) * qty;
  const ducatPlat = (ducats / DUCATS_PER_PLAT) * qty;

  const help = setHelpOf(item?.name, deps);
  const parts = help ? (setsDatabase[help.set] || []) : [];
  // Un precio que no ha llegado todavía vale 0, y un 0 en una pieza infla la prima justo en la
  // dirección peligrosa: el set entero parecería beneficio. Las que falten se estiman con la
  // media de las que sí están; si no hay ni una, no se cobra prima y decide la venta suelta.
  const known = parts.map((p) => Number(getPrice(p)) || 0).filter((n) => n > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;

  let premium = 0;
  let setGain = 0;
  if (help && known.length > 0) {
    const partsApart = parts.reduce(
      (s, p) => s + saleValue(Number(getPrice(p)) || avg) * (getRequiredCount(help.set, p) || 1), 0);
    // La prima nunca es negativa: si las piezas sueltas valen más que el set, montarlo no
    // aporta nada — pero tampoco resta, porque siempre puedes venderlas por separado.
    premium = Math.max(0, saleValue(getPrice(`${help.set} Set`)) - partsApart);
    // `left` cuenta lo que faltará DESPUÉS de cogerla y closenessWeight lo que falta ANTES
    // de abrir: sin el +1, cerrar el set y dejarlo a una pieza valdrían lo mismo.
    setGain = premium * closenessWeight(help.left + 1);
  }

  // Dos destinos posibles para la pieza y solo puedes darle uno: guardarla (venderla suelta
  // o meterla en el set) o fundirla en ducados. Suma dentro de cada vía, máximo entre ellas.
  const keep = sale + setGain;
  const plat = Math.max(keep, ducatPlat);

  let route = "none";
  if (plat > 0) route = ducatPlat > keep ? "ducats" : (setGain > sale ? "set" : "sell");

  return {
    plat, route, sale, ducatPlat, setGain, premium,
    set: help?.set || null,
    left: help ? help.left : null,
  };
}

/**
 * Margen mínimo para decir que una recompensa GANA en vez de "están igual". Dos tarjetas a
 * 7,0 y 7,2 platino no son una decisión: coronar una de ellas es fingir una precisión que
 * los precios de warframe.market no tienen.
 */
export const CLEAR_WIN_RATIO = 1.15;
export const CLEAR_WIN_PLAT = 1;

/**
 * Las recompensas ordenadas por lo que te llevas, la mejor primera.
 * @returns [{ ...item, value }] — `value` es lo que devuelve rewardValue.
 */
export function rankRewards(items, deps) {
  return (items || [])
    .map((item) => ({ ...item, value: rewardValue(item, deps) }))
    .sort((a, b) => b.value.plat - a.value.plat);
}

/**
 * La recompensa a marcar, o null si ninguna vale nada (cuatro Forma, o sin precios todavía).
 * `clear` distingue "esta gana" de "gana por poco", que es la diferencia entre un consejo y
 * una moneda al aire.
 */
export function pickBestReward(items, deps) {
  const ranked = rankRewards(items, deps);
  const best = ranked[0];
  if (!best || best.value.plat <= 0) return null;
  const second = ranked[1]?.value.plat || 0;
  return {
    name: best.name,
    value: best.value,
    clear: best.value.plat >= second * CLEAR_WIN_RATIO
      && best.value.plat - second >= CLEAR_WIN_PLAT,
  };
}
