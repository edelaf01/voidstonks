// set recommendations based on active fissures: which relic to open now to complete a missing set
// everything here fails silently: a mismapped fissure simply stops recommending a set with no error
// visible numbers (estimated runs, "better to buy") come from game mechanics not obvious from code

import { test } from "node:test";
import assert from "node:assert/strict";

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const { state } = await import("../deploy/js/state.js");
const { MEMORY_CACHE } = await import("../deploy/js/repositories/storage.repository.js");
const {
  getFissureSetRecommendations,
  attachSetPrices,
  filterSetRecommendations,
  getSetRecsPrefs,
  saveSetRecsPrefs,
  erasOf,
} = await import("../deploy/js/services/inventory/set_recommendations.service.js");

const fisura = (tier, node, type = "Survival") => ({ tier, node, type });

/** minimal scenario: a 2-piece set with one piece owned and one missing */
function escenario({ refinement = "Rad", playerCount = 4 } = {}) {
  state.setsDatabase = { "Mag Prime": ["Mag Prime Neuroptics", "Mag Prime Chassis"] };
  state.itemsDatabase = {
    "Mag Prime Neuroptics": [{ tier: "Lith", ducats: 15, rarity: "Common", chance: 25.33 }],
    "Mag Prime Chassis": [{ tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 }],
  };
  state.primeInventory = { "Mag Prime Neuroptics": 1 };
  state.refinement = refinement;
  state.playerCount = playerCount;
}

test("solo se recomiendan sets a los que les falta alguna pieza", () => {
  escenario();
  const recs = getFissureSetRecommendations([fisura("Axi", "Xini")]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].setName, "Mag Prime");
  assert.deepEqual(recs[0].missingParts, ["Mag Prime Chassis"]);
  assert.equal(recs[0].totalParts, 2);

  state.primeInventory = { "Mag Prime Neuroptics": 1, "Mag Prime Chassis": 1 };
  assert.deepEqual(getFissureSetRecommendations([fisura("Axi", "Xini")]), []);
});

// sets requiring duplicate components: counting "owns any" marked them complete here while the routes
// panel (checking getRequiredCount) listed them as pending, showing conflicting status side by side
// uses its own set rather than escenario(): getRequiredCount caches by "set::piece" without invalidating,
// so reusing Mag Prime would poison counts for the rest of the file
test("una pieza que se pide por duplicado sigue faltando con una sola copia", () => {
  escenario();
  state.setsDatabase = { "Volt Prime": ["Volt Prime Neuroptics", "Volt Prime Chassis"] };
  state.itemsDatabase = {
    "Volt Prime Neuroptics": [{ tier: "Lith", ducats: 15, rarity: "Common", chance: 25.33 }],
    "Volt Prime Chassis": [{ tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 }],
  };
  state.primeManifest = [{
    name: "Volt Prime",
    components: [
      { name: "Neuroptics", itemCount: 1 },
      { name: "Chassis", itemCount: 2 },
    ],
  }];
  state.primeInventory = { "Volt Prime Neuroptics": 1, "Volt Prime Chassis": 1 };

  const recs = getFissureSetRecommendations([fisura("Axi", "Xini")]);
  assert.equal(recs.length, 1, "con 1 de 2 Chassis el set no está cerrado");
  assert.deepEqual(recs[0].missingParts, ["Volt Prime Chassis"]);

  state.primeInventory = { "Volt Prime Neuroptics": 1, "Volt Prime Chassis": 2 };
  assert.deepEqual(getFissureSetRecommendations([fisura("Axi", "Xini")]), []);

  state.primeManifest = [];
});

// game rule: Vanguard fissures belong to the Axi era; without the mapping, a player with an active
// Vanguard sees no Axi recommendations, appearing as if there is nothing to farm
test("una fisura Vanguard cuenta como Axi", () => {
  escenario();
  const recs = getFissureSetRecommendations([fisura("Vanguard", "Hepit")]);
  assert.equal(recs.length, 1, "Vanguard debe casar con las fuentes Axi");
  assert.equal(recs[0].matches[0].fissures[0].tier, "Vanguard", "se devuelve la fisura original");
});

test("una fisura de otra era no recomienda nada", () => {
  escenario();
  assert.deepEqual(getFissureSetRecommendations([fisura("Meso", "Io")]), []);
});

// a part can drop from multiple relics of the same era: without deduplicating by node+type, the same
// fissure appeared repeated for each relic dropping it
test("la misma fisura no se lista dos veces aunque la pieza salga de varias reliquias", () => {
  escenario();
  state.itemsDatabase["Mag Prime Chassis"] = [
    { tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 },
    { tier: "Axi", ducats: 100, rarity: "Rare", chance: 2 },
    { tier: "Vanguard", ducats: 100, rarity: "Rare", chance: 2 },
  ];
  const recs = getFissureSetRecommendations([fisura("Axi", "Xini", "Survival")]);
  assert.equal(recs[0].matches[0].fissures.length, 1);
});

test("el mismo nodo con dos tipos de misión sí son dos fisuras", () => {
  escenario();
  const recs = getFissureSetRecommendations([
    fisura("Axi", "Xini", "Survival"),
    fisura("Axi", "Xini", "Defense"),
  ]);
  assert.equal(recs[0].matches[0].fissures.length, 2);
});

// displayed count must match the player: solo with intact relics triples estimated runs compared to
// radiant in a 4-player squad
test("las runs estimadas usan TU refinamiento y TU escuadra", () => {
  escenario({ refinement: "Rad", playerCount: 4 });
  const conEscuadra = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;

  escenario({ refinement: "Intact", playerCount: 1 });
  const soloIntacta = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;

  assert.ok(soloIntacta > conEscuadra * 2,
    `en solitario e intacta deben ser muchas más runs (${soloIntacta} vs ${conEscuadra})`);
});

test("una escuadra fuera de rango se acota a 1..4", () => {
  escenario({ playerCount: 99 });
  const a = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;
  escenario({ playerCount: 4 });
  const b = getFissureSetRecommendations([fisura("Axi", "Xini")])[0].matches[0].avgRuns;
  assert.equal(a, b, "99 jugadores no puede dar mejor resultado que 4");
});

test("los sets a los que menos falta salen primero", () => {
  state.setsDatabase = {
    "Casi Completo": ["a1", "a2", "a3"],
    "Recién Empezado": ["b1", "b2", "b3"],
  };
  state.itemsDatabase = {
    a3: [{ tier: "Axi", ducats: 15 }],
    b1: [{ tier: "Axi", ducats: 15 }],
    b2: [{ tier: "Axi", ducats: 15 }],
    b3: [{ tier: "Axi", ducats: 15 }],
  };
  state.primeInventory = { a1: 1, a2: 1 };
  state.refinement = "Rad";
  state.playerCount = 4;

  const recs = getFissureSetRecommendations([fisura("Axi", "Xini")]);
  assert.deepEqual(recs.map((r) => r.setName), ["Casi Completo", "Recién Empezado"]);
});

test("sin fisuras activas o sin bases de datos no se inventa nada", () => {
  escenario();
  assert.deepEqual(getFissureSetRecommendations([]), []);
  assert.deepEqual(getFissureSetRecommendations(null), []);
  state.setsDatabase = null;
  assert.deepEqual(getFissureSetRecommendations([fisura("Axi", "Xini")]), []);
});

// "better to buy" only if the loose part costs <= 15 % of the complete set: this threshold separates
// useful advice from telling the user to buy at any price
test("una pieza barata frente al set se marca como mejor comprarla", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 10); // 10 % of the set

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].setPricePlat, 100);
  assert.equal(recs[0].matches[0].buyPricePlat, 10);
  assert.equal(recs[0].matches[0].betterToBuy, true);
});

test("una pieza cara frente al set NO se marca como mejor comprarla", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 40); // 40 % of the set

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].matches[0].betterToBuy, false);
});

test("sin precio conocido no se recomienda comprar", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 0);

  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(recs[0].matches[0].betterToBuy, false);
});

test("el filtro por piezas restantes y por 'solo comprar' acota la lista", async () => {
  escenario();
  MEMORY_CACHE.set("mag_prime_set", 100);
  MEMORY_CACHE.set("mag_prime_chassis", 10);
  const recs = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));

  assert.equal(filterSetRecommendations(recs, { maxMissing: 1, buyOnly: false }).length, 1);
  assert.equal(filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false }).length, 1,
    "maxMissing 0 significa sin límite");
  assert.equal(filterSetRecommendations(recs, { maxMissing: 1, buyOnly: true }).length, 1);

  MEMORY_CACHE.set("mag_prime_chassis", 40);
  const caros = await attachSetPrices(getFissureSetRecommendations([fisura("Axi", "Xini")]));
  assert.equal(filterSetRecommendations(caros, { maxMissing: 0, buyOnly: true }).length, 0,
    "con buyOnly, un set sin piezas que compense desaparece");
});

// preferences come from localStorage (external input): corrupt values must not empty recommendations or
// crash when opening the tab
test("unas preferencias corruptas caen a los valores por defecto", () => {
  const porDefecto = { maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0, sortBy: "near", era: "", bestFor: "" };
  for (const basura of ["{no es json", '{"maxMissing":"tres"}', '{"buyOnly":"sí"}', "null"]) {
    almacen.set("vs_fissure_set_recs_prefs", basura);
    assert.deepEqual(getSetRecsPrefs(), porDefecto, basura);
  }
  almacen.delete("vs_fissure_set_recs_prefs");
  assert.deepEqual(getSetRecsPrefs(), porDefecto);
});

test("las preferencias válidas se guardan y se releen", () => {
  saveSetRecsPrefs({ maxMissing: 2, buyOnly: true, query: "saryn", minPerHour: 100, minGain: 50, sortBy: "gain", era: "Neo", bestFor: "intact" });
  assert.deepEqual(getSetRecsPrefs(),
    { maxMissing: 2, buyOnly: true, query: "saryn", minPerHour: 100, minGain: 50, sortBy: "gain", era: "Neo", bestFor: "intact" });
});

test("umbrales inválidos se sanean a 0 y un orden desconocido cae al de serie", () => {
  almacen.set("vs_farm_routes_filters_v2", JSON.stringify(
    { minPerHour: null, minGain: -20, sortBy: "loQueSea", era: "Vanguard" }));
  const p = getSetRecsPrefs();
  assert.equal(p.minPerHour, 0);
  assert.equal(p.minGain, 0, "un umbral negativo no filtra nada, es no tenerlo");
  assert.equal(p.sortBy, "near");
  assert.equal(p.era, "", "una era inventada no filtra nada, es no tenerla");
});

// a route with no loaded price does not meet "100 p/h or more": the threshold is explicit, and slipping it
// through would show what the user asked to hide
test("los umbrales de platino esconden también lo que no se ha podido valorar", () => {
  const rutas = [
    { setName: "Cara", missingCount: 1, matches: [], platPerHour: 200, gain: 90 },
    { setName: "Barata", missingCount: 1, matches: [], platPerHour: 30, gain: 10 },
    { setName: "SinPrecio", missingCount: 1, matches: [], platPerHour: null, gain: null },
  ];
  const base = { maxMissing: 0, buyOnly: false, query: "" };
  const porHora = filterSetRecommendations(rutas, { ...base, minPerHour: 100, minGain: 0 });
  assert.deepEqual(porHora.map((r) => r.setName), ["Cara"]);
  const porGanancia = filterSetRecommendations(rutas, { ...base, minPerHour: 0, minGain: 50 });
  assert.deepEqual(porGanancia.map((r) => r.setName), ["Cara"]);
});

const recs = [
  { setName: "Saryn Prime", missingCount: 2, matches: [{ part: "Saryn Prime Chassis" }] },
  { setName: "Volt Prime", missingCount: 1, matches: [{ part: "Volt Prime Neuroptics" }] },
  { setName: "Ash Prime", missingCount: 3, matches: [{ part: "Ash Prime Systems" }] },
];

test("busca por el nombre del set", () => {
  const r = filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false, query: "saryn" });
  assert.deepEqual(r.map((x) => x.setName), ["Saryn Prime"]);
});

// typing "chassis" searches for sets missing a chassis rather than a set with that name
test("busca también en el nombre de las piezas", () => {
  const r = filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false, query: "neuroptics" });
  assert.deepEqual(r.map((x) => x.setName), ["Volt Prime"]);
});

test("no distingue mayúsculas ni acentos", () => {
  for (const q of ["SARYN", "sáryn", "  Saryn  "]) {
    const r = filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false, query: q });
    assert.equal(r.length, 1, `falló con ${JSON.stringify(q)}`);
  }
});

test("sin búsqueda no se filtra nada", () => {
  for (const q of ["", "   ", undefined, null]) {
    const r = filterSetRecommendations(recs, { maxMissing: 0, buyOnly: false, query: q });
    assert.equal(r.length, 3, `falló con ${JSON.stringify(q)}`);
  }
});

test("la búsqueda se combina con el resto de filtros", () => {
  const r = filterSetRecommendations(recs, { maxMissing: 1, buyOnly: false, query: "prime" });
  assert.deepEqual(r.map((x) => x.setName), ["Volt Prime"], "los tres llevan 'prime'; solo uno pasa el tope");
});

test("la búsqueda se persiste con el resto de preferencias", () => {
  saveSetRecsPrefs({ maxMissing: 2, buyOnly: true, query: "saryn" });
  const p = getSetRecsPrefs();
  assert.equal(p.query, "saryn");
  assert.equal(p.maxMissing, 2);
});

test("una preferencia corrupta no deja el panel sin filtro de nombre", () => {
  saveSetRecsPrefs({ maxMissing: 0, buyOnly: false, query: 42 });
  assert.equal(getSetRecsPrefs().query, "", "un número no es una búsqueda");
});

// slicing happens AFTER filtering: previously slicing happened first, keeping only sets missing the fewest
// parts; searching for a set outside that slice returned "no results", making search look broken
// tested on source because the operation order cannot be seen from the service; lives in ui_farm_routes.js
// since inventory panels merged

const uiSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../deploy/js/ui.components/farms/ui_farm_routes.js", import.meta.url), "utf8"));

test("la lista que se filtra son TODAS las rutas, sin recortar", () => {
  assert.match(uiSrc, /_allRoutes = buildFarmRoutes/, "hay que guardar la lista entera");
  assert.match(uiSrc, /Number\.MAX_SAFE_INTEGER/,
    "buildFarmRoutes recorta por su cuenta: hay que pedirle todas y recortar después de filtrar");
});

test("primero se filtra y luego se recorta", () => {
  const fn = uiSrc.slice(uiSrc.indexOf("async function applyFiltersAndRender"));
  const filtro = fn.indexOf("filterSetRecommendations(_allRoutes");
  const recorte = fn.indexOf(".slice(0, MAX_ROUTES)");
  assert.ok(filtro !== -1 && recorte !== -1, "faltan el filtro o el recorte");
  assert.ok(filtro < recorte, "el recorte tiene que ir después del filtro");
});

// prices cost one query per set: requesting all ~200 recommendations instead of the 12 rendered ruins cold
// start
test("los precios solo se piden para lo que se va a pintar", () => {
  const fn = uiSrc.slice(uiSrc.indexOf("async function applyFiltersAndRender"));
  assert.match(fn, /await attachSetPrices\(page, piezas\)/);
  assert.doesNotMatch(uiSrc, /attachSetPrices\(_allRoutes/, "no sobre la lista entera");
});

test("un repintado viejo no pisa al nuevo", () => {
  // typing quickly overlaps render passes that await prices; turns are tracked PER INSTANCE since the panel
  // renders in two places (Relic tab and sidebar); a module-level counter let instance 2 steal the turn,
  // causing instance 1 to abort upon receiving prices and miss its final repaint (the only pass applying
  // "buy only")
  assert.match(uiSrc, /const token = \(_renderTokens\.get\(raiz\) \|\| 0\) \+ 1/);
  assert.match(uiSrc, /_renderTokens\.set\(raiz, token\)/);
  assert.match(uiSrc, /if \(token !== _renderTokens\.get\(raiz\)\) return/);
});

// with a slow market (or 429 errors) attachSetPrices takes seconds: awaiting it left search blank while
// typing
test("el filtro pinta sin esperar a los precios", () => {
  const fn = uiSrc.slice(uiSrc.indexOf("async function applyFiltersAndRender"));
  const pintaAntes = fn.indexOf("if (!prefs.buyOnly) pintar(page)");
  const esperaPrecios = fn.indexOf("await attachSetPrices(page, piezas)");
  assert.ok(pintaAntes !== -1, "falta el pintado inmediato");
  assert.ok(pintaAntes < esperaPrecios, "el pintado tiene que ir antes de esperar precios");
  // except for "buy only": that filter IS price, and rendering early would show what the user asked to hide
  assert.match(fn, /prefs\.buyOnly \? filterSetRecommendations\(page, prefs, piezas\) : page/);
});

// era filter: answers "I have spare Lith, what can I progress with them?"; checks ALL relics for each
// component: a component drops across multiple eras, so keeping only the recommended relic hides sets
// progressable with that era
const conEras = [
  {
    setName: "Gara Prime", missingCount: 1,
    missing: [{ part: "Gara Prime Systems", relics: [
      { relic: "Meso P13", tier: "Meso" }, { relic: "Neo N20", tier: "Neo" },
    ] }],
  },
  {
    setName: "Nidus Prime", missingCount: 1,
    missing: [{ part: "Nidus Prime Neuroptics", relics: [{ relic: "Lith N4", tier: "Lith" }] }],
  },
];
const piezas = (r) => r.missing;
const sinFiltro = { maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0 };

test("la era mira todas las reliquias de la pieza, no solo la primera", () => {
  const neo = filterSetRecommendations(conEras, { ...sinFiltro, era: "Neo" }, piezas);
  assert.deepEqual(neo.map((r) => r.setName), ["Gara Prime"],
    "Neo es la SEGUNDA reliquia de esa pieza y tiene que contar igual");

  const lith = filterSetRecommendations(conEras, { ...sinFiltro, era: "Lith" }, piezas);
  assert.deepEqual(lith.map((r) => r.setName), ["Nidus Prime"]);
});

test("sin era elegida no se filtra nada", () => {
  const todo = filterSetRecommendations(conEras, { ...sinFiltro, era: "" }, piezas);
  assert.equal(todo.length, 2);
});

// fissure recommendations carry fissures instead of relics, and both have tier: the same helper handles
// both shapes passing through the filter
test("erasOf también entiende la forma de las recomendaciones de fisura", () => {
  const rec = { setName: "Volt Prime", matches: [{ part: "Volt Prime Chassis", fissures: [{ tier: "Axi" }] }] };
  assert.deepEqual([...erasOf(rec)], ["Axi"]);
});

// "best with <refinement>" filter: answers "what should I spend traces on?"; refining does not always win:
// it increases rare and uncommon drops but LOWERS common drops, so a set needing only commons is better
// intact, saving 100 traces per relic
const conRefino = [
  { setName: "Comunes", missingCount: 1, missing: [], bestRefinement: "intact" },
  { setName: "Raras", missingCount: 1, missing: [], bestRefinement: "radiant" },
  { setName: "SinEstimar", missingCount: 1, missing: [], bestRefinement: null },
];

test("bestFor deja solo las rutas que rinden con ESE refinamiento", () => {
  const base = { maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0, era: "" };
  const intactas = filterSetRecommendations(conRefino, { ...base, bestFor: "intact" }, (r) => r.missing);
  assert.deepEqual(intactas.map((r) => r.setName), ["Comunes"]);

  const radiantes = filterSetRecommendations(conRefino, { ...base, bestFor: "radiant" }, (r) => r.missing);
  assert.deepEqual(radiantes.map((r) => r.setName), ["Raras"]);
});

test("sin refinamiento elegido no se filtra, y lo no estimado no se cuela", () => {
  const base = { maxMissing: 0, buyOnly: false, query: "", minPerHour: 0, minGain: 0, era: "" };
  assert.equal(filterSetRecommendations(conRefino, { ...base, bestFor: "" }, (r) => r.missing).length, 3);
  // bestRefinement: null is not "any": it is unknown, so it does not satisfy an explicit filter
  const flawless = filterSetRecommendations(conRefino, { ...base, bestFor: "flawless" }, (r) => r.missing);
  assert.deepEqual(flawless, []);
});
