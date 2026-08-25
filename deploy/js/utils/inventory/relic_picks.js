import { relicSetValue } from "./relic_set_value.js";
import { bestFissure, missionMinutes, tiersOpenedBy } from "./relic_route.js";

/**
 * Cuáles de TUS reliquias conviene abrir ahora.
 *
 * Es la vista inversa de buildFarmRoutes: aquella va "set → qué reliquia me lo cierra", y esta
 * "reliquia → qué me daría abrirla". Hacen falta las dos porque se usan en momentos distintos:
 * una cuando decides qué farmear, la otra cuando ya estás delante de la pantalla de selección
 * con tus reliquias y hay que elegir UNA.
 *
 * Lo que hace buena a una reliquia aquí es cuánto te acerca a CERRAR un set: una pieza que lo
 * completa vale mucho más que otra de un set sin empezar, porque un set a medias no se vende.
 * Eso es `progress`, y es lo que manda en el orden. `useful` —cuántas de sus 6 recompensas te
 * faltan— se sigue enseñando, pero como dato: con el inventario a medias casi todas tienen 5 o
 * 6 y no distingue nada.
 *
 * Puro: todo entra por `deps`.
 */

/**
 * Cuánto acerca a COBRAR una pieza que te falta, según lo que le quede al set.
 *
 * `1 / restantes²` y no `1 / restantes`: un set a medias no se vende, así que media docena de
 * piezas de sets sin empezar no valen lo que una que cierra uno. Con el peso lineal, una
 * reliquia con 6 recompensas de sets a 3-4 piezas (Axi G4: cierra 0) le ganaba a la que cierra
 * dos sets de golpe (Lith A8, 68 % de cerrar uno). Es una estimación para ORDENAR, no platino.
 */
export function closenessWeight(setMissing) {
  const quedan = Math.max(1, setMissing || 1);
  return 1 / (quedan * quedan);
}

/** La era va en la primera palabra del nombre ("Lith G1"). "Vanguard" es como el worldstate llama a Axi. */
export function tierOfRelic(relicName) {
  const tier = String(relicName || "").trim().split(/\s+/)[0] || "";
  return tier === "Vanguard" ? "Axi" : tier;
}

/**
 * @param deps.relicCounts    { [reliquia sin " Relic"]: copias }
 * @param deps.relicsDatabase { [reliquia]: [{ name, chance }] }
 * @param deps.fissures       fisuras activas [{ node, type, tier, eta }]. De ahí salen las eras
 *        abiertas Y la misión concreta a la que ir, que es lo que convierte "puedes abrirla" en
 *        un plan. Vacío = no se sabe, y nada se marca como listo.
 * @param deps.getPrice       (nombre) => platino. Opcional: sin él la pick va sin valorar.
 * @param deps.setsDatabase / primeInventory / getSetName / getRequiredCount / dropChances / squadSize
 *        lo que pide relicSetValue.
 * @param limit  cuántas devolver.
 * @returns [{ relic, tier, owned, progress, closes, closeOdds, useful, odds, runs, ready,
 *            parts: [{ name, set, missing, total }] }]
 *          ya ordenadas.
 */
export function rankRelicPicks(deps, limit = 8) {
  const {
    relicCounts = {}, relicsDatabase = {}, fissures = [], getPrice = null,
    setsDatabase, primeInventory, getSetName, getRequiredCount, dropChances, squadSize = 4,
  } = deps;

  // Las fisuras vivas por era. Una Omnia abre las cuatro clásicas, y sin tiersOpenedBy una
  // Omnia viva dejaba todas las reliquias marcadas como "esperando".
  const porEra = new Map();
  for (const f of fissures) {
    for (const t of tiersOpenedBy(f)) {
      if (!porEra.has(t)) porEra.set(t, []);
      porEra.get(t).push(f);
    }
  }

  const picks = [];
  for (const [relic, owned] of Object.entries(relicCounts)) {
    if (!(owned > 0)) continue;
    const drops = relicsDatabase[relic] || relicsDatabase[`${relic} Relic`];
    if (!Array.isArray(drops) || drops.length === 0) continue;

    const v = relicSetValue(drops, {
      setsDatabase, primeInventory, getSetName, getRequiredCount,
      dropChances, squadSize, stock: owned,
    });
    // Sin nada que te falte, abrirla no te acerca a ningún set. Que valga platino es otra
    // pregunta y ya la contesta el inventario de reliquias con su chip de plat/run.
    if (v.missing.length === 0) continue;

    const tier = tierOfRelic(relic);
    const suyas = porEra.get(tier) || [];
    // La fisura concreta, ya elegida por rapidez y tiempo restante: sin ella "puedes abrirla"
    // no dice a dónde ir, que es la mitad del plan que sí da la vista por set.
    const fisura = bestFissure(suyas);

    // Lo que te llevas si sale algo útil: el valor MEDIO de las piezas que te faltan, no la
    // suma — de una apertura sale UNA recompensa, y sumarlas prometería cuatro.
    let valor = null;
    if (getPrice) {
      const precios = v.missing.map((m) => getPrice(m.part) || 0).filter((n) => n > 0);
      if (precios.length > 0) valor = Math.round(precios.reduce((a, b) => a + b, 0) / precios.length);
    }

    // Las que CIERRAN un set con una sola apertura, y con qué probabilidad. Es el dato que
    // decide el clic cuando tienes la pantalla de selección delante, y estaba solo en el
    // ORDEN de la etiqueta de set: se veía "6 te sirven" en dos reliquias donde una cerraba
    // Akarius y la otra no acercaba nada a rendir.
    const cierran = v.missing.filter((m) => m.setMissing === 1);
    const setsCerrados = [...new Set(cierran.map((m) => m.set))];

    picks.push({
      // Minutos estimados hasta que caiga algo que te falte: runs medias × lo que dura la
      // misión más rápida de su era. Es lo que hace comparable una Captura con una Excavación.
      minutes: (Number.isFinite(v.runs) && fisura)
        ? Math.round(v.runs * missionMinutes(fisura.type))
        : null,
      closes: setsCerrados,
      // Probabilidad de cerrar ALGUNO de ellos en una apertura, no la suma de las sueltas.
      closeOdds: 1 - cierran.reduce((p, m) => p * (1 - m.chance), 1),
      // Lo que ordena la lista: probabilidad por lo cerca que deja al set (closenessWeight).
      progress: v.missing.reduce((s, m) => s + m.chance * closenessWeight(m.setMissing), 0),
      fissure: fisura,
      value: valor,
      relic,
      tier,
      owned,
      // Recompensas DISTINTAS que te sirven. Es el número que pediste: con varias, casi
      // cualquier resultado de la apertura te vale.
      useful: v.missing.length,
      odds: v.odds,
      runs: v.runs,
      // Los sets a los que aporta, sin repetir: una reliquia puede dar dos piezas del mismo.
      sets: [...new Set(v.missing.map((m) => m.set))],
      // Con el nombre solo, "3 te sirven" no distinguía tres piezas de tres sets sin empezar
      // de tres que dejan uno a punto: lo que falta de cada set se calcula arriba y se tiraba.
      parts: v.missing.map((m) => ({
        name: m.part, set: m.set, missing: m.setMissing, total: m.setTotal,
      })),
      ready: suyas.length > 0,
    });
  }

  // Primero lo que se puede abrir YA: una reliquia perfecta de una era sin fisura viva no es
  // una recomendación, es un recordatorio (mismo criterio que el panel de rutas). Dentro de
  // eso manda `progress`.
  //
  // Contar recompensas útiles NO servía para elegir: con el inventario a medias, 87 de las 767
  // reliquias tenían las 6 "útiles" y el orden lo acababa decidiendo el alfabeto —de las 46 que
  // podían cerrar un set, había una en el puesto 8 y las siguientes en el 138, el 160 y el 198.
  // `useful` sigue en la tarjeta, que como DATO sí dice algo: cuántos resultados distintos
  // te valen.
  picks.sort((a, b) =>
    ((b.ready) - (a.ready))
    || (b.progress - a.progress)
    || (b.odds - a.odds)
    || (a.runs - b.runs));
  return picks.slice(0, limit);
}

/**
 * Los órdenes de la vista "por reliquia". Todos empiezan por `ready` a propósito, igual que
 * ROUTE_SORTS: una reliquia inmejorable de una era sin fisura viva no es una recomendación.
 */
export const PICK_SORTS = {
  // El de serie: lo que más acerca a cerrar un set. Ver closenessWeight.
  best: (a, b) => (b.progress - a.progress) || (b.odds - a.odds) || (a.runs - b.runs),
  useful: (a, b) => (b.useful - a.useful) || (b.odds - a.odds) || (a.runs - b.runs),
  odds: (a, b) => (b.odds - a.odds) || (b.useful - a.useful),
  // Sin valorar va al fondo en vez de colarse arriba como si valiera 0 y empatara con las demás.
  value: (a, b) => ((b.value ?? -1) - (a.value ?? -1)) || (b.useful - a.useful),
  // Aquí manda el MENOR, y las que no tienen minutos (sin fisura) van al fondo.
  minutes: (a, b) => ((a.minutes ?? Infinity) - (b.minutes ?? Infinity)) || (b.useful - a.useful),
};

/**
 * Filtra y reordena las picks ya calculadas. Aparte de rankRelicPicks porque cambiar un filtro
 * no puede obligar a recalcular las probabilidades de todo el inventario de reliquias.
 *
 * @param prefs.query   busca en la reliquia, en el set y en la pieza: "Axi", "saryn" y
 *        "chassis" son las tres formas naturales de buscar aquí, y con una sola caja.
 */
export function filterRelicPicks(picks, prefs = {}) {
  const { query = "", era = "", readyOnly = false, sortBy = "best" } = prefs;
  const q = String(query).trim().toLowerCase();

  const out = picks.filter((p) => {
    if (era && p.tier !== era) return false;
    if (readyOnly && !p.ready) return false;
    if (!q) return true;
    return p.relic.toLowerCase().includes(q)
      || (p.sets || []).some((s) => String(s).toLowerCase().includes(q))
      || (p.parts || []).some((x) => String(x?.name || x).toLowerCase().includes(q));
  });
  out.sort((a, b) => (b.ready - a.ready) || (PICK_SORTS[sortBy] || PICK_SORTS.best)(a, b));
  return out;
}
