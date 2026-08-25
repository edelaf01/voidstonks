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
 * Hasta dónde puede llegar este set y qué le falta para llegar.
 *
 * `built` son los sets enteros que ya te salen: el mínimo de copias entre todas las piezas.
 *
 * El objetivo NO es siempre `built + 1`. Si tienes 4 de cada pieza de Hydroid menos el plano,
 * apuntar al set siguiente te manda a por UN plano — y con tres más tendrías cuatro sets
 * montados. El excedente ya lo has farmeado; lo que falta es convertirlo, y decir "te falta 1"
 * esconde justo eso.
 *
 * Así que cuando el mínimo lo marca UNA sola pieza, el objetivo es el SEGUNDO cuello de
 * botella: el menor recuento entre las que no están en el mínimo. Con [0,4,4,4] son 4 sets a
 * cambio de 4 planos; con [3,4,5,6] sale 4, que es el `built + 1` de siempre. Solo cambia
 * cuando hay hueco de verdad, que es el caso que no se veía.
 *
 * @returns `needed` = copias que hay que conseguir de cada pieza que falta, por nombre.
 */
function setProgress(setName, parts, primeInventory, getRequiredCount) {
  const req = (p) => getRequiredCount(setName, p) || 1;
  const sets = new Map(parts.map((p) => [p, Math.floor((primeInventory[p] || 0) / req(p))]));

  const built = Math.min(...sets.values());
  const porEncima = [...sets.values()].filter((n) => n > built);
  // Con VARIAS piezas en el mínimo, el excedente no está a una pieza de convertirse y apuntar
  // al segundo cuello multiplica el farmeo entero: con 16 planos de Gara y las otras tres a 0,
  // la ruta pedía 16 Sistemas + 16 Chasis + 16 Neurópticos —48 piezas— cuando lo que cierra un
  // set es UNA de cada. Ahí el objetivo vuelve a ser el set siguiente; el excedente no se
  // pierde, lo recoge la siguiente pasada en cuanto quede un solo cuello de botella.
  const unSoloCuello = [...sets.values()].filter((n) => n === built).length === 1;
  const target = (unSoloCuello && porEncima.length > 0) ? Math.min(...porEncima) : built + 1;

  const missingParts = [];
  const needed = {};
  for (const p of parts) {
    const faltan = target * req(p) - (primeInventory[p] || 0);
    if (faltan > 0) {
      missingParts.push(p);
      needed[p] = faltan;
    }
  }
  // Sets que se desbloquean al cerrarlo. Es lo que hace que "farmea 4 planos" tenga sentido:
  // sin él, cuatro copias de lo mismo se leen como un error.
  return { built, missingParts, needed, target, setsUnlocked: target - built };
}

/**
 * Minutos típicos de una run de cada tipo de misión, contando carga y extracción.
 *
 * No es un dato de ninguna API: son duraciones observadas de una run que rinde UNA reliquia.
 * Existen porque sin ellas "esfuerzo" sería el número de runs, y 3 Capturas (6 min) saldrían
 * peor puntuadas que 2 Intercepciones (12 min). Un valor de más o de menos mueve el orden
 * poco; lo que lo mueve mucho es no tenerlas.
 */
const MISSION_MINUTES = {
  Capture: 2, Extermination: 4, Rescue: 5, Sabotage: 4, Spy: 6,
  "Mobile Defense": 6, Assault: 5,
  Survival: 5, Defense: 5, Interception: 7, Excavation: 7, Disruption: 6,
  "Void Cascade": 6, "Void Flood": 6, Alchemy: 5, "Conjunction Survival": 6,
};
const DEFAULT_MINUTES = 6;

/** Minutos de una fisura; "Dark Sector Defense" cuenta como Defense. */
export function missionMinutes(type) {
  const t = String(type || "");
  if (MISSION_MINUTES[t]) return MISSION_MINUTES[t];
  for (const k of Object.keys(MISSION_MINUTES)) if (t.includes(k)) return MISSION_MINUTES[k];
  return DEFAULT_MINUTES;
}

/**
 * La mejor fisura de una lista: primero la más rápida, y a igualdad la que más tiempo le
 * queda — una que caduca en 3 minutos no da para abrir nada.
 *
 * Antes se cogía `fissures[0]`, o sea la primera que devolviera el worldstate: mandaba a una
 * Excavación de 7 min habiendo una Captura de 2 en la misma era.
 */
export function bestFissure(fissures = []) {
  if (!fissures.length) return null;
  // Date.parse y no Number: el worldstate manda el expiry como ISO ("2026-08-15T13:10:30Z"),
  // así que Number() daba NaN y el desempate por tiempo restante no se aplicaba nunca.
  const restante = (f) => Date.parse(f?.expiry) || Number(f?.expiry) || 0;
  return [...fissures].sort((a, b) =>
    (missionMinutes(a.type) - missionMinutes(b.type))
    || (restante(b) - restante(a)))[0];
}

/** Las eras se normalizan porque el worldstate llama "Vanguard" a lo que el juego llama Axi. */
export function normalizeTier(tier) {
  return tier === "Vanguard" ? "Axi" : tier;
}

// Una fisura Omnia (Lua / Zariman / Deimos) admite cualquier reliquia CLÁSICA, así que cuenta
// como fisura de las cuatro eras a la vez. Requiem queda fuera: es otro sistema.
//
// Sin esto la ruta agrupaba por era estricta y una Omnia no casaba con nada, así que con tres
// Omnia vivas el panel seguía diciendo "esperando fisura" sobre reliquias que se podían abrir
// en ese momento.
const CLASSIC_TIERS = ["Lith", "Meso", "Neo", "Axi"];

/** Eras cuyas reliquias puede abrir esta fisura. */
export function tiersOpenedBy(fissure) {
  const tier = normalizeTier(fissure?.tier);
  return tier === "Omnia" ? [...CLASSIC_TIERS] : [tier];
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
 * @param deps.getPrice            (nombre) => platino, o 0 si no se sabe. Opcional: sin él
 *   la ruta se construye igual, solo que sin valorar.
 * @param deps.expectedRuns        (pieza) => runs medios para sacar una copia. Opcional.
 * @param deps.relicRuns           (entrada de itemsDatabase) => runs medios para sacar la pieza
 *   de ESA reliquia, con el refinamiento y la escuadra del jugador. Recibe la entrada entera y
 *   no la rareza porque la etiqueta `rarity` del origen no es fiable (ver rarityFromChance).
 *   Opcional: sin él las reliquias se ordenan por la probabilidad intacta, como antes.
 * @returns null si no falta nada para el siguiente set, o si el set no existe.
 */
export function buildSetRoute(setName, deps) {
  const {
    setsDatabase = {}, primeInventory = {}, itemsDatabase = {},
    relicCounts = {}, relicSources = {}, fissures = [],
    getRequiredCount = () => 1,
    getPrice = null, expectedRuns = null, relicRuns = null, refinementRuns = null,
    preferTier = "", refinementValueOf = null,
  } = deps;

  const parts = setsDatabase[setName];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  // Cuántos sets ENTEROS te salen ya con lo que tienes. Sin esto, un set completo salía de
  // la lista aunque tuvieras 3 cañones y 2 receptores sueltos: estás a una pieza del
  // segundo set y eso es justo lo que hay que farmear.
  const { built, missingParts, needed, target, setsUnlocked } =
    setProgress(setName, parts, primeInventory, getRequiredCount);
  if (missingParts.length === 0) return null;

  // Fisuras vivas agrupadas por era: es lo que decide qué de la ruta se puede hacer ya.
  const fissuresByTier = new Map();
  for (const f of fissures) {
    for (const tier of tiersOpenedBy(f)) {
      if (!fissuresByTier.has(tier)) fissuresByTier.set(tier, []);
      fissuresByTier.get(tier).push(f);
    }
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
        // Runs medias con ESTA reliquia. Es lo que hace comparables dos reliquias de la misma
        // pieza; `chance` no vale para eso porque es la probabilidad intacta (ver relicRuns).
        runs: relicRuns ? relicRuns(src) : null,
        owned: relicCounts[key] || 0,
        // Solo hace falta saber DÓNDE farmearla si no la tienes ya.
        sources: (relicCounts[key] || 0) > 0 ? [] : (relicSources[key] || []),
        fissures: fissuresByTier.get(tier) || [],
      };
    });

    // Menos runs primero, y las copias solo desempatan.
    //
    // Antes mandaba `owned`, así que cinco copias de una reliquia donde la pieza es rara
    // ganaban a una copia donde es común — el doble de runs, pero salía recomendada. Y el
    // último criterio era la probabilidad INTACTA mientras el panel estimaba el tiempo en
    // radiante: con radiante una pieza poco común (20 %) supera a una común (16,67 %), o sea
    // que se recomendaba una reliquia y se cronometraba otra.
    const byRuns = (a, b) =>
      (Number.isFinite(a.runs) && Number.isFinite(b.runs)) ? a.runs - b.runs : 0;

    relics.sort((a, b) =>
      // Con una era elegida en el filtro, esa manda sobre todo lo demás. Sin esto el filtro
      // dejaba la ruta (correcto: una pieza cae de varias eras y con Axi SÍ se avanza) pero
      // seguía enseñando la reliquia Meso, así que parecía que no hacía nada.
      (preferTier ? (b.tier === preferTier) - (a.tier === preferTier) : 0)
      || (b.owned > 0 && b.fissures.length > 0) - (a.owned > 0 && a.fissures.length > 0)
      || byRuns(a, b)
      || (b.owned - a.owned)
      || (b.chance - a.chance));
    return {
      part,
      // Copias que hacen falta, no siempre 1: con 4 de cada pieza menos el plano son 4 planos,
      // y farmearlos monta 4 sets de golpe. Ver setProgress.
      needed: needed[part] || 1,
      relics,
      ready: relics.some((r) => r.owned > 0 && r.fissures.length > 0),
      // La fisura concreta a la que ir con la mejor reliquia, ya elegida por rapidez.
      fissure: bestFissure(relics[0]?.fissures),
      // Si en la reliquia que se recomienda hay algo caro, refinarla puede rentar aunque la
      // ruta se cierre antes intacta: son dos preguntas distintas y el panel contestaba solo
      // una. Ver refinementValue.
      refValue: (refinementValueOf && relics[0]) ? refinementValueOf(relics[0].relic) : null,
    };
  });

  // Lo que GANAS por cerrarlo, no lo que vale el set: las piezas que ya tienes se pueden
  // vender sueltas hoy, así que el premio real de armarlo es la diferencia. Sin precios
  // (getPrice ausente o catálogo sin cargar) queda a null y el orden cae al de siempre.
  let gain = null;
  let setValue = null;
  if (getPrice) {
    setValue = getPrice(`${setName} Set`) || 0;
    const held = parts.reduce((sum, p) => {
      const req = getRequiredCount(setName, p) || 1;
      const have = Math.min(primeInventory[p] || 0, req * target) - req * built;
      return sum + Math.max(0, have) * (getPrice(p) || 0);
    }, 0);
    // El premio son TODOS los sets que se desbloquean, no uno: con 4 planos salen 4 Hydroid.
    gain = setValue > 0 ? Math.round(setValue * setsUnlocked - held) : null;
  }

  // Esfuerzo = runs medios de cada pieza que falta × lo que dura su misión más rápida. Se
  // mide en minutos porque es la unidad en la que uno decide "¿me da tiempo?".
  //
  // Manda la reliquia elegida cuando se sabe: expectedRuns() usa la rareza de la reliquia
  // donde MEJOR cae la pieza —la tengas o no—, así que el tiempo salía optimista para quien
  // solo tiene la mala.
  let minutes = null;
  if (expectedRuns || relicRuns) {
    minutes = 0;
    for (const m of missing) {
      const elegida = m.relics[0]?.runs;
      const runs = Number.isFinite(elegida) ? elegida : expectedRuns?.(m.part);
      if (!Number.isFinite(runs)) { minutes = null; break; }
      // × las copias que faltan: cuatro planos son cuatro veces el farmeo de uno, y sin esto
      // el panel prometía el mismo tiempo para "te falta 1" que para "te faltan 4".
      minutes += runs * m.needed * missionMinutes(m.fissure?.type);
    }
    if (minutes !== null) minutes = Math.round(minutes);
  }

  // Con qué refinamiento sale más barato cerrarla. null si no se puede estimar.
  const refino = bestRefinementFor(missing, refinementRuns);

  return {
    setName,
    totalParts: parts.length,
    // "intact" | "exceptional" | "flawless" | "radiant". A un set al que solo le faltan comunes
    // le sale mejor INTACTA: refinar le baja la tasa y encima cuesta 100 vestigios.
    bestRefinement: refino ? refino.best : null,
    refinementRunsBy: refino ? refino.runsBy : null,
    // Sets completos que ya te salen; la ruta apunta a `target`, que no siempre es built + 1.
    built,
    // Cuántos sets se montan al completar la ruta. 1 en el caso normal; más cuando hay
    // excedente esperando a que llegue la pieza que hace de cuello de botella.
    setsUnlocked,
    missingCount: missingParts.length,
    // Piezas que puedes ir a por ellas ahora mismo sin farmear reliquias antes.
    readyCount: missing.filter((m) => m.ready).length,
    setValue,
    gain,
    minutes,
    // La cifra que ordena: platino por hora de farmeo. null cuando falta cualquiera de los dos.
    platPerHour: gain !== null && minutes ? Math.round((gain / minutes) * 60) : null,
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
/**
 * Los tres órdenes que puede pedir el panel. Todos empiezan por "lo que se puede farmear ahora":
 * una ruta que hoy no se puede tocar no sube por pagar más, ordenes por lo que ordenes.
 *
 * Las rutas sin valorar (sin precio del set o sin poder estimar runs) NO se descartan nunca: el
 * `?? -1` las manda detrás de las valoradas y entre ellas se ordenan por cercanía. Que falte un
 * precio no puede esconder un set que tienes a una pieza.
 */
// Los cuatro refinamientos, del más barato al más caro en vestigios. El orden importa: a
// igualdad de runs gana el de menos coste, que es lo que hace útil el aviso.
export const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"];

/**
 * Con qué refinamiento se cierra antes esta ruta.
 *
 * No es siempre radiante, y ahí está la gracia: refinar sube la tasa de raras y poco comunes
 * pero BAJA la de comunes (25,3 % intacta → 16,7 % radiante). A un set al que solo le faltan
 * piezas comunes, gastarle 100 vestigios lo hace más lento, no más rápido.
 *
 * Para cada refinamiento se toma, por pieza, la reliquia que menos runs pide con ESE
 * refinamiento —la mejor reliquia puede cambiar según el refinamiento— y se suman las copias
 * que faltan. Gana el total más bajo; a igualdad, el más barato.
 *
 * @param missing            piezas de la ruta, con `relics` y `needed`
 * @param refinementRuns     (drop, refinement) => runs medias, o null si no se sabe
 * @returns {{best: string, runsBy: Record<string, number>}|null}
 */
export function bestRefinementFor(missing, refinementRuns) {
  if (typeof refinementRuns !== "function" || !Array.isArray(missing) || missing.length === 0) return null;

  const runsBy = {};
  for (const ref of REFINEMENTS) {
    let total = 0;
    for (const m of missing) {
      let mejor = Infinity;
      for (const rel of m.relics || []) {
        const r = refinementRuns(rel, ref);
        if (Number.isFinite(r) && r < mejor) mejor = r;
      }
      if (!Number.isFinite(mejor)) { total = Infinity; break; }
      total += mejor * (m.needed || 1);
    }
    if (Number.isFinite(total)) runsBy[ref] = total;
  }

  const candidatos = REFINEMENTS.filter((r) => Number.isFinite(runsBy[r]));
  if (candidatos.length === 0) return null;
  // `<` y no `<=` al recorrer en orden de coste: el primero en empatar se queda, o sea el barato.
  const best = candidatos.reduce((a, b) => (runsBy[b] < runsBy[a] ? b : a));
  return { best, runsBy };
}

export const ROUTE_SORTS = {
  // Lo cerca que estás manda; el p/h decide entre los que están igual de cerca. Es el de serie
  // desde que entran los sets sin empezar: con el catálogo entero dentro, ordenar por p/h
  // enterraba el set al que te falta UNA pieza bajo decenas de sets intactos que pagan más.
  near: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || (a.missingCount - b.missingCount)
    || ((b.platPerHour ?? -1) - (a.platPerHour ?? -1))
    || (b.readyCount - a.readyCount),
  perHour: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || ((b.platPerHour ?? -1) - (a.platPerHour ?? -1))
    || (a.missingCount - b.missingCount),
  gain: (a, b) =>
    ((b.readyCount > 0) - (a.readyCount > 0))
    || ((b.gain ?? -1) - (a.gain ?? -1))
    || (a.missingCount - b.missingCount),
};

export function buildFarmRoutes(deps, limit = 8) {
  // Solo setsDatabase: el resto de deps las consume buildSetRoute, que ya recibe `deps` entero.
  // Aquí se leían también primeInventory y getRequiredCount para decidir qué set entraba, y esa
  // decisión ya no existe.
  const { setsDatabase = {} } = deps;
  const routes = [];
  for (const setName of Object.keys(setsDatabase)) {
    const parts = setsDatabase[setName];
    if (!Array.isArray(parts) || parts.length === 0) continue;
    // TODOS los sets, tocados o no: cualquiera se puede farmear, así que lo que decide es
    // cuántas piezas te faltan, no si lo habías empezado. Antes se descartaba con
    // `missingParts.length === parts.length`, que mete en el mismo saco dos cosas opuestas —no
    // tienes nada, y tienes N sets exactos sin ninguna suelta del siguiente—, así que buscar un
    // set que ya tenías entero no devolvía nada y parecía que la búsqueda estaba rota.
    //
    // Lo que evita que esto se vuelva "el catálogo del juego" es el ORDEN de abajo, no un
    // filtro: los sets sin empezar tienen todas las piezas pendientes y se van al fondo solos.
    // El `=== 0` que había aquí era inalcanzable: `built` es el mínimo de copias, así que la
    // pieza que marca ese mínimo siempre queda por debajo de `built + 1`.
    const route = buildSetRoute(setName, deps);
    if (route) routes.push(route);
  }
  // El orden puramente por p/h ponía arriba rutas que no se pueden tocar: una de 353 p/h cuya
  // única reliquia es de una era sin fisura viva no es una recomendación, es un recordatorio.
  // Por eso los tres órdenes de ROUTE_SORTS empiezan igual. Y va con un matiz que sí importa:
  // una pieza puede caer de varias reliquias de eras DISTINTAS, así que "no se puede ahora" no
  // es "no hay fisura de la era de la primera reliquia" — es que ninguna de las suyas sirva.
  // De eso se encarga `ready` por pieza.
  routes.sort(ROUTE_SORTS[deps.sortBy] || ROUTE_SORTS.near);
  return routes.slice(0, limit);
}
