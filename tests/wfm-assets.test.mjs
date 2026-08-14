import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ASSETS = fileURLToPath(new URL("../deploy/assets/relic_contents/", import.meta.url));
const src = readFileSync(new URL("../deploy/js/utils/wfm_assets.js", import.meta.url), "utf8");
const ordersSrc = readFileSync(
    new URL("../deploy/js/ui.components/market/ui_orders.js", import.meta.url), "utf8");

function guessedAsset(name) {
    const lower = name.toLowerCase().trim();
    const slug = lower
        .replaceAll(/\s+&\s+/g, "__")
        .replaceAll(/[\s-]+/g, "_")
        .replaceAll(/[^a-z0-9_]/g, "");
    return `${slug}.webp`;
}

test("el caso que reportó el fallo sigue sin tener asset local", () => {
    assert.ok(!existsSync(ASSETS + guessedAsset("Hunter Munitions")),
        "no hay assets de mods: por eso hace falta comprobar antes de pintar");
});

test("los arcanos sí tienen asset local y deben preferirse al CDN", () => {
    // arcanes have ranks like mods, so 'maxRank' cannot decide icon origin; only file presence works
    assert.ok(existsSync(ASSETS + guessedAsset("Arcane Aegis")),
        "arcane_aegis.webp debería existir");
});

test("el icono local solo se pinta tras comprobar que carga", () => {
    assert.match(src, /onerror/, "debe detectar el asset que falta");
    assert.match(src, /new Image\(\)/, "la prueba va fuera del DOM, no en el <img> visible");
    assert.match(src, /localExists\.set/, "debe cachear el resultado por ruta");
});

test("la tarjeta no pisa la decisión de applyIcon con el thumb de WFM", () => {
    assert.ok(!/getAttribute\("src"\)/.test(ordersSrc),
        "no debe decidir mirando img.src justo después de applyIcon");
});

test("no se concatena dos veces la base de warframe.market", () => {
    assert.match(ordersSrc, /applyIcon\(img, name, order\.itemThumbPath\)/,
        "debe pasar la ruta relativa, no la ya prefijada");
});
