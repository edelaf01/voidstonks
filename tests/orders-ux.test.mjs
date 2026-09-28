import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDERS_TEXTS, assertBilingual } from "./_helpers/orders-texts.mjs";

const P = new URL("../deploy/", import.meta.url);
const src = readFileSync(new URL("js/ui.components/market/ui_orders.js", P), "utf8");
const wip = readFileSync(new URL("js/ui.components/market/ui_orders_wip.js", P), "utf8");



test("la pestaña dice qué hace nada más entrar", () => {
    const start = src.indexOf("function tabHeader");
    assert.notEqual(start, -1, "falta la cabecera explicativa");
    assert.match(src, /root\.appendChild\(tabHeader\(\)\)/, "debe pintarse en la vista");
    assertBilingual(["tabWhat"]);
});

test("solo se anuncian las acciones que la sesión permite", () => {
    const start = src.indexOf("function tabHeader");
    const body = src.slice(start, start + 900);
    assert.match(body, /getScope\(\) === "full"/, "debe distinguir por scope");
});

test("los indicadores del mercado explican contra qué se comparan", () => {
    assertBilingual([
        "offMarketTitle", "competitiveTitle", "deltaAbove", "deltaBelow",
        "medianTitle", "volumeTitle", "bestTitle", "depthTitle",
        "liveTitle", "rankTitle"
    ]);

    for (const anchor of ["offMarketTitle", "medianTitle", "bestTitle", "rankTitle", "liveTitle"]) {
        assert.match(src, new RegExp(`\\.title = [^;\\n]*\\b${anchor}\\b`),
            `${anchor} debe aplicarse a un elemento`);
    }
});

test("el estado vacío enseña el siguiente paso", () => {
    assertBilingual(["noOrdersHintFull"]);
    assert.match(src, /getScope\(\) === "full" \? t\.noOrdersHintFull/,
        "el texto debe depender de si se puede publicar");
});

test("el filtro sin resultados ofrece quitarlo", () => {
    assertBilingual(["clearFilters"]);
    assert.match(src, /stateBlock\("○", t\.noMatches, t\.clearFilters/,
        "debe ofrecer la acción, no solo constatar");
    assert.match(src, /filters\.query = ""/, "debe limpiar la búsqueda, no solo el tipo");
});

test("limpiar filtros repinta la barra, no solo la lista", () => {
    const start = src.indexOf("t.clearFilters");
    const body = src.slice(start, start + 500);
    assert.match(body, /refreshAggregates\(\)/, "debe reconstruir la barra de filtros");
});

test("el aviso de privacidad va plegado, no dominando el login", () => {
    assert.match(src, /el\("details", "orders-disclaimer"\)/,
        "debe ser un desplegable, no un bloque suelto");
    assert.match(src, /el\("summary", "orders-disclaimer-head", t\.privacyShort\)/,
        "el resumen corto debe ser lo visible");
    assertBilingual(["privacyShort", "privacy"]);
});

test("el detalle sigue diciendo lo esencial", () => {
    const es = ORDERS_TEXTS.es.privacy;
    for (const idea of ["cifran", "no se guardan", "contraseña"]) {
        assert.ok(es.includes(idea), `el texto debe mencionar "${idea}"`);
    }
});

test("en la web la pestaña es solo el aviso 'en construcción'; la real, solo en local", () => {
    // until warframe.market enables OAuth web cannot offer this, so the tab offers no way in
    assert.match(wip, /export function renderOrdersUnderConstruction/, "falta el aviso de construcción");

    const init = src.slice(src.indexOf("export function initOrdersTab"),
                           src.indexOf("export function initOrdersTab") + 260);
    assert.match(init, /if \(wfmPrivado\(\)\) loadOrders\(\); else renderOrdersUnderConstruction\(root\)/,
        "fuera de localhost, initOrdersTab debe pintar el aviso");
    assert.ok(!/setView\(/.test(init), "initOrdersTab no debe abrir una vista por su cuenta");

    assertBilingual(["wipTitle", "wipText", "wipTooltip"]);
});

test("el aviso adelanta para qué servirá la pestaña", () => {
    assert.match(wip, /t\.tabWhat/, "debe decir qué será la pestaña");
    for (const cap of ["tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]) {
        assert.ok(wip.includes(cap), `falta la capacidad ${cap}`);
    }
    assertBilingual(["tabWhat", "tabCanSell", "tabCanEdit", "tabCanClose", "tabCanWatch"]);
});

test("no quedan restos del toggle de preview", () => {
    for (const dead of ["wantsPreview", "setWantsPreview", "WIP_OPT_IN_KEY", "enterOrders",
                        "wipToggle", "wipExit", "wipNote"]) {
        assert.ok(!src.includes(dead), `${dead} debería haberse eliminado`);
    }
});

test("el porqué va en un tooltip, no en un muro de texto", () => {
    assert.match(wip, /text\.title = t\.wipTooltip/, "el detalle debe ir en el title");
    const html = readFileSync(new URL("index.html", P), "utf8");
    assert.match(html, /id="btn-orders"[\s\S]*?data-tooltip=/, "el botón debe llevar tooltip");
    assert.match(html, /tab-wip-badge/, "el botón debe llevar el badge WIP");
});
