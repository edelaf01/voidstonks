import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));
const apiSrc = read("../deploy/js/repositories/api.repository.js");
const storageSrc = read("../deploy/js/repositories/storage.repository.js");
const invSrc = read("../deploy/js/services/inventory/inventory.service.js");

function workerInternals() {
    const head = workerSrc.slice(0, workerSrc.search(/^export default\b/m));
    return new Function(`${head}\nreturn { PriceSnapshot, Utils };`)();
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
    assert.match(handlerBody("prices_snapshot"), /cacheable:\s*Object\.keys\(doc\.p\)\.length > 0/);
});

test("prices_batch resuelve los prime desde el snapshot", async () => {
    const body = handlerBody("prices_batch");
    const snapshotAt = body.indexOf("PriceSnapshot.read");
    const kvAt = body.indexOf("KVHelper.get(env, `price_");
    assert.ok(snapshotAt !== -1 && kvAt !== -1);
    assert.ok(snapshotAt < kvAt, "el snapshot se consulta antes que el KV por slug");
});

test("el cron refresca el snapshot", () => {
    const scheduled = workerSrc.slice(workerSrc.search(/^export default\b/m));
    assert.match(scheduled, /PriceSnapshot\.refresh\(env, ctx\)/);
});

test("un documento corrupto no tumba la respuesta", async () => {
    const env = fakeEnv({ [PriceSnapshot.KEY]: "{no es json" });
    assert.deepEqual(await PriceSnapshot.read(env), { v: 1, t: 0, p: {} });
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
    assert.equal(await env.VOID_KV.get(PriceSnapshot.CURSOR_KEY), "4");

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
    assert.equal(await env.VOID_KV.get(PriceSnapshot.CURSOR_KEY), "2");
});

test("el precio es la mediana de las 5 ventas online más baratas", () => {
    const sell = (platinum, status = "ingame") => ({ platinum, user: { status } });
    const top = { data: { sell: [sell(12), sell(10), sell(1, "offline"), sell(11), sell(40), sell(13), sell(14)] } };
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
    // worker cuts with slice(0, 25): batches of 50 silently dropped half the request
    const limit = Number(handlerBody("prices_batch").match(/slice\(0,\s*(\d+)\)/)[1]);
    for (const src of [storageSrc, invSrc]) {
        for (const [, size] of src.matchAll(/i \+= (\d+)\)[\s\S]{0,120}?slice\(i, i \+ \d+\)/g)) {
            assert.ok(Number(size) <= limit, `chunk de ${size} contra un límite de ${limit}`);
        }
    }
});
