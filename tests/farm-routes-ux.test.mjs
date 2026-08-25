import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FARM_ROUTES_TEXTS } from "../deploy/js/assets/farm_routes_texts.js";

/** clarity of the "Suggested routes" panel (#farm-routes): what a user has to be able to work out without asking */

const src = readFileSync(
    new URL("../deploy/js/ui.components/farms/ui_farm_routes.js", import.meta.url), "utf8");

function assertBilingual(keys) {
    for (const key of keys) {
        for (const lang of ["es", "en"]) {
            const valor = FARM_ROUTES_TEXTS[lang][key];
            assert.equal(typeof valor, "string", `${key} falta en ${lang}`);
            assert.ok(valor.trim().length > 0, `${key} está vacío en ${lang}`);
        }
    }
}

test("el panel dice qué es sin tener que abrir nada", () => {
    assertBilingual(["title", "subtitle"]);
    assert.match(src, /class="fr-sub">\$\{escapeHTML\(esPicks \? t\.picksSubtitle : t\.subtitle\)\}/,
        "el subtítulo debe pintarse siempre, no dentro de la guía");
});

test("los tres estados de una pieza están explicados", () => {
    assertBilingual(["legendTitle", "legendReady", "legendWait", "legendNeed", "now", "waiting", "need"]);
    for (const key of ["ready", "wait", "need"]) {
        assert.match(src, new RegExp(`${key}:\\s*\\{\\s*cls:`), `falta el estado ${key} en STATES`);
    }
});

test("la leyenda y las piezas salen de la MISMA tabla de estados", () => {
    const guide = src.slice(src.indexOf("function guideHtml"), src.indexOf("function headHtml"));
    assert.match(guide, /STATES\[key\]/, "la leyenda debe leer STATES, no repetir los textos");
    assert.match(guide, /class="fr-state \$\{st\.cls\}"/, "el punto de la leyenda usa la clase del estado");

    const line = src.slice(src.indexOf("function partLineHtml"), src.indexOf("function routeHtml"));
    assert.match(line, /const st = STATES\[key\]/, "la pieza debe leer STATES");
    assert.match(line, /class="fr-state \$\{st\.cls\}"/, "el punto de la pieza usa la misma clase");
});

test("cada número de la tarjeta explica de dónde sale", () => {
    assertBilingual(["numbersTitle", "readProg", "readGain", "readPerHour", "readMins", "sortNote"]);
    // data-tooltip, not title: the native one shows under the cursor and covered the next lines of the list
    for (const anchor of ["readProg", "readGain", "readPerHour", "readMins"]) {
        assert.match(src, new RegExp(`data-tooltip="\\$\\{escapeHTML\\(t\\.${anchor}\\)\\}"`),
            `${anchor} debe aplicarse a un elemento de la tarjeta`);
    }
});

test("el estado vacío dice cuándo aparecerá algo", () => {
    assertBilingual(["empty", "emptyHint"]);
    assert.match(src, /_allRoutes\.length > 0 \? porQueVacio\(\) : \[t\.empty, t\.emptyHint\]/,
        "sin ninguna ruta calculada, el vacío es de verdad y no de filtros");
    assert.match(src, /escapeHTML\(titulo\)\}`\s*\+ `<br><span class="fr-dim">\$\{escapeHTML\(pista\)/);
});

test("el vacío por filtros no se confunde con el vacío de verdad", () => {
    assertBilingual(["emptyFiltered", "emptyFilteredHint"]);
    assert.match(src, /_allRoutes\.length > 0 \? porQueVacio\(\)/);
    assert.match(src, /emptyFilteredHint \|\| ""\)\.replace\("\{n\}"/,
        "la pista tiene que decir CUÁNTAS rutas hay escondidas");
});

test("el vacío por filtros nombra al filtro culpable", () => {
    assertBilingual([
        "emptyByQuery", "emptyByQueryHint",
        "emptyByMissing", "emptyByMissingHint",
        "emptyByBuy", "emptyByBuyHint",
    ]);
    assert.match(src, /if \(matched\.length > 0\) \{\s*\n\s*return \[t\.emptyByBuy/,
        "con matched no vacío, el culpable solo puede ser buyOnly");
    assert.match(src, /emptyByBuyHint \|\| ""\)\.replace\("\{n\}", String\(matched\.length\)\)/,
        "hay que decir cuántas rutas hay detrás de ese filtro");
    assert.match(src, /emptyByQuery \|\| ""\)\.replace\("\{q\}", prefs\.query\)/,
        "la búsqueda sin resultados repite lo que se buscó");
});

test("plegado y guía sobreviven al refresco automático", async () => {
    assert.match(src, /getFarmRoutesPrefs\(\)/, "el render debe leer las prefs guardadas");
    assert.match(src, /saveFarmRoutesPrefs\(\{ collapsed \}\)/);
    assert.match(src, /saveFarmRoutesPrefs\(\{ guideOpen: e\.target\.open \}\)/);
    assert.doesNotMatch(src, /localStorage/, "las prefs van por el service, no en el componente");

    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    };
    const { getFarmRoutesPrefs, saveFarmRoutesPrefs } =
        await import("../deploy/js/services/inventory/farm_routes.service.js");

    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: false, guideOpen: false, view: "routes" },
        "de serie, abierto y en la vista de rutas");
    saveFarmRoutesPrefs({ guideOpen: true });
    saveFarmRoutesPrefs({ collapsed: true });
    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: true, guideOpen: true, view: "routes" });

    store.set("vs_farm_routes_view_v1", "{no es json");
    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: false, guideOpen: false, view: "routes" },
        "basura = valores de serie");
});

test("la era y el orden reconstruyen la lista, no la filtran", () => {
    assert.match(src, /preferTier: getSetRecsPrefs\(\)\.era/, "la era entra al construir");
    assert.match(src, /era\?\.addEventListener\("change", reconstruir\)/);
    assert.match(src, /sort\?\.addEventListener\("change", reconstruir\)/);
    assert.match(src, /const reconstruir = \(\) => \{[\s\S]*?guardar\(\);[\s\S]*?renderFarmRoutes\(\)/,
        "reconstruir guarda las prefs ANTES de volver a montar, o se pierde el cambio");
    for (const control of ["missing", "bestFor", "buy", "minPh", "minGain"]) {
        assert.match(src, new RegExp(`${control}\\?\\.addEventListener\\("change", aplicar\\)`),
            `${control} no necesita reconstruir la lista`);
    }
});

test("el vacío por piezas restantes dice a cuánto está la más cercana", () => {
    assertBilingual(["emptyByMissingClosest"]);
    for (const lang of ["es", "en"]) {
        assert.ok(FARM_ROUTES_TEXTS[lang].emptyByMissingClosest.includes("{n}"),
            `emptyByMissingClosest debe llevar {n} en ${lang}`);
    }
    assert.match(src, /Math\.min\(\.\.\.sueltos\.map\(\(r\) => r\.missingCount\)\)/,
        "la distancia sale de las rutas que pasan el resto de filtros, no de todas");
    assert.match(src, /"maxMissing" in sin/, "solo ese filtro tiene una distancia que enseñar");
});

test("la lista no salta al principio cuando se repinta sola", () => {
    assert.match(src, /const scroll = body \? body\.scrollTop : 0/);
    assert.match(src, /newBody\.scrollTop = scroll/);
});

const picksSrc = readFileSync(
    new URL("../deploy/js/ui.components/farms/ui_relic_picks.js", import.meta.url), "utf8");

/** the filtersHtml body of a file, where the controls live */
function filtros(source) {
    const ini = source.indexOf("function filtersHtml");
    return source.slice(ini, source.indexOf("\n}\n", ini));
}

test("cada filtro dice qué hace al pasar por encima", () => {
    for (const [nombre, source] of [["rutas", src], ["por reliquia", picksSrc]]) {
        const cuerpo = filtros(source);
        for (const tag of cuerpo.match(/<(select|input)\b[^>]*>/g) || []) {
            if (tag.includes('type="checkbox"')) continue;
            assert.match(tag, /data-tooltip=/, `${nombre}: control sin tooltip -> ${tag.slice(0, 60)}`);
        }
        const labels = cuerpo.match(/<label class="lfg-checkbox-wrapper"[^>]*>/g) || [];
        assert.ok(labels.length > 0, `${nombre}: sin casillas que comprobar`);
        for (const l of labels) {
            assert.match(l, /data-tooltip=/, `${nombre}: casilla sin tooltip -> ${l}`);
        }
    }
});

test("los textos de los tooltips de filtros existen en los dos idiomas", () => {
    assertBilingual([
        "eraHelp", "simRefinementHelp", "simSquadHelp", "sortHelp", "minPerHourHelp", "minGainHelp",
        "picksQueryHelp", "picksEraHelp", "picksSortHelp", "picksReadyHelp",
    ]);
});

test("la fila dice qué set cierra la reliquia", () => {
    assertBilingual(["picksSortBest", "picksCloses", "picksClosesTitle"]);
    assert.match(picksSrc, /p\.closes\?\.length > 0/, "la etiqueta solo sale si cierra algo");
    assert.match(picksSrc, /class="fr-closes"/);
    assert.match(picksSrc, /replace\("\{n\}", String\(Math\.round\(\(p\.closeOdds \|\| 0\) \* 100\)\)\)/,
        "con su probabilidad: 'cierra Nyx' al 2 % y al 52 % no son la misma decisión");
    assert.match(picksSrc, /\["best", t\.picksSortBest\]/, "la opción existe en el desplegable");
    assert.match(picksSrc, /sortBy: sort\?\.value \|\| "best"/);
});

test("el panel se entera de que ha cambiado el inventario de reliquias", () => {
    const inv = readFileSync(
        new URL("../deploy/js/ui.components/inventory/ui_inventory.js", import.meta.url), "utf8");
    const scan = readFileSync(
        new URL("../deploy/js/scanner/scanner_controller.js", import.meta.url), "utf8");

    assert.match(src, /export function scheduleFarmRoutesRefresh\(\)/);
    assert.match(src, /if \(refreshTimer\) clearTimeout\(refreshTimer\)/);
    assert.match(src, /exposeGlobals\(\{ renderFarmRoutes, scheduleFarmRoutesRefresh \}/);

    // through globalThis, not import: ui.js already imports ui_inventory and the reverse closes the cycle (see tests/import-graph)
    for (const [nombre, fuente] of [["ui_inventory", inv], ["scanner_controller", scan]]) {
        assert.match(fuente, /globalThis\.scheduleFarmRoutesRefresh\?\.\(\)/,
            `${nombre} no avisa al panel`);
        assert.doesNotMatch(fuente, /from "..\/farms\/ui_farm_routes/,
            `${nombre} no puede importar el panel`);
    }
});

test("si las fisuras no cargan se dice, y se reintenta pronto", () => {
    assertBilingual(["fissuresDown"]);
    assert.match(src, /const sinFisuras = fissuresUnavailable\(\)/);
    assert.match(src, /if \(sinFisuras\) programarReintento\(\)/);
    assert.match(src, /sinFisuras \? `<p class="fr-nofis">/, "el aviso se pinta en el cuerpo");
    assert.match(src, /retryTimer = setTimeout\([\s\S]*?12 \* 1000\)/);
});

test("la vista por reliquia tiene sus propios filtros", () => {
    for (const control of ["query", "era", "sort", "ready", "sim-refinement", "sim-squad"]) {
        assert.match(picksSrc, new RegExp(`data-rp="${control}"`), `falta el control ${control}`);
    }
    assert.match(picksSrc, /getRelicPicksPrefs\(\)/);
    assert.doesNotMatch(picksSrc, /getSetRecsPrefs/);
    assert.doesNotMatch(picksSrc, /localStorage/, "las prefs van por el service, no en el componente");
});
