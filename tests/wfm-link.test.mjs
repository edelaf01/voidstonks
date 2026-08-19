import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionalSource } from "./_helpers/optional-source.mjs";
import { TEXTS, buscaClave } from "./_helpers/texts.mjs";
import { assertBilingual } from "./_helpers/orders-texts.mjs";

/**
 * bridge between local inventory and warframe.market
 * matching depends on getSlug producing slugs WFM recognizes: verified against the real catalog (3837
 * items), all 98 prime sets in the repo resolve
 * tests avoid network calls but pin the parts that would fail matching silently
 */

const P = new URL("../deploy/", import.meta.url);
const linkSrc = readFileSync(new URL("js/services/market/wfm_link.service.js", P), "utf8");
const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));

const { getSlug } = await import(new URL("js/utils/slugs.utils.js", P).href)
    .catch(async () => {
        // slugs.utils.js imports state.js, which pulls in the DOM: evaluated standalone
        const src = readFileSync(new URL("js/utils/slugs.utils.js", P), "utf8")
            .replace(/^import .*$/m, "");
        return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
    });

test("los sets del inventario producen el slug que usa WFM", () => {
    // verified against the real catalog: these five cover the cases that break a naive slugifier (ampersand,
    // name WFM lengthens, compound suffix)
    const cases = {
        "Ash Prime Set": "ash_prime_set",
        "Mag Prime Set": "mag_prime_set",
        "Silva & Aegis Prime Set": "silva_and_aegis_prime_set",
        "Kavasa Prime Set": "kavasa_prime_kubrow_collar_set",
        "Kompressa Prime Set": "kompressa_prime_set"
    };
    for (const [name, slug] of Object.entries(cases)) {
        assert.equal(getSlug(name), slug, `${name} debe resolver a ${slug}`);
    }
});

test("cada fuente declara qué slugs reconoce como suyos", () => {
    // without owns(), an order of an unsupported type (a mod) would show as "you no longer own it" and the
    // user would cancel good orders
    assert.match(linkSrc, /owns:/, "las fuentes deben declarar owns()");
    assert.ok(!/function isTracked\(slug\) \{\s*return slug\.endsWith/.test(linkSrc),
        "isTracked no debe hardcodear el sufijo: rompería al añadir mods");
});

test("solo las órdenes de venta se cruzan con el inventario", () => {
    // a buy order does not mean you own the item: counting it would mark it as listed and it would never
    // appear for sale
    assert.match(linkSrc, /=== "sell"/, "debe filtrar por tipo de orden");
});

test("publicar una orden valida el itemId antes de llegar a WFM", () => {
    const start = workerSrc.indexOf("async 'wfm_order_create'");
    assert.notEqual(start, -1, "falta el handler de creación");
    const body = workerSrc.slice(start, start + 2000);

    assert.match(body, /\[a-f0-9\]\{24\}/, "el itemId debe validarse como ObjectId");
    assert.match(body, /Invalid type/, "el tipo debe restringirse a sell/buy");
    assert.match(body, /Number\.isInteger\(platinum\)/, "el precio debe ser entero");
    assert.match(body, /isTrustedOrigin/, "crear órdenes es sensible: guard de origen");
});

test("la ruta de creación nunca se cachea", () => {
    // carries the user's JWT: serving it from the shared cache would leak between accounts
    const publicRoutes = workerSrc.match(
        /skipGlobalCache[\s\S]{0,400}?startsWith\("wfm_"\) && !\[([^\]]*)\]/);
    assert.ok(publicRoutes, "debe existir la allowlist de rutas cacheables");
    assert.ok(!publicRoutes[1].includes("wfm_order_create"),
        "wfm_order_create no puede estar entre las cacheables");
});

test("resolver ids por slug se cachea por ítem", () => {
    const start = workerSrc.indexOf("async 'wfm_ids'");
    assert.notEqual(start, -1, "falta el handler wfm_ids");
    const body = workerSrc.slice(start, start + 1500);
    // without per-item caching, each user would redownload the 1.4MB catalog
    assert.match(body, /EdgeCache\.get/, "debe reutilizar entradas por ítem");
    assert.match(body, /isValidSlug/, "los slugs deben validarse antes de la URL");
});

const ordersSrc = readFileSync(new URL("js/ui.components/market/ui_orders.js", P), "utf8");
const trackerSrc = readFileSync(new URL("js/ui.components/inventory/ui_set_tracker.js", P), "utf8");

test("los botones 'Vender' tienen su función publicada", () => {
    // global-registry.test.mjs only checks handlers in index.html; these are generated from JS, so it misses
    // them: twice a button was left without an implementation, only noticed on click
    const invSrc = readFileSync(new URL("js/ui.components/inventory/ui_inventory.js", P), "utf8");

    assert.match(trackerSrc, /globalThis\.sellSetFromInventory\(/,
        "el tracker de sets debe invocarla");
    assert.match(invSrc, /globalThis\.sellSetFromInventory\?\./,
        "el inventario debe invocarla");
    assert.match(ordersSrc, /exposeGlobals\(\s*\{[^}]*sellSetFromInventory/,
        "sellSetFromInventory debe publicarse en el registro");
});

test("el botón del inventario publica de verdad, no solo redirige", () => {
    // redirecting to another tab forces searching for the item again; the button must end up creating a listed
    // order
    const start = ordersSrc.indexOf("export async function sellSetFromInventory");
    assert.notEqual(start, -1, "falta sellSetFromInventory");
    const body = ordersSrc.slice(start, start + 1600);
    assert.match(body, /resolveIds/, "debe resolver el itemId");
    assert.match(body, /fetchMarketBatch/, "debe traer precio de referencia");
    assert.match(body, /openSellModal/, "debe confirmar precio antes de publicar");
    assert.match(ordersSrc, /createSellOrder\(\{/, "debe acabar publicando");
});

test("el puente al mercado no importa ui.js", () => {
    assert.ok(!/from "\.\.\/ui\.js"/.test(ordersSrc),
        "ui_orders.js no debe importar ui.js");
    assert.match(ordersSrc, /globalThis\.switchTab/,
        "switchTab debe llamarse por globalThis");
});

test("publicar desde el inventario se oculta sin sesión completa", () => {
    // offering a button that always fails is worse than explaining why it is missing
    const start = ordersSrc.indexOf("function inventorySection(");
    assert.notEqual(start, -1, "falta inventorySection");
    const body = ordersSrc.slice(start, start + 600);
    assert.match(body, /getScope\(\) !== "full"/, "debe comprobar el scope");
});

test("los textos nuevos existen en los dos idiomas", () => {
    for (const key of ["sellSet", "sellSetTitle"]) {
        for (const lang of ["es", "en"]) {
            assert.ok(buscaClave(TEXTS[lang], key), `${key} debe estar en ${lang}`);
        }
    }
    assertBilingual(["sectionInv", "invSell", "invNeedFull", "errPublish", "errGeneric"]);
});

const ordersSvc = readFileSync(new URL("js/services/market/wfm_orders.service.js", P), "utf8");

test("los ids se resuelven en tandas, no todos de golpe", () => {
    // 76 ids in a single request returned 500: each uncached item costs a worker write and suddenly exceeds
    // Cloudflare's subrequest limit
    assert.match(ordersSvc, /RESOLVE_CHUNK/, "debe existir un tamaño de tanda");
    const chunk = Number(ordersSvc.match(/RESOLVE_CHUNK = (\d+)/)?.[1]);
    assert.ok(chunk > 0 && chunk <= 30, `tanda de ${chunk}: debe dejar margen de subrequests`);
    assert.match(linkSrc, /i \+= 25/, "resolveIds también debe trocear");
});

test("el worker acota cuántas entradas cachea por petición", () => {
    assert.match(workerSrc, /putMany\(ctx, /, "debe usar el cupo, no put suelto en bucle");
    // budget must stay below the limit of 50 subrequests per invocation, shared by cache reads and writes
    const budget = Number(workerSrc.match(/SUBREQUEST_BUDGET = (\d+)/)?.[1]);
    assert.ok(budget > 0 && budget < 50, `cupo ${budget}: debe quedar por debajo de 50`);
    // each specific call must ask for even less, leaving room for fetches
    const calls = [...workerSrc.matchAll(/putMany\(ctx, \w+, \d+, (\d+)\)/g)].map(m => Number(m[1]));
    for (const c of calls) assert.ok(c <= 15, `escritura con cupo ${c}: demasiado alto`);
});

test("la sección de inventario reutiliza las órdenes ya cargadas", () => {
    // syncInventory() without arguments repeated fetchMyOrders AND its wfm_resolve: the tab made twice the
    // calls on each open
    assert.match(ordersSrc, /syncInventory\(orders\)/,
        "debe pasar las órdenes ya cargadas");
    assert.match(linkSrc, /export async function syncInventory\(orders = null\)/,
        "syncInventory debe aceptarlas");
});

test("las rutas que la app llama existen en el worker", () => {
    // prime_items_list and profile disappeared from the worker and the app stopped loading items with only a
    // 500: this check catches it without deploying
    const repo = readFileSync(new URL("js/repositories/api.repository.js", P), "utf8");
    const called = new Set([...repo.matchAll(/type=([a-z_0-9]+)/g)].map(m => m[1]));
    const defined = new Set([...workerSrc.matchAll(/async '([a-z_0-9]+)'/g)].map(m => m[1]));

    const missing = [...called].filter(t => !defined.has(t));
    assert.deepEqual(missing, [], `el worker no implementa: ${missing.join(", ")}`);
});

test("el inventario consulta el estado de publicación sin pedir nada a la red", () => {
    // set tracker is a view of LOCAL data: must not depend on the API to render; queries the last run via
    // globalThis, rendering nothing if absent
    const primeSrc = readFileSync(new URL("js/ui.components/inventory/ui_prime_inventory.js", P), "utf8");
    for (const [name, s] of [["ui_set_tracker.js", trackerSrc], ["ui_prime_inventory.js", primeSrc]]) {
        assert.match(s, /globalThis\.isSetListed\?\./,
            `${name} debe consultarlo por globalThis, no importando el servicio`);
        assert.ok(!/wfm_link\.service/.test(s),
            `${name} no debe importar el servicio del puente`);
    }
    assert.match(ordersSrc, /exposeGlobals\(\s*\{[^}]*isSetListed/,
        "isSetListed debe publicarse en el registro");
});

test("isSetListed responde en síncrono", () => {
    // called by an onclick in the tracker, which cannot wait for a dynamic import
    const start = ordersSrc.indexOf("export function isSetListed");
    assert.notEqual(start, -1, "falta isSetListed");
    const body = ordersSrc.slice(start, start + 200);
    assert.ok(!body.includes("await"), "no puede ser async: la invoca un handler inline");
});

test("publicar refresca el estado al momento", () => {
    // without this the badge would keep saying "sin publicar" until the next full sync
    assert.match(linkSrc, /listedSlugs\.add\(spec\.slug\)/,
        "createSellOrder debe reflejar la publicación");
    assert.match(ordersSrc, /slug: item\.slug/,
        "la UI debe pasar el slug al publicar");
});

test("los textos del badge existen en los dos idiomas", () => {
    for (const key of ["setListed", "setListedTitle"]) {
        for (const lang of ["es", "en"]) {
            assert.ok(buscaClave(TEXTS[lang], key), `${key} debe estar en ${lang}`);
        }
    }
});

test("el modal dice explícitamente que la orden es real", () => {
    // publishing has a public effect on an external account: the user must know what will happen before
    // confirming, not after
    const start = ordersSrc.indexOf("function openSellModal");
    assert.notEqual(start, -1, "falta openSellModal");
    const body = ordersSrc.slice(start, start + 2500);
    assert.match(body, /sellConfirmWarn/, "debe mostrar el aviso");
    assert.match(body, /sellConfirmBtn/, "el botón debe decir qué hace, no solo 'Vender'");

    assertBilingual(["sellConfirmWarn"]);
});

test("la falta de sesión se avisa antes de pedir datos", () => {
    // finding out you cannot list after picking a price is a waste of time
    const start = ordersSrc.indexOf("export async function sellSetFromInventory");
    const body = ordersSrc.slice(start, start + 2000);

    const guardAt = body.indexOf("openSessionWarning");
    const fetchAt = body.indexOf("resolveIds");
    assert.notEqual(guardAt, -1, "debe comprobar la sesión");
    assert.ok(guardAt < fetchAt, "el guard debe ir antes de pedir nada a la red");

    // modal, not toast: a toast disappears without explaining what to do
    assert.match(ordersSrc, /function openSessionWarning\(text, hint\)/);
    assert.match(ordersSrc, /sellNoSession\b/, "debe distinguir 'sin sesión'");
    assert.match(ordersSrc, /sellPublicSession/, "debe distinguir 'sesión pública'");
});

test("sin sesión utilizable no se pinta el botón", () => {
    // a button that always ends in a warning is worse than not having it
    const primeSrc = readFileSync(new URL("js/ui.components/inventory/ui_prime_inventory.js", P), "utf8");
    assert.match(primeSrc, /canPublishToWfm\?\.\(\)/, "el inventario debe comprobarlo");
    assert.match(trackerSrc, /canPublishToWfm\?\.\(\)/, "el tracker debe comprobarlo");
    assert.match(ordersSrc, /exposeGlobals\(\s*\{[^}]*canPublishToWfm/,
        "canPublishToWfm debe publicarse");

    // must be synchronous: called during render
    const start = ordersSrc.indexOf("export function canPublishToWfm");
    assert.notEqual(start, -1, "falta canPublishToWfm");
    assert.ok(!ordersSrc.slice(start, start + 160).includes("await"),
        "no puede ser async: se llama al pintar");
});

test("conectar y desconectar repintan el inventario", () => {
    // the button depends on session; without a repaint it would not appear (or disappear) until switching tabs
    const hits = [...ordersSrc.matchAll(/globalThis\.renderPrimeInventory\?\.\(\)/g)];
    assert.ok(hits.length >= 3,
        `esperaba repintado tras login, logout y publicar; hay ${hits.length}`);
});
