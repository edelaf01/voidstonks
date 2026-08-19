// "in progress" strip on the Set tab: a discovery bridge, since the Set tab only shows what was typed
// tests WHAT enters the strip: without filtering, it ceases being a bridge and becomes the catalog

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRIDGE_TEXTS } from "../deploy/js/assets/sets_bridge_texts.js";
import { buildFarmRoutes } from "../deploy/js/utils/inventory/relic_route.js";

const src = readFileSync(
    new URL("../deploy/js/ui.components/inventory/ui_sets_bridge.js", import.meta.url), "utf8");

test("los textos de la tira están en los dos idiomas", () => {
    const claves = ["title", "oneLeft", "someLeft", "chipTitle", "count",
        "sortNear", "sortGain", "sortLabel", "showAll", "showLess", "gainTag", "gainTitle",
        "filterPlaceholder", "filterLabel", "maxMissingLabel", "anyMissing",
        "countFiltered", "emptyFiltered", "eraLabel", "anyEra"];
    for (const key of claves) {
        for (const lang of ["es", "en"]) {
            const v = BRIDGE_TEXTS[lang][key];
            assert.equal(typeof v, "string", `${key} falta en ${lang}`);
            assert.ok(v.trim().length > 0, `${key} está vacío en ${lang}`);
        }
    }
    // without placeholders, the phrase renders literally as "you are missing {n} of {total}"
    for (const lang of ["es", "en"]) {
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{total\}/);
        assert.match(BRIDGE_TEXTS[lang].chipTitle, /\{set\}/);
        assert.match(BRIDGE_TEXTS[lang].showAll, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].count, /\{n\}/);
    }
});

// filtering is the strip's entire purpose: buildFarmRoutes returns ALL sets, so without this filter the
// strip would suggest random untouched sets, duplicating the popular sets carousel below
test("solo entran sets EMPEZADOS, no el catálogo entero", () => {
    assert.match(src, /\.filter\(\(r\) => r\.missingCount < r\.totalParts\)/,
        "la tira debe descartar los sets que no has tocado");

    const setsDatabase = {
        "Gara Prime": ["Gara A", "Gara B", "Gara C"],
        "Nidus Prime": ["Nidus A", "Nidus B"],
    };
    const itemsDatabase = Object.fromEntries(
        Object.values(setsDatabase).flat().map((p) => [p, [{ relic: "Lith A1", tier: "Lith", chance: 25 }]]));
    const rutas = buildFarmRoutes({
        setsDatabase, itemsDatabase, relicSources: {}, relicCounts: {}, fissures: [],
        primeInventory: { "Gara A": 1 },   // Gara started; Nidus untouched
        getRequiredCount: () => 1,
    }, Number.MAX_SAFE_INTEGER);

    const enLaTira = rutas.filter((r) => r.missingCount < r.totalParts).map((r) => r.setName);
    assert.deepEqual(enLaTira, ["Gara Prime"]);
});

// repeating the routes panel here duplicates maintenance and clutters a different screen: the plan (relic,
// fissure, runs, plat/hr) belongs on the Relic tab
test("la tira no pide fisuras: no dice a dónde ir, solo cuánto falta", () => {
    assert.match(src, /fissures: \[\]/, "pedirlas ataría el pintado a la red sin usarlas");
    assert.doesNotMatch(src, /fetchAllFissures/);
});

// a listener per chip leaks on previous DOM nodes: the strip repaints on every search
test("el clic va por delegación y rellena el buscador", () => {
    const sets = readFileSync(
        new URL("../deploy/js/ui.components/inventory/ui_sets.js", import.meta.url), "utf8");
    assert.match(sets, /container\.dataset\.bridgeWired/, "la delegación se engancha una sola vez");
    assert.match(sets, /input\.value = setName;\s*\n\s*searchSet\(\);/,
        "pulsar un chip tiene que lanzar la búsqueda de ese set");
});

// without this the strip says "six in progress" when you have twenty-three: a hard cap offered no way to
// reach the seventh; title counter is TOTAL, not visible count
test("la tira se puede desplegar y dice cuántos hay en total", () => {
    assert.match(src, /const COLLAPSED_CHIPS = \d+/, "el recorte plegado es un tope, no el final");
    assert.match(src, /prefs\.expanded \? rutas : rutas\.slice\(0, COLLAPSED_CHIPS\)/);
    assert.match(src, /t\.count\.replace\("\{n\}", String\(todas\.length\)\)/,
        "el contador tiene que salir del total, no de los visibles ni de los filtrados");
    assert.match(src, /rutas\.length > COLLAPSED_CHIPS/, "el boton solo aparece si hay mas");
});

// sorting changes what floats to the top, requiring a rebuild: buildFarmRoutes sorts before slicing, and
// re-sorting an already sliced list would only shuffle visible items
test("el orden y el desplegado persisten y repintan", () => {
    assert.match(src, /saveSetsBridgePrefs\(\{ sort: sel\.value \}\)/);
    assert.match(src, /saveSetsBridgePrefs\(\{ expanded: !prefs\.expanded \}\)/);
    assert.match(src, /sortBy: sort === "gain" \? "gain" : "near"/,
        "el orden se decide al construir, no despues");
});

// getPriceValue() returns a Promise: passing it left gain permanently null with no error; memory cache is
// read synchronously
test("el platino sale de la cache en memoria, no de la red", () => {
    assert.match(src, /globalThis\.MEMORY_CACHE\?\.get\(getSlug\(name\)\)/);
    // checks the IMPORT rather than bare text: module comments mention getPriceValue() to explain why it is
    // avoided
    assert.doesNotMatch(src, /^import .*getPriceValue/m);
});

// with 155 sets in progress, "view all" shows 155 chips: without its own filters the strip is unnavigable;
// intentionally INDEPENDENT of top search: typing "saryn" must not filter the strip to Saryn, killing
// serendipitous discovery
test("la tira filtra por su cuenta, no con la búsqueda de la pestaña", () => {
    assert.match(src, /function aplicarFiltros\(rutas, prefs\)/);
    assert.match(src, /normalizeQuery\(r\.setName\)\.includes\(q\)/);
    assert.match(src, /r\.missingCount <= prefs\.maxMissing/);
    // imports the route filter normalizer instead of copying it: divergence would cause one search to match
    // "Bo Prime" while the other misses it
    assert.match(src, /import \{ normalizeQuery, /);
});

// an empty strip implied nothing was in progress when filters were merely hiding items: counter says "0 of
// 155" and a message confirms it
test("filtrar hasta vaciar la tira lo dice, no la hace desaparecer", () => {
    assert.match(src, /className = "sets-bridge-empty"/);
    assert.match(src, /t\.emptyFiltered/);
    assert.match(src, /rutas\.length === todas\.length/,
        "el contador tiene que distinguir filtrado de total");
    assert.match(src, /t\.countFiltered\.replace/);
});

// "I have spare Lith, what can I progress with them?" is answered by the era filter, which only works by
// inspecting ALL relics per part: a part drops across multiple eras, so keeping only relics[0] hides
// progressable sets
test("el filtro de era usa el mismo helper que el panel de rutas", () => {
    // a local copy would diverge from the Relic tab on what counts as "progressable with Lith", causing
    // conflicting statuses for the same set
    assert.match(src, /import \{ normalizeQuery, erasOf, RELIC_ERAS \}/);
    assert.match(src, /erasOf\(r, \(x\) => x\.missing\)\.has\(prefs\.era\)/);
    assert.doesNotMatch(src, /function erasDe/);
    // eras come from the shared constant, not a duplicated manual list
    assert.match(src, /\["", \.\.\.RELIC_ERAS\]/);
});

// recognizing a warframe by silhouette is faster than reading twenty names across 155 chips; onerror
// removes broken images instead of leaving an empty slot
test("cada chip lleva el icono de su set", () => {
    assert.match(src, /getItemIcon\(r\.setName\)/);
    assert.match(src, /img\.addEventListener\("error", \(\) => img\.remove\(\)\)/);
});
