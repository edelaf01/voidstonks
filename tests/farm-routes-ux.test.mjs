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
