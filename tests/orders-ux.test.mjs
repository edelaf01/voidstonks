import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDERS_TEXTS, assertBilingual } from "./_helpers/orders-texts.mjs";

/**
 * clarity of the "My orders" tab, born from real user doubts ("Off market +16 what does it mean"): the
 * list showed indicators without saying what they compare against or what to do with them
 */

const P = new URL("../deploy/", import.meta.url);
const src = readFileSync(new URL("js/ui.components/market/ui_orders.js", P), "utf8");
// the "under construction" screen lives in its own module: ui_orders.js is over the 800-line cap and can
// only shrink
const wip = readFileSync(new URL("js/ui.components/market/ui_orders_wip.js", P), "utf8");



test("la pestaña dice qué hace nada más entrar", () => {
    const start = src.indexOf("function tabHeader");
    assert.notEqual(start, -1, "falta la cabecera explicativa");
    assert.match(src, /root\.appendChild\(tabHeader\(\)\)/, "debe pintarse en la vista");
    assertBilingual(["tabWhat"]);
});

test("solo se anuncian las acciones que la sesión permite", () => {
    // promising "edit" or "publish" with a public session is worse than not listing it: the user would try and
    // fail
    const start = src.indexOf("function tabHeader");
    const body = src.slice(start, start + 900);
    assert.match(body, /getScope\(\) === "full"/, "debe distinguir por scope");
});

test("los indicadores del mercado explican contra qué se comparan", () => {
    // "Off market" and "+16" say nothing on their own
    assertBilingual([
        "offMarketTitle", "competitiveTitle", "deltaAbove", "deltaBelow",
        "medianTitle", "volumeTitle", "bestTitle", "depthTitle",
        "liveTitle", "rankTitle"
    ]);

    // accepts both a direct assignment and the ternary (competitive / off market)
    for (const anchor of ["offMarketTitle", "medianTitle", "bestTitle", "rankTitle", "liveTitle"]) {
        assert.match(src, new RegExp(`\\.title = [^;\\n]*\\b${anchor}\\b`),
            `${anchor} debe aplicarse a un elemento`);
    }
});

test("el estado vacío enseña el siguiente paso", () => {
    // a bare "no orders" does not help: with a full session they can be published from the inventory, and that
    // is what to say
    assertBilingual(["noOrdersHintFull"]);
    assert.match(src, /getScope\(\) === "full" \? t\.noOrdersHintFull/,
        "el texto debe depender de si se puede publicar");
});

test("el filtro sin resultados ofrece quitarlo", () => {
    // leaving the list dead makes the user hunt for which filter emptied it
    assertBilingual(["clearFilters"]);
    assert.match(src, /stateBlock\("○", t\.noMatches, t\.clearFilters/,
        "debe ofrecer la acción, no solo constatar");
    assert.match(src, /filters\.query = ""/, "debe limpiar la búsqueda, no solo el tipo");
});

test("limpiar filtros repinta la barra, no solo la lista", () => {
    // the search input lives in the bar: without rebuilding it, the text would stay typed with the filter gone
    const start = src.indexOf("t.clearFilters");
    const body = src.slice(start, start + 500);
    assert.match(body, /refreshAggregates\(\)/, "debe reconstruir la barra de filtros");
});

test("el aviso de privacidad va plegado, no dominando el login", () => {
    // the full text was longer than the form and read before it, conveying more risk than there is: summary
    // visible, detail one click away
    assert.match(src, /el\("details", "orders-disclaimer"\)/,
        "debe ser un desplegable, no un bloque suelto");
    assert.match(src, /el\("summary", "orders-disclaimer-head", t\.privacyShort\)/,
        "el resumen corto debe ser lo visible");
    assertBilingual(["privacyShort", "privacy"]);
});

test("el detalle sigue diciendo lo esencial", () => {
    // folding must not become hiding: whoever opens it must find what is encrypted, that the password is not
    // stored and why it goes through the server
    const es = ORDERS_TEXTS.es.privacy;
    for (const idea of ["cifran", "no se guardan", "contraseña"]) {
        assert.ok(es.includes(idea), `el texto debe mencionar "${idea}"`);
    }
});

test("en la web la pestaña es solo el aviso 'en construcción'; la real, solo en local", () => {
    // until warframe.market enables OAuth the web version cannot offer this, so the tab offers no way in
    assert.match(wip, /export function renderOrdersUnderConstruction/, "falta el aviso de construcción");

    const init = src.slice(src.indexOf("export function initOrdersTab"),
                           src.indexOf("export function initOrdersTab") + 260);
    assert.match(init, /if \(wfmPrivado\(\)\) loadOrders\(\); else renderOrdersUnderConstruction\(root\)/,
        "fuera de localhost, initOrdersTab debe pintar el aviso");
    assert.ok(!/setView\(/.test(init), "initOrdersTab no debe abrir una vista por su cuenta");

    assertBilingual(["wipTitle", "wipText", "wipTooltip"]);
});

test("el aviso adelanta para qué servirá la pestaña", () => {
    // title and reason alone left the trip to the tab with nothing in return; these five strings already
    // existed in both languages and nothing painted them
    assert.match(wip, /t\.tabWhat/, "debe decir qué será la pestaña");
    for (const cap of ["tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]) {
        assert.ok(wip.includes(cap), `falta la capacidad ${cap}`);
    }
    assertBilingual(["tabWhat", "tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]);
});

test("no quedan restos del toggle de preview", () => {
    // dropped: a toggle confused the average user, and any leftover is misleading dead code
    for (const dead of ["wantsPreview", "setWantsPreview", "WIP_OPT_IN_KEY", "enterOrders",
                        "wipToggle", "wipExit", "wipNote"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});

test("el porqué va en un tooltip, no en un muro de texto", () => {
    // the visible message is short; the detail (third-party OAuth) shows on hover
    assert.match(wip, /text\.title = t\.wipTooltip/, "el detalle debe ir en el title");
    // the top bar tab also warns without entering
    const html = readFileSync(new URL("index.html", P), "utf8");
    assert.match(html, /id="btn-orders"[\s\S]*?data-tooltip=/, "el botón debe llevar tooltip");
    assert.match(html, /tab-wip-badge/, "el botón debe llevar el badge WIP");
});
