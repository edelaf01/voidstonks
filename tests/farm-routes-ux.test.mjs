import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FARM_ROUTES_TEXTS } from "../deploy/js/assets/farm_routes_texts.js";

/**
 * Claridad del panel "Rutas aconsejadas" (#farm-routes).
 *
 * El panel calculaba bien y se leía como jerga: tres colores sin explicar y una fila de
 * números ("ganas 45p · 120 p/h · ~22 min") sin decir de dónde salen ni cuál manda en el
 * orden. Lo que estos tests fijan es lo que un usuario tiene que poder averiguar sin
 * preguntar.
 */

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
    // El ternario es por la segunda vista ("por reliquia"), que tiene su propio subtítulo. Lo
    // que se fija es que SIEMPRE haya uno fuera de la guía, no cuál.
    assert.match(src, /class="fr-sub">\$\{escapeHTML\(esPicks \? t\.picksSubtitle : t\.subtitle\)\}/,
        "el subtítulo debe pintarse siempre, no dentro de la guía");
});

test("los tres estados de una pieza están explicados", () => {
    assertBilingual(["legendTitle", "legendReady", "legendWait", "legendNeed", "now", "waiting", "need"]);
    for (const key of ["ready", "wait", "need"]) {
        assert.match(src, new RegExp(`${key}:\\s*\\{\\s*cls:`), `falta el estado ${key} en STATES`);
    }
});

// El fallo que esto evita es el clásico de las leyendas: se añade un cuarto estado o se
// cambia un color en el render y la leyenda sigue describiendo el mundo de antes.
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
    // data-tooltip y no title: el nativo aparece bajo el cursor y no se puede posicionar, así
    // que en una lista de ~40 renglones tapaba las líneas siguientes mientras las leías. El de
    // la app tiene retardo, se clampa a la pantalla y no lo recorta el scroll de .fr-body.
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

// "No tienes nada a medias" cuando lo que pasa es que un filtro lo esconde manda a buscar el
// fallo al inventario. Pasó con un "máx. 1 pieza restante" heredado del panel de
// recomendaciones al fusionarlo: el panel decía que no había nada y había 155 rutas.
test("el vacío por filtros no se confunde con el vacío de verdad", () => {
    assertBilingual(["emptyFiltered", "emptyFilteredHint"]);
    assert.match(src, /_allRoutes\.length > 0 \? porQueVacio\(\)/);
    assert.match(src, /emptyFilteredHint \|\| ""\)\.replace\("\{n\}"/,
        "la pista tiene que decir CUÁNTAS rutas hay escondidas");
});

// Decir "la búsqueda o el máximo de piezas las esconden" obliga a probar los filtros a mano, y
// además callaba el que más esconde: buyOnly descarta toda ruta sin una pieza que compense
// comprar, así que con él puesto buscar un set concreto contesta que no existe.
test("el vacío por filtros nombra al filtro culpable", () => {
    assertBilingual([
        "emptyByQuery", "emptyByQueryHint",
        "emptyByMissing", "emptyByMissingHint",
        "emptyByBuy", "emptyByBuyHint",
    ]);
    // buyOnly es el único que se aplica DESPUÉS de los precios: si `matched` trae rutas y aun
    // así no se pinta ninguna, solo pudo ser él. Por eso se comprueba el primero.
    assert.match(src, /if \(matched\.length > 0\) \{\s*\n\s*return \[t\.emptyByBuy/,
        "con matched no vacío, el culpable solo puede ser buyOnly");
    assert.match(src, /emptyByBuyHint \|\| ""\)\.replace\("\{n\}", String\(matched\.length\)\)/,
        "hay que decir cuántas rutas hay detrás de ese filtro");
    assert.match(src, /emptyByQuery \|\| ""\)\.replace\("\{q\}", prefs\.query\)/,
        "la búsqueda sin resultados repite lo que se buscó");
});

// El panel se repinta solo cada 150 s al rotar las fisuras. Si el plegado o la guía vivieran
// en el DOM, el refresco los reabriría en la cara del usuario.
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

    // Abierto de serie: es el único bloque de la zona superior y plegado no aporta nada.
    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: false, guideOpen: false, view: "routes" },
        "de serie, abierto y en la vista de rutas");
    saveFarmRoutesPrefs({ guideOpen: true });
    // Guardar una sola clave no puede borrar la otra: son dos controles independientes.
    saveFarmRoutesPrefs({ collapsed: true });
    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: true, guideOpen: true, view: "routes" });

    store.set("vs_farm_routes_view_v1", "{no es json");
    assert.deepEqual(getFarmRoutesPrefs(), { collapsed: false, guideOpen: false, view: "routes" },
        "basura = valores de serie");
});

// La era no es solo un filtro: entra como `preferTier` al CONSTRUIR y decide qué reliquia se
// recomienda por pieza. Aplicándola sobre la lista ya montada, elegir Lith seguía enseñando la
// reliquia Meso — el fallo que preferTier existe para evitar, y que no se ve en ningún test de
// filtrado porque el filtro en sí acierta.
test("la era y el orden reconstruyen la lista, no la filtran", () => {
    assert.match(src, /preferTier: getSetRecsPrefs\(\)\.era/, "la era entra al construir");
    assert.match(src, /era\?\.addEventListener\("change", reconstruir\)/);
    assert.match(src, /sort\?\.addEventListener\("change", reconstruir\)/);
    assert.match(src, /const reconstruir = \(\) => \{[\s\S]*?guardar\(\);[\s\S]*?renderFarmRoutes\(\)/,
        "reconstruir guarda las prefs ANTES de volver a montar, o se pierde el cambio");
    // Y los que sí se pueden aplicar sobre lo ya montado no pagan una reconstrucción.
    for (const control of ["missing", "bestFor", "buy", "minPh", "minGain"]) {
        assert.match(src, new RegExp(`${control}\\?\\.addEventListener\\("change", aplicar\\)`),
            `${control} no necesita reconstruir la lista`);
    }
});

// "Sube el filtro para verlas" no dice hasta dónde: con 1 puesto y la ruta más cercana a 3 hay
// que ir probando valores para descubrir que no tienes nada tan cerca.
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

/** El cuerpo de filtersHtml de un fichero, que es donde viven los controles. */
function filtros(source) {
    const ini = source.indexOf("function filtersHtml");
    return source.slice(ini, source.indexOf("\n}\n", ini));
}

// Tres de estos textos (queryHelp, maxMissingHelp, buyOnlyHelp) llevaban escritos desde el
// panel de recomendaciones y NUNCA se enchufaron a un data-tooltip: existían en los dos
// idiomas, pasaban cualquier test de traducciones y no se veían en pantalla. Lo que se
// comprueba aquí es lo único que importa, que cada control lo lleve puesto.
test("cada filtro dice qué hace al pasar por encima", () => {
    for (const [nombre, source] of [["rutas", src], ["por reliquia", picksSrc]]) {
        const cuerpo = filtros(source);
        for (const tag of cuerpo.match(/<(select|input)\b[^>]*>/g) || []) {
            // Las casillas llevan el tooltip en su <label>: el cuadrito son 13px y el texto de
            // al lado es la mitad del control, así que en el input solo no se encuentra.
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

// "6 te sirven" es cierto y no sirve para elegir: con el inventario a medias lo cumplen casi
// todas. Lo que decide el clic —que esa apertura te CIERRE un set— tiene que estar en la fila
// con nombre y probabilidad, no solo dentro del orden.
test("la fila dice qué set cierra la reliquia", () => {
    assertBilingual(["picksSortBest", "picksCloses", "picksClosesTitle"]);
    assert.match(picksSrc, /p\.closes\?\.length > 0/, "la etiqueta solo sale si cierra algo");
    assert.match(picksSrc, /class="fr-closes"/);
    assert.match(picksSrc, /replace\("\{n\}", String\(Math\.round\(\(p\.closeOdds \|\| 0\) \* 100\)\)\)/,
        "con su probabilidad: 'cierra Nyx' al 2 % y al 52 % no son la misma decisión");
    // Y el orden de serie es ese mismo criterio, no el recuento de recompensas útiles.
    assert.match(picksSrc, /\["best", t\.picksSortBest\]/, "la opción existe en el desplegable");
    assert.match(picksSrc, /sortBy: sort\?\.value \|\| "best"/);
});

// Añadir reliquias no repintaba el panel: ni los +/- del inventario ni el escáner, que mete
// decenas de golpe. La lista seguía siendo la de antes hasta el refresco de 150 s, y como
// además las fisuras que fallan dejan todo en "esperando", parecía que se rompía solo.
test("el panel se entera de que ha cambiado el inventario de reliquias", () => {
    const inv = readFileSync(
        new URL("../deploy/js/ui.components/inventory/ui_inventory.js", import.meta.url), "utf8");
    const scan = readFileSync(
        new URL("../deploy/js/scanner/scanner_controller.js", import.meta.url), "utf8");

    assert.match(src, /export function scheduleFarmRoutesRefresh\(\)/);
    // Coalescido: los +/- se pulsan en ráfaga y cada pasada reconstruye las rutas enteras.
    assert.match(src, /if \(refreshTimer\) clearTimeout\(refreshTimer\)/);
    assert.match(src, /exposeGlobals\(\{ renderFarmRoutes, scheduleFarmRoutesRefresh \}/);

    // Por globalThis y no import: ui.js ya importa ui_inventory, y el inverso cierra el ciclo
    // que rompe la carga (ver tests/import-graph).
    for (const [nombre, fuente] of [["ui_inventory", inv], ["scanner_controller", scan]]) {
        assert.match(fuente, /globalThis\.scheduleFarmRoutesRefresh\?\.\(\)/,
            `${nombre} no avisa al panel`);
        assert.doesNotMatch(fuente, /from "..\/farms\/ui_farm_routes/,
            `${nombre} no puede importar el panel`);
    }
});

// Con la lista de fisuras vacía, CADA reliquia sale como "esperando fisura". Es falso cuando lo
// que ha pasado es que no se pudo preguntar, y el panel se quedaba así hasta el refresco de
// 150 s: el usuario lo ve como que se rompe hasta que cambias de pestaña y vuelves.
test("si las fisuras no cargan se dice, y se reintenta pronto", () => {
    assertBilingual(["fissuresDown"]);
    assert.match(src, /const sinFisuras = fissuresUnavailable\(\)/);
    assert.match(src, /if \(sinFisuras\) programarReintento\(\)/);
    assert.match(src, /sinFisuras \? `<p class="fr-nofis">/, "el aviso se pinta en el cuerpo");
    // Corto a propósito: el refresco normal es de 150 s.
    assert.match(src, /retryTimer = setTimeout\([\s\S]*?12 \* 1000\)/);
});

// La vista "por reliquia" se pintaba literalmente sin un solo filtro mientras la de rutas
// tenía nueve: con 60 reliquias en el inventario no había forma de llegar a una concreta.
test("la vista por reliquia tiene sus propios filtros", () => {
    for (const control of ["query", "era", "sort", "ready", "sim-refinement", "sim-squad"]) {
        assert.match(picksSrc, new RegExp(`data-rp="${control}"`), `falta el control ${control}`);
    }
    // Y los suyos, no los de rutas: allí las filas son sets (piezas restantes, platino por
    // hora) y aquí reliquias, así que compartir prefs dejaba esta vista vacía sin motivo visible.
    assert.match(picksSrc, /getRelicPicksPrefs\(\)/);
    assert.doesNotMatch(picksSrc, /getSetRecsPrefs/);
    assert.doesNotMatch(picksSrc, /localStorage/, "las prefs van por el service, no en el componente");
});
