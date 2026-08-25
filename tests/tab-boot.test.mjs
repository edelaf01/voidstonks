// Recargar dentro de una pestaña dejaba media pestaña montada.
//
// switchTab() monta el contenido de la pestaña activa, y en el arranque corre ANTES de que
// bajen setsDatabase/itemsDatabase/manifiesto: cada inicializador se encontraba las bases
// vacías y se quedaba a medias. Solo se completaba al cambiar de pestaña y volver, que es
// cuando switchTab se ejecuta otra vez.
//
// El panel de rutas ya tenía su repintado propio al terminar la descarga; Set, Ducados, Riven,
// Vosfor, Órdenes y Farms no. Estos tests van sobre el fuente porque montar el DOM entero de
// la app para comprobar un orden de llamadas cuesta más que lo que protege.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../deploy/js/ui.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../deploy/js/main.js", import.meta.url), "utf8");

/** Sin comentarios: aquí se comprueba qué se LLAMA, y un `//` que nombre la función no cuenta. */
const sinComentarios = (txt) => txt.replaceAll(/^\s*\/\/.*$/gm, "");

/** El cuerpo de una función del fuente, hasta su cierre a nivel de columna 0. */
function cuerpo(src, firma) {
    const ini = src.indexOf(firma);
    assert.notEqual(ini, -1, `no se encuentra ${firma}`);
    return src.slice(ini, src.indexOf("\n}\n", ini));
}

test("montar una pestaña es una función aparte, no un bloque dentro de switchTab", () => {
    const init = cuerpo(ui, "function initTabContent(mode)");
    // Las siete pestañas que tienen algo que montar. Si se añade una y se deja solo en
    // switchTab, vuelve el bug: se monta al entrar pero no cuando llegan los datos.
    for (const [modo, llamada] of [
        ["riven", "initRivenMarketIndex"],
        ["relic", "renderFarmRoutes"],
        ["set", "searchSet"],
        ["vosfor", "initVosforTab"],
        ["ducat", "renderDucanatorTab"],
        ["orders", "initOrdersTab"],
        ["bounties", "renderFarmsTab"],
    ]) {
        assert.ok(init.includes(`"${modo}"`), `initTabContent no cubre ${modo}`);
        assert.ok(init.includes(llamada), `${modo} debería montar con ${llamada}`);
    }

    const switchBody = cuerpo(ui, "export function switchTab(mode)");
    assert.match(switchBody, /initTabContent\(mode\)/, "switchTab tiene que delegar");
    // Y no puede quedarse una copia suelta: dos sitios que montan lo mismo acaban divergiendo.
    assert.doesNotMatch(sinComentarios(switchBody), /renderFarmsTab\(\)/,
        "renderFarmsTab se fue a initTabContent; aquí solo queda el tema de la card");
});

test("al terminar la descarga se vuelve a montar la pestaña activa", () => {
    assert.match(ui, /export function refreshActiveTab\(\)/);
    assert.match(cuerpo(ui, "export function refreshActiveTab()"), /initTabContent\(state\.activeTab\)/);

    const carga = cuerpo(main, "async function loadAsyncData()");
    assert.match(carga, /refreshActiveTab\(\)/, "sin esto la pestaña se queda con las bases vacías");
    // Después de las descargas, no antes: llamarlo arriba repetiría el problema que arregla.
    assert.ok(carga.indexOf("await downloadRelics()") < carga.indexOf("refreshActiveTab()"),
        "refreshActiveTab tiene que ir DESPUÉS de downloadRelics");
    // El panel de rutas se pinta aparte porque también vive en el cajón de inventario, que se
    // abre desde cualquier pestaña.
    assert.match(carga, /renderFarmRoutes\(\)/);
});
