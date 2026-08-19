// Tira "los tienes a medias" de la pestaña Set.
//
// Es un puente de descubrimiento: la pestaña Set solo enseña lo que ya has escrito, así que sin
// esto no hay forma de enterarte de que te falta una pieza para cerrar algo. Lo que se prueba es
// QUÉ entra en la tira — si deja de filtrar, deja de ser un puente y pasa a ser el catálogo.

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
    // Sin los marcadores, la frase se pinta literal y sale "te faltan {n} de {total}".
    for (const lang of ["es", "en"]) {
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].someLeft, /\{total\}/);
        assert.match(BRIDGE_TEXTS[lang].chipTitle, /\{set\}/);
        assert.match(BRIDGE_TEXTS[lang].showAll, /\{n\}/);
        assert.match(BRIDGE_TEXTS[lang].count, /\{n\}/);
    }
});

// El filtro es la razón de ser de la tira. buildFarmRoutes devuelve TODOS los sets desde que se
// le quitó la puerta, así que sin este `filter` la tira ofrecería sets intactos al azar — que es
// justo lo que ya hace el carrusel de sets populares que tiene debajo.
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
        primeInventory: { "Gara A": 1 },   // Gara empezado; Nidus sin tocar
        getRequiredCount: () => 1,
    }, Number.MAX_SAFE_INTEGER);

    const enLaTira = rutas.filter((r) => r.missingCount < r.totalParts).map((r) => r.setName);
    assert.deepEqual(enLaTira, ["Gara Prime"]);
});

// Repetir el panel de rutas aquí sería mantener lo mismo dos veces y llenar de datos una pantalla
// que va de otra cosa: el plan (reliquia, fisura, runs, plat/hora) vive en la pestaña Reliquia.
test("la tira no pide fisuras: no dice a dónde ir, solo cuánto falta", () => {
    assert.match(src, /fissures: \[\]/, "pedirlas ataría el pintado a la red sin usarlas");
    assert.doesNotMatch(src, /fetchAllFissures/);
});

// Un listener por chip se queda colgando del DOM anterior: la tira se repinta en cada búsqueda.
test("el clic va por delegación y rellena el buscador", () => {
    const sets = readFileSync(
        new URL("../deploy/js/ui.components/inventory/ui_sets.js", import.meta.url), "utf8");
    assert.match(sets, /container\.dataset\.bridgeWired/, "la delegación se engancha una sola vez");
    assert.match(sets, /input\.value = setName;\s*\n\s*searchSet\(\);/,
        "pulsar un chip tiene que lanzar la búsqueda de ese set");
});

// Sin esto, la tira dice "tienes seis a medias" cuando tienes veintitrés: el tope era duro y no
// había forma de llegar al séptimo. El contador del título es el TOTAL, no lo que se ve.
test("la tira se puede desplegar y dice cuántos hay en total", () => {
    assert.match(src, /const COLLAPSED_CHIPS = \d+/, "el recorte plegado es un tope, no el final");
    assert.match(src, /prefs\.expanded \? rutas : rutas\.slice\(0, COLLAPSED_CHIPS\)/);
    assert.match(src, /t\.count\.replace\("\{n\}", String\(todas\.length\)\)/,
        "el contador tiene que salir del total, no de los visibles ni de los filtrados");
    assert.match(src, /rutas\.length > COLLAPSED_CHIPS/, "el boton solo aparece si hay mas");
});

// El orden cambia qué sube arriba, así que tiene que reconstruir: buildFarmRoutes ordena y
// luego recorta, y reordenar la lista ya recortada solo barajaría lo que ya se veía.
test("el orden y el desplegado persisten y repintan", () => {
    assert.match(src, /saveSetsBridgePrefs\(\{ sort: sel\.value \}\)/);
    assert.match(src, /saveSetsBridgePrefs\(\{ expanded: !prefs\.expanded \}\)/);
    assert.match(src, /sortBy: sort === "gain" \? "gain" : "near"/,
        "el orden se decide al construir, no despues");
});

// getPriceValue() devuelve una Promise: pasarla dejaba `gain` a null siempre, sin romper nada
// —o sea sin avisar—. La caché en memoria se lee sincrona.
test("el platino sale de la cache en memoria, no de la red", () => {
    assert.match(src, /globalThis\.MEMORY_CACHE\?\.get\(getSlug\(name\)\)/);
    // Se mira el IMPORT y no la palabra: el comentario del modulo nombra getPriceValue()
    // justo para explicar por que no se usa.
    assert.doesNotMatch(src, /^import .*getPriceValue/m);
});

// Con 155 sets a medias, "ver todos" son 155 chips: sin filtros propios la tira deja de ser
// navegable. Son SUYOS y no la búsqueda de arriba a propósito — si al escribir "saryn" la tira
// solo dejara Saryn, se acabaría el descubrimiento de rebote, que es su única razón de ser.
test("la tira filtra por su cuenta, no con la búsqueda de la pestaña", () => {
    assert.match(src, /function aplicarFiltros\(rutas, prefs\)/);
    assert.match(src, /normalizeQuery\(r\.setName\)\.includes\(q\)/);
    assert.match(src, /r\.missingCount <= prefs\.maxMissing/);
    // Se importa el normalizador del filtro de rutas en vez de recopiarlo: si divergen, un
    // buscador encuentra "Bo Prime" y el otro no.
    assert.match(src, /import \{ normalizeQuery, /);
});

// La tira sin chips parecía decir "ya no tienes nada a medias" cuando lo que pasaba era que el
// filtro los escondía. El contador dice "0 de 155" y el mensaje lo confirma.
test("filtrar hasta vaciar la tira lo dice, no la hace desaparecer", () => {
    assert.match(src, /className = "sets-bridge-empty"/);
    assert.match(src, /t\.emptyFiltered/);
    assert.match(src, /rutas\.length === todas\.length/,
        "el contador tiene que distinguir filtrado de total");
    assert.match(src, /t\.countFiltered\.replace/);
});

// "Tengo Lith de sobra, ¿qué avanzo con ellas?" es la pregunta que contesta el filtro de era, y
// solo funciona mirando TODAS las reliquias de cada pieza: una pieza cae de varias eras, así que
// quedarse con la recomendada (relics[0]) escondería sets que sí se avanzan con esa era.
test("el filtro de era usa el mismo helper que el panel de rutas", () => {
    // Una copia local acabaría discrepando con el panel de la pestaña Reliquia en qué cuenta
    // como "avanzable con Lith", y las dos listas dirían cosas distintas del mismo set.
    assert.match(src, /import \{ normalizeQuery, erasOf, RELIC_ERAS \}/);
    assert.match(src, /erasOf\(r, \(x\) => x\.missing\)\.has\(prefs\.era\)/);
    assert.doesNotMatch(src, /function erasDe/);
    // Y las eras salen de la constante compartida, no de una lista repetida a mano.
    assert.match(src, /\["", \.\.\.RELIC_ERAS\]/);
});

// Reconocer un warframe por su silueta es mas rapido que leer veinte nombres, que es justo lo
// que hay que hacer en una tira de 155. El onerror quita la imagen rota en vez de dejar el hueco.
test("cada chip lleva el icono de su set", () => {
    assert.match(src, /getItemIcon\(r\.setName\)/);
    assert.match(src, /img\.addEventListener\("error", \(\) => img\.remove\(\)\)/);
});
