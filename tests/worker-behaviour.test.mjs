import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionalSource } from "./_helpers/optional-source.mjs";

/**
 * pins observable worker behaviour without deploying
 * ensures refactoring the file preserves behaviour; checks contracts, not implementation
 */

const { src, test } = optionalSource(new URL("../worker-code.js", import.meta.url));

/** extracts handler body by name */
function handlerBody(name) {
    const start = src.indexOf(`async '${name}'`);
    assert.notEqual(start, -1, `falta el handler ${name}`);
    let depth = 0, i = src.indexOf("{", start), j = i;
    while (j < src.length) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
        j++;
    }
    return src.slice(i, j);
}

test("las rutas sensibles nunca tocan la caché compartida", () => {
    const rule = src.match(/const skipGlobalCache = [\s\S]*?;/)[0];
    // caching an authenticated response would leak orders between users
    for (const t of ["wfm_login", "wfm_logout", "wfm_my_orders", "wfm_order_edit"]) {
        assert.ok(!rule.includes(`"${t}"`), `${t} no debe estar exento de skipGlobalCache`);
    }
    // public routes are cached: shared data that is expensive to fetch
    for (const t of ["wfm_items", "wfm_resolve", "wfm_item_market"]) {
        assert.ok(rule.includes(`"${t}"`), `${t} debería cachearse`);
    }
});

test("ningún handler autenticado guarda el token ni lo registra", () => {
    for (const name of ["wfm_login", "wfm_logout", "wfm_my_orders", "wfm_order_edit"]) {
        const body = handlerBody(name);
        assert.ok(!body.includes("console.log"), `${name} no debe loguear`);
        assert.ok(!/KVHelper\.put\(env, ctx, `?(wfm|token|jwt)/.test(body),
            `${name} no debe persistir credenciales`);
    }
});

test("el login solo acepta orígenes propios y no cachea", () => {
    const body = handlerBody("wfm_login");
    assert.ok(body.includes("isTrustedOrigin"), "debe validar el origen");
    assert.ok(body.includes("secureHeaders"), "debe responder con cabeceras seguras");
    assert.ok(body.includes("sha256Hex"), "el email del rate-limit va hasheado");
});

test("los ids de orden se validan antes de ir a la URL", () => {
    const body = handlerBody("wfm_order_edit");
    assert.match(body, /\/\^\[a-f0-9\]\{24\}\$\/i/, "debe exigir ObjectId de 24 hex");
});

test("solo se reenvían los campos permitidos al editar una orden", () => {
    const body = handlerBody("wfm_order_edit");
    const allow = body.match(/for \(const k of \[([^\]]+)\]/)[1];
    const fields = allow.split(",").map(s => s.trim().replace(/"/g, ""));
    assert.deepEqual(fields, ["platinum", "quantity", "visible", "perTrade", "rank", "subtype"]);
});

test("las peticiones a WFM se identifican como pide su reglamento", () => {
    const ua = src.match(/"User-Agent":\s*"([^"]+)"/)[1];
    assert.ok(!/Mozilla|Chrome|Safari/.test(ua), "no debe camuflarse como navegador");
    assert.match(ua, /voidstonks/i, "debe incluir una forma de contacto");
});

test("los lotes respetan el límite de 3 req/s de WFM", () => {
    const body = handlerBody("wfm_market_batch");
    assert.match(body, /i \+= 3/, "debe agrupar de 3 en 3");
    assert.match(body, /setTimeout\(r, \d+\)/, "debe pausar entre tandas");
});

test("los catálogos grandes se cachean por ítem, no por petición", () => {
    // caching the full response would miss per user and redownload 1.6MB
    for (const name of ["wfm_resolve", "wfm_market_batch"]) {
        assert.ok(handlerBody(name).includes("EdgeCache.getMany"),
            `${name} debe reutilizar entradas por ítem`);
    }
});

test("el guard de origen acepta los despliegues propios y rechaza suplantaciones", () => {
    // evaluates actual worker patterns: a hardcoded list omitted Cloudflare Pages previews, causing fetches to
    // fail on CORS ("sin conexión")
    const block = src.match(/const TRUSTED_ORIGIN_PATTERNS = \[([\s\S]*?)\];/)[1];
    const patterns = block
        .split("\n")
        .map(l => l.trim().replace(/,$/, ""))
        .filter(l => l.startsWith("/"))
        .map(l => {
            const end = l.lastIndexOf("/");
            return new RegExp(l.slice(1, end), l.slice(end + 1));
        });
    const allows = (o) => patterns.some(re => re.test(o));

    for (const o of [
        "https://voidstonks.com",
        "https://www.voidstonks.com",
        "https://voidstonks.pages.dev",
        "https://abc123.voidstonks.pages.dev",
        "http://localhost:8080"
    ]) assert.ok(allows(o), `debería aceptar ${o}`);

    for (const o of [
        "https://evil.com",
        "https://voidstonks.com.evil.com",
        "https://evilvoidstonks.com",
        "https://evil.pages.dev",
        "http://voidstonks.com"
    ]) assert.ok(!allows(o), `debería rechazar ${o}`);
});

test("no hay secretos incrustados en el código", () => {
    const withoutComments = src.replace(/\/\/.*$/gm, "");
    assert.ok(!/(password|secret|api_?key)\s*[:=]\s*["'][^"']{8,}/i.test(withoutComments));
    assert.ok(src.includes("env.ADMIN_SECRET"), "el secreto admin viene del entorno");
});

test("el worker sigue exponiendo fetch y scheduled", () => {
    assert.match(src, /async fetch\(request, env, ctx\)/);
    assert.match(src, /async scheduled\(event, env, ctx\)/);
});

/**
 * summarizeMarket is pure and can run directly instead of inspecting text: extracting from source avoids
 * duplicated logic drifting apart
 */
function loadSummarizeMarket() {
    // anchors on definition (with default value on rank) rather than the earlier call in fetchMarket
    const start = src.indexOf("summarizeMarket(stats, top, rank = ");
    assert.notEqual(start, -1, "falta summarizeMarket");
    let depth = 0, i = src.indexOf("{", start), j = i;
    while (j < src.length) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
        j++;
    }
    // source is an object literal method: wrapped to evaluate standalone without pulling the rest of the
    // worker
    const fn = new Function(`return function ${src.slice(start, j + 1)};`);
    return fn();
}

const STATS_BY_RANK = {
    payload: {
        statistics_closed: {
            "90days": [
                { datetime: "d1", mod_rank: 0, median: 10, avg_price: 11, volume: 5, min_price: 8, max_price: 14 },
                { datetime: "d1", mod_rank: 10, median: 90, avg_price: 95, volume: 3, min_price: 80, max_price: 110 }
            ]
        }
    }
};

const TOP_BY_RANK = {
    data: {
        sell: [
            { platinum: 12, quantity: 1, rank: 0, user: { ingameName: "a", status: "ingame" } },
            { platinum: 95, quantity: 1, rank: 10, user: { ingameName: "b", status: "online" } }
        ],
        buy: []
    }
};

test("el resumen de mercado separa los rangos de mods y arcanos", () => {
    const summarize = loadSummarizeMarket();

    const r10 = summarize(STATS_BY_RANK, TOP_BY_RANK, 10);
    assert.equal(r10.median, 90, "un r10 no puede heredar la mediana del r0");
    assert.equal(r10.sell.length, 1);
    assert.equal(r10.sell[0].platinum, 95);

    const r0 = summarize(STATS_BY_RANK, TOP_BY_RANK, 0);
    assert.equal(r0.median, 10);
    assert.equal(r0.sell[0].platinum, 12);
});

test("sin rango pedido, el resumen no filtra (ítems que no son rangueables)", () => {
    const summarize = loadSummarizeMarket();
    const all = summarize(STATS_BY_RANK, TOP_BY_RANK, null);
    assert.equal(all.sell.length, 2, "no debe descartar listings por rango");
});

test("un rango sin histórico propio cae al dato global en vez de quedarse vacío", () => {
    const summarize = loadSummarizeMarket();
    // rank 5 has no closed days: without a fallback the UI loses its price reference, worse than an
    // approximate one
    const r5 = summarize(STATS_BY_RANK, TOP_BY_RANK, 5);
    assert.notEqual(r5.median, null, "debe dar alguna mediana");
});

test("el mercado por rango no comparte entrada de caché con el ítem sin acotar", () => {
    // global cache keys on full URL: passing rank in query and validating suffices over blind interpolation
    const body = handlerBody("wfm_item_market");
    assert.match(body, /searchParams\.get\("rank"\)/, "el rango debe venir por query");
    assert.match(body, /Invalid rank/, "un rango no numérico debe rechazarse");
});

test("los accesos a caché van acotados: leer también gasta subrequests", () => {
    // measured against production: with ALL ids already cached (zero writes), 49 resolved and 50 gave 500; the
    // 50 subrequests per invocation limit applies to reads and writes alike, so capping only put was not
    // enough
    assert.match(src, /SUBREQUEST_BUDGET = (\d+)/, "debe declararse el presupuesto");
    const budget = Number(src.match(/SUBREQUEST_BUDGET = (\d+)/)[1]);
    assert.ok(budget < 50, `presupuesto ${budget}: debe dejar margen bajo el tope de 50`);

    // uncapped EdgeCache.get loop was the exact pattern causing 500s; checks handlers only: inside getMany,
    // individual reads are the implementation
    for (const name of ["wfm_resolve", "wfm_ids", "wfm_market_batch"]) {
        const body = handlerBody(name);
        assert.ok(!/EdgeCache\.get\(/.test(body),
            `${name} debe leer con getMany, no con EdgeCache.get suelto`);
        assert.match(body, /EdgeCache\.getMany\(/, `${name} debe usar getMany`);
    }
});

test("cada handler que lee en lote declara su cupo", () => {
    // without an explicit budget they would inherit the global limit and exceed it when combined with handler
    // fetches and writes
    const calls = [...src.matchAll(/EdgeCache\.getMany\([^)]*?,\s*(\d+)\)/g)].map(m => Number(m[1]));
    assert.ok(calls.length >= 3, `esperaba al menos 3 usos de getMany, hay ${calls.length}`);
    for (const c of calls) {
        assert.ok(c > 0 && c <= 30, `cupo ${c}: debe ser pequeño para dejar sitio a los fetches`);
    }
});

test("el lote de mercado limita los ítems que resuelve por invocación", () => {
    // each uncached item costs 2 fetches to WFM + 1 write: 30 at once exceeded the limit; overflow leaves
    // response marked incomplete and uncached
    const body = handlerBody("wfm_market_batch");
    assert.match(body, /allMissing\.slice\(0, \d+\)/, "debe acotar cuántos resuelve");
    assert.match(body, /incomplete = allMissing\.length > missing\.length/,
        "lo que no cabe debe marcar la respuesta como incompleta");
    assert.match(body, /cacheable: !incomplete/, "una respuesta parcial no debe cachearse");
});

test("el login sigue el flujo que documenta DE para la v1", () => {
    // Kenya [DE] message (15/4/26): "OAuth2 not ready -> use v1 /auth/signin", with Authorization: JWT on the
    // request and token read from Set-Cookie
    const body = handlerBody("wfm_login");

    assert.match(body, /"Authorization": "JWT"/, "el signin va con Authorization: JWT");
    assert.match(body, /Set-Cookie/, "el token se lee de Set-Cookie");

    // auth_type is ignored: verified against API, JWT arrives unchanged via cookie containing
    // "auth_type":"cookie"; sending it suggested non-existent behaviour
    assert.ok(!/auth_type:\s*"header"/.test(body),
        "no debe mandarse auth_type: la API lo ignora");
});

test("las peticiones autenticadas mandan el token como Bearer", () => {
    // as directed by DE; sent via cookie too since their web client uses it: sending both satisfies whichever
    // the API validates
    for (const name of ["wfm_my_orders", "wfm_order_edit", "wfm_order_create"]) {
        const body = handlerBody(name);
        assert.match(body, /"Authorization": `Bearer \$\{jwt\}`/,
            `${name} debe mandar el token como Bearer`);
    }
});

test("el navegador nunca autentica directamente contra WFM", () => {
    // WFM moderator: "if you're trying to authenticate using a browser, don't"; also impossible because
    // preflight omits Access-Control-Allow-Origin and JWT returns in HttpOnly cookie: signin must run from
    // worker, never client
    const client = [
        "deploy/js/services/market/wfm_auth.service.js",
        "deploy/js/services/market/wfm_orders.service.js",
        "deploy/js/services/market/wfm_link.service.js"
    ];
    for (const rel of client) {
        const s = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
        assert.ok(!/fetch\([^)]*api\.warframe\.market/.test(s),
            `${rel} no debe llamar a api.warframe.market: iría por el navegador`);
    }

    // the worker must do it: it is a server, which is what WFM expects
    assert.match(handlerBody("wfm_login"), /auth\/signin/,
        "el signin debe vivir en el worker");
});

test("los datos que rotan no se sirven caducados por stale-while-revalidate", () => {
    // real bug: "TODO ROTATING" on bounties; default ResponseHelper is swr=86400 (24h), so Cloudflare kept
    // serving old expiry after rotations; response with DATA (long ttl) must declare short swr; error
    // responses (data:[] with low ttl) lack expiring counters
    for (const name of ["active_bounties", "fissures"]) {
        const body = handlerBody(name);
        // returns with calculated ttl or >= 60: these serve countdowns
        const dataReturns = [...body.matchAll(/return \{[^}]*ttl: (?:Math\.max|\d{2,})[^}]*\}/g)]
            .map(m => m[0]);
        assert.ok(dataReturns.length > 0, `${name} debe tener un return con datos`);
        for (const r of dataReturns) {
            assert.match(r, /swr:/, `${name}: el return con datos debe declarar swr corto`);
        }
    }
});

test("el swr de las rutas que rotan es corto, no de horas", () => {
    // 120s: serves stale for a couple minutes while revalidating, not a whole day
    const body = handlerBody("active_bounties");
    const swr = Number(body.match(/const SWR = (\d+)/)?.[1]);
    assert.ok(swr > 0 && swr <= 300, `swr ${swr}: debe ser de minutos, no de horas`);
});

test("bounties se piden con versión para no golpear la caché vieja", () => {
    // previous response remained cached with swr=86400 (24h), serving expired bounties: &v=2 creates a new
    // cache key (like fissures) to bypass old copies while they expire
    const repo = readFileSync(
        new URL("../deploy/js/repositories/api.repository.js", import.meta.url), "utf8");
    assert.match(repo, /type=active_bounties&v=\d/,
        "getActiveBounties debe versionar la URL");
});
