import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../deploy/js/ui.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../deploy/js/main.js", import.meta.url), "utf8");

const sinComentarios = (txt) => txt.replaceAll(/^\s*\/\/.*$/gm, "");

function cuerpo(src, firma) {
    const ini = src.indexOf(firma);
    assert.notEqual(ini, -1, `no se encuentra ${firma}`);
    return src.slice(ini, src.indexOf("\n}\n", ini));
}

test("montar una pestaña es una función aparte, no un bloque dentro de switchTab", () => {
    const init = cuerpo(ui, "function initTabContent(mode)");
    for (const [modo, llamada] of [
        ["riven", "initRivenMarketIndex"],
        ["relic", "renderFarmRoutes"],
        ["set", "searchSet"],
        ["vosfor", "initVosforTab"],
        ["ducat", "renderDucanatorTab"],
        ["orders", "initOrdersTab"],
        ["bounties", "renderFarmsTab"],
        ["inventory", "renderInventory"],
    ]) {
        assert.ok(init.includes(`"${modo}"`), `initTabContent no cubre ${modo}`);
        assert.ok(init.includes(llamada), `${modo} debería montar con ${llamada}`);
    }

    const switchBody = cuerpo(ui, "export function switchTab(mode)");
    assert.match(switchBody, /initTabContent\(mode\)/, "switchTab tiene que delegar");
    assert.doesNotMatch(sinComentarios(switchBody), /renderFarmsTab\(\)/,
        "renderFarmsTab se fue a initTabContent; aquí solo queda el tema de la card");
});

test("al terminar la descarga se vuelve a montar la pestaña activa", () => {
    assert.match(ui, /export function refreshActiveTab\(\)/);
    assert.match(cuerpo(ui, "export function refreshActiveTab()"), /initTabContent\(state\.activeTab\)/);

    const carga = cuerpo(main, "async function loadAsyncData()");
    assert.match(carga, /refreshActiveTab\(\)/, "sin esto la pestaña se queda con las bases vacías");
    assert.ok(carga.includes("await downloadRelics(") && carga.indexOf("await downloadRelics(") < carga.indexOf("refreshActiveTab()"),
        "refreshActiveTab tiene que ir DESPUÉS de downloadRelics");
    assert.ok(carga.includes("await armasDeRiven") && carga.indexOf("await armasDeRiven") < carga.indexOf("refreshActiveTab()"),
        "la pestaña de Riven necesita las armas antes de montarse");
    assert.match(carga, /renderFarmRoutes\(\)/);
});
