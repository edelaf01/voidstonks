// Precios prime: un snapshot compartido en vez de un lote por usuario.
//
// El fallo que esto protege es silencioso: si la url del snapshot vuelve a llevar los
// slugs del usuario, o si deja de cachearse en el edge, todo sigue funcionando y solo
// se nota en la factura del worker y en los 20 s que tarda la pestaña de reliquias.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));
const apiSrc = read("../deploy/js/repositories/api.repository.js");
const storageSrc = read("../deploy/js/repositories/storage.repository.js");
const invSrc = read("../deploy/js/services/inventory/inventory.service.js");

/** Igual que en lich-weapons.test.mjs: el fuente hasta `export default` no tiene efectos. */
function workerInternals() {
    const head = workerSrc.slice(0, workerSrc.search(/^export default\b/m));
    return new Function(`${head}\nreturn { PriceSnapshot, Utils, EdgeCache };`)();
}

// Sin worker-code.js no hay nada que evaluar; los tests de este fichero ya salen en skip.
const { PriceSnapshot } = workerSrc ? workerInternals() : {};

function handlerBody(name) {
    const start = workerSrc.indexOf(`async '${name}'`);
    assert.notEqual(start, -1, `falta el handler ${name}`);
    let depth = 0, i = workerSrc.indexOf("{", start), j = i;
    while (j < workerSrc.length) {
        if (workerSrc[j] === "{") depth++;
        else if (workerSrc[j] === "}" && --depth === 0) break;
        j++;
    }
    return workerSrc.slice(i, j);
}

/** KV en memoria con la misma interfaz que env.VOID_KV. */
function fakeEnv(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        store,
        VOID_KV: {
            async get(k) { return store.has(k) ? store.get(k) : null; },
            async put(k, v) { store.set(k, v); }
        }
    };
}

const ctx = { waitUntil: (p) => p };

test("la url del snapshot no depende del cliente", () => {
    // Es toda la optimización: una sola entrada en el edge para todos los usuarios. Un
    // `q=` con los slugs del inventario devolvería la fragmentación de prices_batch.
    const call = apiSrc.match(/type=prices_snapshot[^`]*/)[0];
    assert.ok(!call.includes("${"), `la url lleva algo variable: ${call}`);
    assert.ok(!/[?&]q=/.test(call), "no debe enumerar slugs");
});

test("el snapshot se cachea en el edge y prices_batch no", () => {
    const rule = workerSrc.match(/const skipGlobalCache = [\s\S]*?;/)[0];
    assert.ok(rule.includes('"prices_batch"'), "el lote por usuario no es cacheable");
    assert.ok(!rule.includes('"prices_snapshot"'), "el snapshot SÍ debe cachearse");
});

test("un snapshot vacío no se cachea", () => {
    // Si el primer cliente llega antes que el cron, cachearlo dejaría al edge sirviendo
    // un mapa sin precios durante todo el ttl.
    assert.match(handlerBody("prices_snapshot"), /cacheable:\s*Object\.keys\(doc\.p\)\.length > 0/);
});

test("prices_batch resuelve los prime desde el snapshot", async () => {
    // Antes eran 25 lecturas de KV por lote; ahora una, y solo lo que no cubra el
    // snapshot baja al KV individual.
    const body = handlerBody("prices_batch");
    const snapshotAt = body.indexOf("PriceSnapshot.read");
    const perItemAt = body.indexOf("EdgeCache.getMany");
    assert.ok(snapshotAt !== -1 && perItemAt !== -1);
    assert.ok(snapshotAt < perItemAt, "el snapshot se consulta antes que la caché por slug");
});

test("el cron refresca el snapshot", () => {
    const scheduled = workerSrc.slice(workerSrc.search(/^export default\b/m));
    assert.match(scheduled, /PriceSnapshot\.refresh\(env, ctx\)/);
});

test("un documento corrupto no tumba la respuesta", async () => {
    const env = fakeEnv({ [PriceSnapshot.KEY]: "{no es json" });
    assert.deepEqual(await PriceSnapshot.read(env), { v: 1, t: 0, cursor: 0, p: {} });
});

test("el cursor rota y no reempieza por el mismo slug", async () => {
    const universe = Array.from({ length: 10 }, (_, i) => `item_${i}`);
    const env = fakeEnv({ [PriceSnapshot.UNIVERSE_KEY]: JSON.stringify(universe) });

    const asked = [];
    const snapshot = Object.create(PriceSnapshot);
    snapshot.MAX_PER_TICK = 4;
    snapshot.PACE_MS = 0;
    snapshot.fetchPrice = async (slug) => { asked.push(slug); return { price: 7 }; };

    await snapshot.refresh(env, ctx);
    assert.deepEqual(asked, ["item_0", "item_1", "item_2", "item_3"]);
    // El cursor viaja DENTRO del documento: dos escrituras por tick eran 576 al día con un
    // cron cada 5 min, sobre las 1.000 que da el plan gratuito de KV.
    assert.equal(JSON.parse(await env.VOID_KV.get(PriceSnapshot.KEY)).cursor, 4);

    await snapshot.refresh(env, ctx);
    assert.deepEqual(asked.slice(4), ["item_4", "item_5", "item_6", "item_7"]);

    const doc = JSON.parse(await env.VOID_KV.get(PriceSnapshot.KEY));
    assert.equal(Object.keys(doc.p).length, 8, "el tick nuevo conserva lo del anterior");
});

test("un 429 corta el tick sin perder lo ya refrescado", async () => {
    const env = fakeEnv({ [PriceSnapshot.UNIVERSE_KEY]: JSON.stringify(["a", "b", "c", "d"]) });

    const snapshot = Object.create(PriceSnapshot);
    snapshot.PACE_MS = 0;
    let n = 0;
    snapshot.fetchPrice = async (slug) => (++n > 2 ? { rateLimited: true } : { price: 5 });

    await snapshot.refresh(env, ctx);
    const doc = JSON.parse(await env.VOID_KV.get(PriceSnapshot.KEY));
    assert.deepEqual(doc.p, { a: 5, b: 5 });
    // El cursor se queda donde cortó: el siguiente tick sigue por "c" en vez de repetir.
    assert.equal(doc.cursor, 2);
});

test("el precio es la mediana de las 5 ventas online más baratas", () => {
    const sell = (platinum, status = "ingame") => ({ platinum, user: { status } });
    const top = { data: { sell: [sell(12), sell(10), sell(1, "offline"), sell(11), sell(40), sell(13), sell(14)] } };
    // Sin el offline: 10,11,12,13,14 -> 12. Un listing troll a 1p no arrastra el precio.
    assert.equal(PriceSnapshot.priceFromTop(top), 12);
    assert.equal(PriceSnapshot.priceFromTop({ data: { sell: [] } }), 0);
});

test("el snapshot no pisa los precios que ya hay en memoria", () => {
    // MEMORY_CACHE puede traer el precio del IDB del usuario o de wfm_live_prices, y
    // ambos son más específicos que la mediana del snapshot.
    const fn = storageSrc.match(/function applySnapshot[\s\S]*?\n}/)[0];
    assert.match(fn, /if \(!MEMORY_CACHE\.has\(slug\)\)/);
});

test("el snapshot se pide una sola vez por sesión", () => {
    assert.match(storageSrc, /if \(!snapshotPromise\) snapshotPromise = loadPriceSnapshot\(\)/);
});

test("la cola de lotes solo ve lo que el snapshot no cubre", () => {
    const fn = storageSrc.match(/export function getPriceValue[\s\S]*?\n}/)[0];
    const snapshotAt = fn.indexOf("await ensurePriceSnapshot()");
    const queueAt = fn.indexOf("PENDING_REQUESTS.set");
    assert.ok(snapshotAt !== -1 && snapshotAt < queueAt);
});

test("el chunk del cliente cabe en el lote que acepta el worker", () => {
    // El worker recorta con slice(0, 25): pedir de 50 en 50 descartaba media petición en
    // silencio y esos slugs acababan pidiéndose de uno en uno.
    const limit = Number(handlerBody("prices_batch").match(/slice\(0,\s*(\d+)\)/)[1]);
    for (const src of [storageSrc, invSrc]) {
        for (const [, size] of src.matchAll(/i \+= (\d+)\)[\s\S]{0,120}?slice\(i, i \+ \d+\)/g)) {
            assert.ok(Number(size) <= limit, `chunk de ${size} contra un límite de ${limit}`);
        }
    }
});

// --- Cuota de KV ------------------------------------------------------------------------------
//
// El plan gratuito da 1.000 escrituras y 100.000 lecturas al día. Pasarse no da un error
// bonito: KV empieza a fallar y la app se queda sin precios sin que nada lo explique. Estos
// casos fijan los tres recortes, porque los tres son fáciles de deshacer sin darse cuenta.

test("el cron del snapshot escribe UNA vez por tick, no dos", async () => {
    // Eran dos claves (documento + cursor) = 576 escrituras/día con un cron cada 5 min, más de
    // la mitad del presupuesto diario para guardar un número.
    const env = fakeEnv({ [PriceSnapshot.UNIVERSE_KEY]: JSON.stringify(["a", "b"]) });
    let escrituras = 0;
    const put = env.VOID_KV.put.bind(env.VOID_KV);
    env.VOID_KV.put = async (k, v) => { escrituras++; return put(k, v); };

    const snapshot = Object.create(PriceSnapshot);
    snapshot.PACE_MS = 0;
    snapshot.fetchPrice = async () => ({ price: 3 });

    await snapshot.refresh(env, ctx);
    assert.equal(escrituras, 1, "solo el documento");
});

test("un tick que no refresca nada no gasta escritura", async () => {
    // WFM devuelve 429 en el primer slug: no hay nada que guardar, y escribir el documento
    // igualmente gastaba cuota para dejarlo exactamente como estaba.
    const env = fakeEnv({ [PriceSnapshot.UNIVERSE_KEY]: JSON.stringify(["a", "b"]) });
    let escrituras = 0;
    const put = env.VOID_KV.put.bind(env.VOID_KV);
    env.VOID_KV.put = async (k, v) => { escrituras++; return put(k, v); };

    const snapshot = Object.create(PriceSnapshot);
    snapshot.PACE_MS = 0;
    snapshot.fetchPrice = async () => ({ rateLimited: true });

    const r = await snapshot.refresh(env, ctx);
    assert.equal(escrituras, 0);
    assert.equal(r.skipped, true);
});

test("un tick que solo poda slugs retirados SÍ escribe", () => {
    // El otro lado de la moneda: si el universo encogió hay cambio real que persistir, aunque
    // no se haya refrescado ni un precio.
    const body = workerSrc.slice(workerSrc.indexOf("async refresh(env, ctx)"));
    assert.match(body.slice(0, 2500), /if \(!refreshed && !podados\)/,
        "la guarda tiene que mirar también lo podado");
});

test("los precios por slug van a la caché del edge, no a KV", () => {
    // 25 slugs por lote contra 100.000 lecturas/día son ~4.000 peticiones y a cero. La caché
    // del edge no tiene cuota; a cambio cada acceso es un subrequest, de ahí el presupuesto.
    for (const handler of ["prices_batch", "price"]) {
        const body = handlerBody(handler);
        assert.ok(!/KVHelper\.(get|put)\([^)]*price_/.test(body),
            `${handler} sigue usando KV para los precios por slug`);
        assert.match(body, /EdgeCache\.(get|getMany|put)/, `${handler} debe usar la caché del edge`);
    }
});

test("los arcanos también salen de KV", () => {
    const body = handlerBody("arcane_batch");
    assert.ok(!/KVHelper\.(get|put)\([^)]*arc_/.test(body), "arc_ sigue en KV");
    assert.match(body, /EdgeCache\.getMany\(slugs, s => `arc_\$\{s\}`, 10\)/,
        "con presupuesto: cada arcano no cacheado cuesta además 2 fetches a WFM");
});

// La caché del edge es POR CENTRO DE DATOS y se puede desalojar antes del TTL. El snapshot en
// KV es lo que garantiza que un precio exista para todos; si también se fuera al edge, un colo
// frío se quedaría sin precios hasta que el cron pasara por allí, y el cron no visita colos.
test("el snapshot compartido se queda en KV", () => {
    const body = handlerBody("prices_snapshot");
    assert.match(body, /PriceSnapshot\.read\(env\)/);
    assert.ok(!body.includes("EdgeCache"), "el documento global no puede depender de un solo colo");
});
