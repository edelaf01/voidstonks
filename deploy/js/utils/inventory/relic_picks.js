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
 * Lo que hace buena a una reliquia aquí es que varias de sus 6 recompensas sean piezas que aún
 * te faltan: con una sola útil dependes de que caiga justo esa; con tres, casi cualquier
 * resultado te sirve. Ese conteo es `useful`, y es lo que manda en el orden.
 *
 * Puro: todo entra por `deps`.
 */

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
 * @returns [{ relic, tier, owned, useful, odds, runs, parts, ready }] ya ordenadas.
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

    picks.push({
      // Minutos estimados hasta que caiga algo que te falte: runs medias × lo que dura la
      // misión más rápida de su era. Es lo que hace comparable una Captura con una Excavación.
      minutes: (Number.isFinite(v.runs) && fisura)
        ? Math.round(v.runs * missionMinutes(fisura.type))
        : null,
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
      parts: v.missing.map((m) => m.part),
      ready: suyas.length > 0,
    });
  }

  // Primero lo que se puede abrir YA: una reliquia perfecta de una era sin fisura viva no es
  // una recomendación, es un recordatorio (mismo criterio que el panel de rutas). Dentro de
  // eso manda cuántas recompensas útiles trae, y solo a igualdad la probabilidad real con las
  // copias que tienes — que es donde pesa tener 12 de una en vez de 1.
  picks.sort((a, b) =>
    ((b.ready) - (a.ready))
    || (b.useful - a.useful)
    || (b.odds - a.odds)
    || (a.runs - b.runs));
  return picks.slice(0, limit);
}

/**
 * Los órdenes de la vista "por reliquia". Todos empiezan por `ready` a propósito, igual que
 * ROUTE_SORTS: una reliquia inmejorable de una era sin fisura viva no es una recomendación.
 */
export const PICK_SORTS = {
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
  const { query = "", era = "", readyOnly = false, sortBy = "useful" } = prefs;
  const q = String(query).trim().toLowerCase();

  const out = picks.filter((p) => {
    if (era && p.tier !== era) return false;
    if (readyOnly && !p.ready) return false;
    if (!q) return true;
    return p.relic.toLowerCase().includes(q)
      || (p.sets || []).some((s) => String(s).toLowerCase().includes(q))
      || (p.parts || []).some((x) => String(x).toLowerCase().includes(q));
  });
  out.sort((a, b) => (b.ready - a.ready) || (PICK_SORTS[sortBy] || PICK_SORTS.useful)(a, b));
  return out;
}
