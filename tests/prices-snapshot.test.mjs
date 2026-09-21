// prime prices: one shared snapshot instead of a batch per user
// the failure is silent: if the snapshot url carries the user's slugs again, or stops being edge cached,
// everything works and it only shows in the worker bill and the 20 s the relics tab takes
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));
const apiSrc = read("../deploy/js/repositories/api.repository.js");
const storageSrc = read("../deploy/js/repositories/storage.repository.js");
const invSrc = read("../deploy/js/services/inventory/inventory.service.js");

/** as in lich-weapons.test.mjs: the source up to `export default` has no side effects */
function workerInternals() {
    const head = workerSrc.slice(0, workerSrc.search(/^export default\b/m));
    return new Function(`${head}\nreturn { PriceSnapshot, Utils, EdgeCache };`)();
}

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

/** in-memory KV with the same interface as env.VOID_KV */
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
    // the whole optimisation: one edge entry for every user; a `q=` with the inventory slugs would bring back
    // the prices_batch fragmentation
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
    // if the first client beats the cron, caching would leave the edge serving a priceless map for the whole
    // ttl
    assert.match(handlerBody("prices_snapshot"), /cacheable:\s*Object\.keys\(doc\.p\)\.length > 0/);
});

test("prices_batch resuelve los prime desde el snapshot", async () => {
    // one KV read per batch instead of 25; only what the snapshot misses goes down to the individual KV
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
    // the cursor travels INSIDE the document: two writes per tick were 576 a day with a 5 min cron, out of the
    // 1,000 the free KV plan gives
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
    // the cursor stays where it stopped: the next tick resumes at "c" instead of repeating
    assert.equal(doc.cursor, 2);
});

test("el precio es la mediana de las 5 ventas online más baratas", () => {
    const sell = (platinum, status = "ingame") => ({ platinum, user: { status } });
    const top = { data: { sell: [sell(12), sell(10), sell(1, "offline"), sell(11), sell(40), sell(13), sell(14)] } };
    // without the offline one: 10,11,12,13,14 -> 12; a troll listing at 1p does not drag the price
    assert.equal(PriceSnapshot.priceFromTop(top), 12);
    assert.equal(PriceSnapshot.priceFromTop({ data: { sell: [] } }), 0);
});

test("el snapshot no pisa los precios que ya hay en memoria", () => {
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
    // the worker cuts with slice(0, 25): batches of 50 silently dropped half the request and those slugs ended
    // up fetched one by one
    const limit = Number(handlerBody("prices_batch").match(/slice\(0,\s*(\d+)\)/)[1]);
    for (const src of [storageSrc, invSrc]) {
        for (const [, size] of src.matchAll(/i \+= (\d+)\)[\s\S]{0,120}?slice\(i, i \+ \d+\)/g)) {
            assert.ok(Number(size) <= limit, `chunk de ${size} contra un límite de ${limit}`);
        }
    }
});

// KV quota: the free plan gives 1,000 writes and 100,000 reads a day, and going over fails without a clear
// error (KV starts failing and the app loses prices)
// these cases pin the three cuts, all easy to undo unnoticed

test("el cron del snapshot escribe UNA vez por tick, no dos", async () => {
    // it was two keys (document + cursor) = 576 writes/day with a 5 min cron, over half the daily budget to
    // store a number
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
    // WFM answers 429 on the first slug: nothing to store, and writing the document anyway spent quota to
    // leave it unchanged
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
    // the other side: if the universe shrank there is a real change to persist, even with no price refreshed
    const body = workerSrc.slice(workerSrc.indexOf("async refresh(env, ctx)"));
    assert.match(body.slice(0, 2500), /if \(!refreshed && !podados\)/,
        "la guarda tiene que mirar también lo podado");
});

test("los precios por slug van a la caché del edge, no a KV", () => {
    // 25 slugs per batch against 100,000 reads/day is ~4,000 requests and out; the edge cache has no quota but
    // each access is a subrequest, hence the budget
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

// the edge cache is PER DATA CENTRE and can evict before the TTL; the KV snapshot guarantees a price
// exists for everyone, while on the edge a cold colo would have no prices until the cron came by, which it
// never does
test("el snapshot compartido se queda en KV", () => {
    const body = handlerBody("prices_snapshot");
    assert.match(body, /PriceSnapshot\.read\(env\)/);
    assert.ok(!body.includes("EdgeCache"), "el documento global no puede depender de un solo colo");
});

// seen live: "Sell ~96" for a relic that sells intact at 20; warframe.market `/top` does not give the
// cheapest for relics and mixes refinements, so all are fetched and filtered to intact
test("una reliquia se valora por sus ventas INTACTAS más baratas, no por /top ni por las radiantes", { skip: !PriceSnapshot && "sin worker-code.js" }, () => {
    const orden = (platinum, subtype, type = "sell", status = "ingame") => ({ platinum, subtype, type, user: { status } });
    const todas = { data: [
        orden(30, "radiant"), orden(55, "intact"), orden(8, "intact"), orden(9, "intact"), orden(10, "intact"), orden(10, "intact"), orden(72, "intact"),
        orden(4, "intact", "buy"), orden(2, "intact", "sell", "offline"),
    ] };
    assert.equal(PriceSnapshot.priceIntactRelic(todas), 10, "mediana de las 5 intactas online más baratas: 8,9,10,10,55");
    assert.equal(PriceSnapshot.priceIntactRelic({ data: [orden(30, "radiant")] }), 0, "solo radiantes: sin precio intacta");
    assert.equal(PriceSnapshot.esReliquia("axi_v8_relic"), true);
    assert.equal(PriceSnapshot.esReliquia("limbo_prime_blueprint"), false);
});
