/**
 * Cuántas RUNS te cuesta una reliquia darte algo que te falta.
 *
 * El inventario ordenaba por platino o ducados, que responden a "qué vendo", no a "qué
 * abro". Para farmear un set la pregunta real es cuántas veces vas a tener que abrir esta
 * reliquia hasta que suelte una pieza que no tienes — y eso sí se puede estimar.
 *
 * Todo se calcula por REFINAMIENTO y TAMAÑO DE ESCUADRA, porque son lo que de verdad
 * mueve el número: en un escuadrón de 4 se abren 4 reliquias y te quedas con la mejor
 * recompensa, así que la probabilidad efectiva de una pieza sube muchísimo frente a
 * abrirla en solitario (una rara radiante pasa de 10% a ~34%).
 */

/**
 * Probabilidad de que salga UNA pieza concreta al abrir la reliquia.
 * Una reliquia trae 3 comunes, 2 poco comunes y 1 rara: la probabilidad del tramo se
 * reparte entre las piezas que lo comparten.
 */
export function partDropChance(chance, dropChances) {
  if (chance < 5) return dropChances.rare;
  if (chance < 20) return dropChances.uncommon / 2;
  return dropChances.common / 3;
}

/**
 * @param drops        piezas de la reliquia: [{ name, chance }]
 * @param deps.setsDatabase     { [set]: [nombres de pieza] }
 * @param deps.primeInventory   { [pieza]: cantidad }
 * @param deps.getSetName       (pieza) => set al que pertenece
 * @param deps.getRequiredCount (set, pieza) => cuántas hacen falta (Systems x1, Forma x2…)
 * @param deps.dropChances      tramo de DROP_CHANCES del refinamiento en uso
 * @param deps.squadSize        cuántos abren a la vez (4 por defecto)
 * @param deps.stock            cuántas copias TIENES de esta reliquia
 * @returns {{runs:number, odds:number, missing:Array, bestSet:string|null,
 *            bestSetMissing:number, bestSetTotal:number, bestSetStarted:boolean}}
 *          runs = Infinity y odds = 0 si la reliquia no suelta nada que te falte.
 *          odds = probabilidad de sacar algo que te falte gastando TODAS tus copias; es lo
 *          que de verdad decide qué abrir hoy, porque 4 runs con 12 copias es casi seguro
 *          y las mismas 4 runs con 1 copia es una tirada suelta.
 */
export function relicSetValue(drops, deps) {
  const {
    setsDatabase = {}, primeInventory = {},
    getSetName, getRequiredCount, dropChances, squadSize = 4, stock = 1,
  } = deps;
  const none = {
    runs: Infinity, odds: 0, missing: [],
    bestSet: null, bestSetMissing: 0, bestSetTotal: 0, bestSetStarted: false,
  };
  if (!Array.isArray(drops) || drops.length === 0) return none;

  const isMissing = (set, part) => (primeInventory[part] || 0) < getRequiredCount(set, part);

  // Piezas que le faltan a cada set, cacheado dentro de la llamada: varias piezas de una
  // misma reliquia suelen ser del mismo set.
  const setStatCache = new Map();
  const statsOfSet = (set) => {
    if (!setStatCache.has(set)) {
      const parts = setsDatabase[set] || [];
      const miss = parts.filter((p) => isMissing(set, p)).length;
      // "Empezado" = ya tienes alguna pieza. Sin esto, "al que menos le falta" premia a los
      // sets PEQUEÑOS en vez de a los avanzados: Akbronco Prime son 2 piezas, así que con el
      // inventario vacío salía "le faltan 2" y ganaba a todos los warframes de 5 — y encima
      // está en decenas de reliquias, así que copaba la lista entera.
      setStatCache.set(set, { missing: miss, total: parts.length, started: miss < parts.length });
    }
    return setStatCache.get(set);
  };

  const missing = [];
  // Probabilidad de NO sacar nada útil en una run; se va multiplicando pieza a pieza.
  let pNothing = 1;
  for (const drop of drops) {
    const set = getSetName(drop.name);
    // "Otros" son Forma, Kuva y demás: no pertenecen a ningún set que completar.
    if (!set || !setsDatabase[set]) continue;
    if (!isMissing(set, drop.name)) continue;

    const single = partDropChance(drop.chance, dropChances);
    const squad = 1 - Math.pow(1 - single, squadSize);
    pNothing *= (1 - squad);
    const st = statsOfSet(set);
    missing.push({
      part: drop.name, set, chance: squad,
      setMissing: st.missing || 1, setTotal: st.total, setStarted: st.started,
    });
  }

  if (missing.length === 0) return none;
  const pSomething = 1 - pNothing;

  // El set "más cerca" manda en la etiqueta de la fila. Un set EMPEZADO siempre gana a uno
  // sin tocar, por pequeño que sea el segundo; entre empezados, al que menos le falta; y a
  // igualdad, el de la pieza más probable, que es la que de verdad vas a sacar.
  const rank = (m) => (m.setStarted ? m.setMissing : Number.MAX_SAFE_INTEGER);
  const best = missing.reduce((a, b) =>
    (rank(b) < rank(a) || (rank(b) === rank(a) && b.chance > a.chance)) ? b : a);

  return {
    runs: pSomething > 0 ? 1 / pSomething : Infinity,
    odds: 1 - Math.pow(pNothing, Math.max(1, stock)),
    missing,
    bestSet: best.set,
    bestSetMissing: best.setMissing,
    bestSetTotal: best.setTotal,
    bestSetStarted: best.setStarted,
  };
}

/**
 * Textos ya formateados de un resultado, para que el componente solo los envuelva en HTML.
 * @param t textos del idioma activo: { runs, nothing, lastPart, missing }
 */
export function describeRelicRuns(r, t) {
  if (!Number.isFinite(r.runs)) return { none: t.nothing };
  return {
    runs: `≈${r.runs < 10 ? r.runs.toFixed(1) : Math.round(r.runs)} ${t.runs} · ${Math.round(r.odds * 100)}%`,
    // "faltan 2 de 5" dice mucho más que "faltan 2": sitúa lo que queda contra el tamaño
    // del set, que es lo que distingue un set casi hecho de uno sin empezar.
    set: `${r.bestSet} · ${r.bestSetMissing === 1 ? t.lastPart : `${t.missing} ${r.bestSetMissing}/${r.bestSetTotal}`}`,
    more: r.missing.length > 1 ? `+${r.missing.length - 1}` : "",
  };
}
