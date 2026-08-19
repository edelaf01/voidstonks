import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Iconos de la pestaña de órdenes.
 *
 * Nace de un fallo real: "Cannot GET /deploy/assets/relic_contents/hunter_munitions.webp".
 * getItemIcon resuelve contenido de RELIQUIAS y devuelve una ruta siempre, exista o no,
 * así que con un mod inventaba un asset inexistente y el icono salía roto.
 */

const ASSETS = fileURLToPath(new URL("../deploy/assets/relic_contents/", import.meta.url));
const src = readFileSync(new URL("../deploy/js/utils/wfm_assets.js", import.meta.url), "utf8");
const ordersSrc = readFileSync(
    new URL("../deploy/js/ui.components/market/ui_orders.js", import.meta.url), "utf8");

/** Reproduce el slug que getItemIcon genera para un nombre sin caso especial. */
function guessedAsset(name) {
    const lower = name.toLowerCase().trim();
    const slug = lower
        .replaceAll(/\s+&\s+/g, "__")
        .replaceAll(/[\s-]+/g, "_")
        .replaceAll(/[^a-z0-9_]/g, "");
    return `${slug}.webp`;
}

test("el caso que reportó el fallo sigue sin tener asset local", () => {
    // Si algún día se añaden iconos de mods, este test avisa de que la precarga
    // ya no es necesaria para ellos.
    assert.ok(!existsSync(ASSETS + guessedAsset("Hunter Munitions")),
        "no hay assets de mods: por eso hace falta comprobar antes de pintar");
});

test("los arcanos sí tienen asset local y deben preferirse al CDN", () => {
    // Contraejemplo importante: tienen rango como los mods, así que 'maxRank' no vale
    // como señal para decidir el origen del icono. Solo sirve mirar si el archivo está.
    assert.ok(existsSync(ASSETS + guessedAsset("Arcane Aegis")),
        "arcane_aegis.webp debería existir");
});

test("el icono local solo se pinta tras comprobar que carga", () => {
    assert.match(src, /onerror/, "debe detectar el asset que falta");
    assert.match(src, /new Image\(\)/, "la prueba va fuera del DOM, no en el <img> visible");
    // Sin cachear, cada tarjeta del mismo ítem repetiría la comprobación.
    assert.match(src, /localExists\.set/, "debe cachear el resultado por ruta");
});

test("la tarjeta no pisa la decisión de applyIcon con el thumb de WFM", () => {
    // applyIcon resuelve en asíncrono: al volver, img.src sigue vacío. La comprobación
    // 'if (!img.getAttribute("src"))' que había antes forzaba SIEMPRE el CDN y anulaba
    // la preferencia por el asset local.
    assert.ok(!/getAttribute\("src"\)/.test(ordersSrc),
        "no debe decidir mirando img.src justo después de applyIcon");
});

test("no se concatena dos veces la base de warframe.market", () => {
    // itemThumb ya viene absoluta desde el servicio; applyIcon espera la relativa.
    assert.match(ordersSrc, /applyIcon\(img, name, order\.itemThumbPath\)/,
        "debe pasar la ruta relativa, no la ya prefijada");
});
