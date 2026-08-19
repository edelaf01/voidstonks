import test from "node:test";
import assert from "node:assert/strict";
import { TEXTS, buscaClave } from "./_helpers/texts.mjs";
import { readFileSync } from "node:fs";
import { assertBilingual } from "./_helpers/orders-texts.mjs";

const P = new URL("../deploy/", import.meta.url);
const src = readFileSync(new URL("js/services/market/wfm_live_prices.service.js", P), "utf8");
const invSrc = readFileSync(new URL("js/ui.components/inventory/ui_inventory_live.js", P), "utf8");

test("solo cuentan las ventas de vendedores conectados", () => {
    assert.match(src, /type !== "sell"/, "debe descartar las compras");
    assert.match(src, /status === "offline"/, "debe descartar vendedores desconectados");
});

test("se queda con el listing más barato", () => {
    assert.match(src, /prev\.plat <= order\.platinum/, "debe conservar el mínimo");
});

test("el precio en vivo no pisa al precio base", () => {
    assert.match(invSrc, /price-live-tag/, "debe pintarse como etiqueta aparte");
    assert.ok(!/MEMORY_CACHE\?\.set/.test(src),
        "no debe escribir en la caché de precios base");
});

test("no sincroniza nada con el worker", () => {
    assert.ok(!/WORKER_URL/.test(src), "no debe llamar al worker para publicar precios");
    assert.ok(!/localStorage|sessionStorage/.test(src),
        "no debe persistirse: se pierde al recargar, que es lo correcto");
});

test("resuelve los ids una sola vez, no por cada orden", () => {
    assert.match(src, /idToSlug/, "debe cachear el mapa itemId -> slug");
    const handler = src.slice(src.indexOf("function handleOrder"), src.indexOf("export async function startLivePrices"));
    assert.ok(!/await|fetch\(/.test(handler),
        "handleOrder no puede pedir nada: se ejecuta decenas de veces por minuto");
});

test("arrancar es idempotente y tolera llamadas simultáneas", () => {
    assert.match(src, /if \(unsubscribe\) return true/, "no debe suscribirse dos veces");
    assert.match(src, /if \(starting\) return starting/,
        "dos llamadas a la vez deben compartir el mismo arranque");
});

test("el fallo de los precios en vivo no rompe el inventario", () => {
    const start = invSrc.indexOf("async function initLivePrices");
    assert.notEqual(start, -1, "falta initLivePrices");
    const body = invSrc.slice(start, start + 700);
    assert.match(body, /catch/, "debe capturar el fallo");
    assert.match(body, /liveHooked = false/, "un fallo debe permitir reintentar");
});

test("la animación respeta prefers-reduced-motion", () => {
    const css = readFileSync(new URL("css/components/inventory.css", P), "utf8");
    assert.match(css, /prefers-reduced-motion/, "debe poder desactivarse el destello");
});

function loadCheckStale(cache) {
    const start = src.indexOf("function checkStale");
    assert.notEqual(start, -1, "falta checkStale");
    let depth = 0, i = src.indexOf("{", start), j = i;
    while (j < src.length) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
        j++;
    }
    const ratio = Number(src.match(/STALE_RATIO = ([\d.]+)/)[1]);
    const minPlat = Number(src.match(/STALE_MIN_PLAT = (\d+)/)[1]);

    const marked = new Map();
    const fn = new Function("STALE_RATIO", "STALE_MIN_PLAT", "stale", "staleListeners", "globalThis",
        `return ${src.slice(start, j + 1)}`)(
        ratio, minPlat, marked, new Set(), { MEMORY_CACHE: cache });
    return { fn, marked };
}

test("un desvío grande marca el precio como desactualizado", () => {
    const { fn, marked } = loadCheckStale(new Map([["x", "100"]]));
    fn("x", 140);
    assert.ok(marked.has("x"), "un +40% sobre 100p debe marcarse");
    assert.equal(marked.get("x").diff.toFixed(2), "0.40");
});

test("una diferencia porcentual grande pero de pocos platino NO marca", () => {
    // real measured case: worker 8p, market 10p is +25% but only 2 platinum
    const { fn, marked } = loadCheckStale(new Map([["x", "8"]]));
    fn("x", 10);
    assert.ok(!marked.has("x"), "2p de diferencia no debe avisar aunque sea +25%");
});

test("volver a cuadrar retira la marca", () => {
    const { fn, marked } = loadCheckStale(new Map([["x", "100"]]));
    fn("x", 150);
    assert.ok(marked.has("x"), "primero se marca");
    fn("x", 105);
    assert.ok(!marked.has("x"), "debe dejar de avisar, no quedarse marcado para siempre");
});

test("sin precio del worker no se inventa un desvío", () => {
    for (const cached of [undefined, "0"]) {
        const { fn, marked } = loadCheckStale(new Map(cached === undefined ? [] : [["x", cached]]));
        fn("x", 50);
        assert.equal(marked.size, 0, `no debe marcar con cached=${cached}`);
    }
});

test("se compara contra el precio del worker, no contra otro cálculo", () => {
    assert.match(src, /MEMORY_CACHE/, "debe leer el precio que sirvió el worker");
    const store = readFileSync(new URL("js/repositories/storage.repository.js", P), "utf8");
    assert.match(store, /savePriceToCache[\s\S]{0,120}MEMORY_CACHE\.set/,
        "MEMORY_CACHE debe alimentarse del precio del worker");
});

test("el filtro no repinta el inventario", () => {
    const start = invSrc.indexOf("export function toggleStaleFilter");
    assert.notEqual(start, -1, "falta toggleStaleFilter");
    const body = invSrc.slice(start, start + 900);
    assert.ok(!/renderPrimeInventory\(\)/.test(body),
        "debe filtrar sobre el DOM ya pintado");
    assert.match(body, /is-price-stale/, "debe seleccionar por la marca");
});

test("el chip de precios se ve aunque no haya desvíos todavía", () => {
    const start = invSrc.indexOf("function refreshStaleChip");
    assert.notEqual(start, -1, "falta refreshStaleChip");
    const body = invSrc.slice(start, start + 1200);

    assert.ok(!/style\.display = n > 0/.test(body),
        "no debe ocultarse cuando el contador está a cero");
    assert.match(body, /is-empty/, "debe distinguir el estado 'vigilando'");
    assert.match(body, /staleChipWatching/, "debe decir que está vigilando");
});

test("los textos del chip están en los dos idiomas", () => {
    for (const key of ["staleChip", "staleChipTitle", "staleChipWatching", "staleChipWatchingTitle"]) {
        for (const lang of ["es", "en"]) {
            assert.ok(buscaClave(TEXTS[lang], key), `${key} debe estar en ${lang}`);
        }
    }
});

test("la diferencia de precio explica respecto a qué", () => {
    const orders = readFileSync(new URL("js/ui.components/market/ui_orders.js", P), "utf8");
    assert.match(orders, /delta\.title =/, "la cifra debe llevar explicación");
    assertBilingual(["deltaAbove", "deltaBelow"]);
});
