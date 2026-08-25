import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDERS_TEXTS, assertBilingual } from "./_helpers/orders-texts.mjs";

/**
 * Claridad de la pestaña "Mis órdenes".
 *
 * Nace de dudas reales del usuario ("Off market +16 qué significa"): la lista mostraba
 * indicadores sin decir contra qué se comparan ni qué hacer con ellos.
 */

const P = new URL("../deploy/", import.meta.url);
const src = readFileSync(new URL("js/ui.components/market/ui_orders.js", P), "utf8");
// La pantalla de "en construcción" vive en su propio módulo: ui_orders.js ya está por
// encima del techo de 800 líneas y solo puede encoger.
const wip = readFileSync(new URL("js/ui.components/market/ui_orders_wip.js", P), "utf8");



test("la pestaña dice qué hace nada más entrar", () => {
    const start = src.indexOf("function tabHeader");
    assert.notEqual(start, -1, "falta la cabecera explicativa");
    assert.match(src, /root\.appendChild\(tabHeader\(\)\)/, "debe pintarse en la vista");
    assertBilingual(["tabWhat"]);
});

test("solo se anuncian las acciones que la sesión permite", () => {
    // Prometer "editar" o "publicar" con sesión pública sería peor que no listarlo:
    // el usuario lo intentaría y fallaría.
    const start = src.indexOf("function tabHeader");
    const body = src.slice(start, start + 900);
    assert.match(body, /getScope\(\) === "full"/, "debe distinguir por scope");
});

test("los indicadores del mercado explican contra qué se comparan", () => {
    // "Fuera de precio" y "+16" no dicen nada por sí solos.
    assertBilingual([
        "offMarketTitle", "competitiveTitle", "deltaAbove", "deltaBelow",
        "medianTitle", "volumeTitle", "bestTitle", "depthTitle",
        "liveTitle", "rankTitle"
    ]);

    // Se acepta tanto la asignación directa como el ternario (competitivo / fuera de precio).
    for (const anchor of ["offMarketTitle", "medianTitle", "bestTitle", "rankTitle", "liveTitle"]) {
        assert.match(src, new RegExp(`\\.title = [^;\\n]*\\b${anchor}\\b`),
            `${anchor} debe aplicarse a un elemento`);
    }
});

test("el estado vacío enseña el siguiente paso", () => {
    // "No tienes órdenes" a secas no ayuda: con sesión completa se pueden publicar
    // desde el inventario, y eso es lo que hay que decir.
    assertBilingual(["noOrdersHintFull"]);
    assert.match(src, /getScope\(\) === "full" \? t\.noOrdersHintFull/,
        "el texto debe depender de si se puede publicar");
});

test("el filtro sin resultados ofrece quitarlo", () => {
    // Dejar la lista muerta obliga a buscar a mano qué filtro la vació.
    assertBilingual(["clearFilters"]);
    assert.match(src, /stateBlock\("○", t\.noMatches, t\.clearFilters/,
        "debe ofrecer la acción, no solo constatar");
    assert.match(src, /filters\.query = ""/, "debe limpiar la búsqueda, no solo el tipo");
});

test("limpiar filtros repinta la barra, no solo la lista", () => {
    // El input de búsqueda vive en la barra: sin reconstruirla, el texto seguiría escrito
    // aunque el filtro ya no se aplique.
    const start = src.indexOf("t.clearFilters");
    const body = src.slice(start, start + 500);
    assert.match(body, /refreshAggregates\(\)/, "debe reconstruir la barra de filtros");
});

test("el aviso de privacidad va plegado, no dominando el login", () => {
    // El texto completo ocupaba más que el propio formulario y se leía antes que él:
    // transmitía más riesgo del que hay. Resumen visible, detalle a un clic.
    assert.match(src, /el\("details", "orders-disclaimer"\)/,
        "debe ser un desplegable, no un bloque suelto");
    assert.match(src, /el\("summary", "orders-disclaimer-head", t\.privacyShort\)/,
        "el resumen corto debe ser lo visible");
    assertBilingual(["privacyShort", "privacy"]);
});

test("el detalle sigue diciendo lo esencial", () => {
    // Plegarlo no puede convertirse en esconderlo: quien lo abra tiene que encontrar
    // qué se cifra, que la contraseña no se guarda y por qué pasa por el servidor.
    const es = ORDERS_TEXTS.es.privacy;
    for (const idea of ["cifran", "no se guardan", "contraseña"]) {
        assert.ok(es.includes(idea), `el texto debe mencionar "${idea}"`);
    }
});

test("la pestaña es solo el aviso 'en construcción', sin acceso", () => {
    // Hasta que warframe.market habilite OAuth, la versión web no puede ofrecer esto,
    // así que la pestaña no da forma de entrar: sería ofrecer algo que no funciona.
    assert.match(wip, /export function renderOrdersUnderConstruction/, "falta el aviso de construcción");

    const init = src.slice(src.indexOf("export function initOrdersTab"),
                           src.indexOf("export function initOrdersTab") + 260);
    assert.match(init, /renderOrdersUnderConstruction\(root\)/, "initOrdersTab debe pintar el aviso");
    assert.ok(!/loadOrders\(\)|setView\(/.test(init),
        "initOrdersTab no debe abrir la funcionalidad real");

    assertBilingual(["wipTitle", "wipText", "wipTooltip"]);
});

test("el aviso adelanta para qué servirá la pestaña", () => {
    // Solo el título y el motivo dejaban el viaje hasta la pestaña sin nada a cambio. Estas
    // cinco cadenas ya existían en los dos idiomas y no las pintaba nadie.
    assert.match(wip, /t\.tabWhat/, "debe decir qué será la pestaña");
    for (const cap of ["tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]) {
        assert.ok(wip.includes(cap), `falta la capacidad ${cap}`);
    }
    assertBilingual(["tabWhat", "tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]);
});

test("no quedan restos del toggle de preview", () => {
    // Se descartó: un toggle confundía al usuario común. Si vuelve algún resto, es
    // código muerto que engaña.
    for (const dead of ["wantsPreview", "setWantsPreview", "WIP_OPT_IN_KEY", "enterOrders",
                        "wipToggle", "wipExit", "wipNote"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});

test("el porqué va en un tooltip, no en un muro de texto", () => {
    // El mensaje visible es corto; el detalle (OAuth de terceros) se lee al pasar el ratón.
    assert.match(wip, /text\.title = t\.wipTooltip/, "el detalle debe ir en el title");
    // La pestaña de la barra superior también avisa sin entrar.
    const html = readFileSync(new URL("index.html", P), "utf8");
    assert.match(html, /id="btn-orders"[\s\S]*?data-tooltip=/, "el botón debe llevar tooltip");
    assert.match(html, /tab-wip-badge/, "el botón debe llevar el badge WIP");
});
