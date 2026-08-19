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
    for (const lang of ["es", "en"]) {
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{total\}/);
        assert.match(BRIDGE_TEXTS[lang].chipTitle, /\{set\}/);
        assert.match(BRIDGE_TEXTS[lang].showAll, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].count, /\{n\}/);
    }
});

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
        primeInventory: { "Gara A": 1 },
        getRequiredCount: () => 1,
    }, Number.MAX_SAFE_INTEGER);

    const enLaTira = rutas.filter((r) => r.missingCount < r.totalParts).map((r) => r.setName);
    assert.deepEqual(enLaTira, ["Gara Prime"]);
});

test("la tira no pide fisuras: no dice a dónde ir, solo cuánto falta", () => {
    assert.match(src, /fissures: \[\]/, "pedirlas ataría el pintado a la red sin usarlas");
    assert.doesNotMatch(src, /fetchAllFissures/);
});

test("el clic va por delegación y rellena el buscador", () => {
    const sets = readFileSync(
        new URL("../deploy/js/ui.components/inventory/ui_sets.js", import.meta.url), "utf8");
    assert.match(sets, /container\.dataset\.bridgeWired/, "la delegación se engancha una sola vez");
    assert.match(sets, /input\.value = setName;\s*\n\s*searchSet\(\);/,
        "pulsar un chip tiene que lanzar la búsqueda de ese set");
});

test("la tira se puede desplegar y dice cuántos hay en total", () => {
    assert.match(src, /const COLLAPSED_CHIPS = \d+/, "el recorte plegado es un tope, no el final");
    assert.match(src, /prefs\.expanded \? rutas : rutas\.slice\(0, COLLAPSED_CHIPS\)/);
    assert.match(src, /t\.count\.replace\("\{n\}", String\(todas\.length\)\)/,
        "el contador tiene que salir del total, no de los visibles ni de los filtrados");
    assert.match(src, /rutas\.length > COLLAPSED_CHIPS/, "el boton solo aparece si hay mas");
});

test("el orden y el desplegado persisten y repintan", () => {
    assert.match(src, /saveSetsBridgePrefs\(\{ sort: sel\.value \}\)/);
    assert.match(src, /saveSetsBridgePrefs\(\{ expanded: !prefs\.expanded \}\)/);
    assert.match(src, /sortBy: sort === "gain" \? "gain" : "near"/,
        "el orden se decide al construir, no despues");
});

test("el platino sale de la cache en memoria, no de la red", () => {
    assert.match(src, /globalThis\.MEMORY_CACHE\?\.get\(getSlug\(name\)\)/);
    assert.doesNotMatch(src, /^import .*getPriceValue/m);
});

test("la tira filtra por su cuenta, no con la búsqueda de la pestaña", () => {
    assert.match(src, /function aplicarFiltros\(rutas, prefs\)/);
    assert.match(src, /normalizeQuery\(r\.setName\)\.includes\(q\)/);
    assert.match(src, /r\.missingCount <= prefs\.maxMissing/);
    assert.match(src, /import \{ normalizeQuery, /);
});

test("filtrar hasta vaciar la tira lo dice, no la hace desaparecer", () => {
    assert.match(src, /className = "sets-bridge-empty"/);
    assert.match(src, /t\.emptyFiltered/);
    assert.match(src, /rutas\.length === todas\.length/,
        "el contador tiene que distinguir filtrado de total");
    assert.match(src, /t\.countFiltered\.replace/);
});

test("el filtro de era usa el mismo helper que el panel de rutas", () => {
    assert.match(src, /import \{ normalizeQuery, erasOf, RELIC_ERAS \}/);
    assert.match(src, /erasOf\(r, \(x\) => x\.missing\)\.has\(prefs\.era\)/);
    assert.doesNotMatch(src, /function erasDe/);
    assert.match(src, /\["", \.\.\.RELIC_ERAS\]/);
});

test("cada chip lleva el icono de su set", () => {
    assert.match(src, /getItemIcon\(r\.setName\)/);
    assert.match(src, /img\.addEventListener\("error", \(\) => img\.remove\(\)\)/);
});
