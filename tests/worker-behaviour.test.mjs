import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionalSource } from "./_helpers/optional-source.mjs";

/**
 * Fija el comportamiento observable del worker sin desplegarlo.
 *
 * Nace de una limpieza de comentarios: sirve para comprobar que refactorizar el
 * fichero no cambia lo que hace. Comprueba contratos, no implementación.
 */

const { src, test } = optionalSource(new URL("../worker-code.js", import.meta.url));

/** Extrae el cuerpo de un handler por nombre. */
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
    // Cachear una respuesta autenticada filtraría las órdenes de un usuario a otro.
    for (const t of ["wfm_login", "wfm_logout", "wfm_my_orders", "wfm_order_edit"]) {
        assert.ok(!rule.includes(`"${t}"`), `${t} no debe estar exento de skipGlobalCache`);
    }
    // Las públicas sí se cachean: son datos compartidos y caros de pedir.
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

test("el login solo acepta la app en local y no cachea", () => {
    const body = handlerBody("wfm_login");
    assert.ok(body.includes("esOrigenLocal"), "debe validar el origen");
    assert.ok(body.includes("secureHeaders"), "debe responder con cabeceras seguras");
    assert.ok(body.includes("sha256Hex"), "el email del rate-limit va hasheado");
});

// La web publicada no puede tener login: el worker es el mismo para la app en local y para voidstonks.com.
test("las rutas de cuenta de WFM rechazan la web publicada, y también a quien llama sin Origin", () => {
    const head = src.slice(0, src.search(/^export default\b/m));
    const { Utils } = new Function(`${head}\nreturn { Utils };`)();
    const pide = (origin) => Utils.esOrigenLocal(new Request("https://api.voidstonks.com/", origin ? { headers: { Origin: origin } } : {}));
    for (const o of ["http://localhost:5500", "http://localhost", "http://127.0.0.1:8080"]) assert.ok(pide(o), o);
    for (const o of ["https://voidstonks.com", "https://www.voidstonks.com", "https://abc.voidstonks.pages.dev", "http://localhost.evil.com", "http://192.168.1.20:5500", null]) {
        assert.ok(!pide(o), String(o));
    }
    for (const name of ["wfm_login", "wfm_logout", "wfm_my_orders", "wfm_order_create", "wfm_order_edit"]) {
        assert.match(handlerBody(name), /if \(!Utils\.esOrigenLocal\(request\)\) return/, name);
    }
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
    // Cachear la respuesta entera daría un miss por usuario y volvería a bajar 1.6MB.
    for (const name of ["wfm_resolve", "wfm_market_batch"]) {
        assert.ok(handlerBody(name).includes("EdgeCache.getMany"),
            `${name} debe reutilizar entradas por ítem`);
    }
});

test("el guard de origen acepta los despliegues propios y rechaza suplantaciones", () => {
    // Se evalúan los patrones reales del worker: una lista fija dejaba fuera los
    // previews de Cloudflare Pages y el fetch moría por CORS ("sin conexión").
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
    assert.ok(src.includes("env.PRECIOS_SECRET"), "la clave de subida de precios viene del entorno");
});

test("el worker expone fetch y ya no tiene cron: precios y rivens llegan desde GitHub Actions", () => {
    assert.match(src, /async fetch\(request, env, ctx\)/);
    assert.doesNotMatch(src, /async scheduled\(/);
    assert.doesNotMatch(src, /processNextBatch/);
});

/**
 * `summarizeMarket` es pura, así que se puede ejecutar de verdad en vez de mirar su
 * texto: extraerla del fuente evita duplicar la lógica en el test y que se separen.
 */
function loadSummarizeMarket() {
    // Se ancla en la definición (tiene valor por defecto en `rank`) y no en la llamada
    // que fetchMarket hace unas líneas antes, que aparece primero en el fichero.
    const start = src.indexOf("summarizeMarket(stats, top, rank = ");
    assert.notEqual(start, -1, "falta summarizeMarket");
    let depth = 0, i = src.indexOf("{", start), j = i;
    while (j < src.length) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
        j++;
    }
    // En el fuente es un método de un objeto literal; se envuelve para poder evaluarlo
    // suelto sin arrastrar el resto del worker.
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

// warframe.market pide no pasar de 3 peticiones por segundo: el lote de mercado lanzaba 6 a la vez (ráfagas de ~11 rps).
test("las llamadas a warframe.market salen espaciadas aunque lleguen a la vez, y las demás no esperan", async () => {
    const head = src.slice(0, src.search(/^export default\b/m));
    const { fetchWFM, Fetcher, WFM } = new Function(`${head}\nreturn { fetchWFM, Fetcher, WFM };`)();
    const WFM_HUECO_MS = WFM.huecoMs;
    const momentos = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => { momentos.push([String(url), Date.now()]); return { ok: true, json: async () => ({}) }; };
    try {
        await Promise.all([1, 2, 3, 4].map((i) => fetchWFM(`https://api.warframe.market/v2/x${i}`)));
        const wfm = momentos.map(([, t]) => t);
        const huecos = wfm.slice(1).map((t, i) => t - wfm[i]);
        assert.ok(huecos.every((h) => h >= WFM_HUECO_MS - 20), `huecos: ${huecos}`);
        momentos.length = 0;
        const t0 = Date.now();
        await Promise.all([Fetcher.json("https://raw.githubusercontent.com/a"), Fetcher.json("https://raw.githubusercontent.com/b")]);
        assert.ok(Date.now() - t0 < WFM_HUECO_MS, "lo que no es warframe.market no entra en la cola");
    } finally { globalThis.fetch = orig; }
});

function cacheDeColo() {
    const guardado = new Map();
    return {
        guardado,
        default: {
            async match(req) { const t = guardado.get(req.url); return t === undefined ? undefined : new Response(t); },
            async put(req, res) { guardado.set(req.url, await res.text()); },
        },
    };
}

// Un fallo de caché en wfm_resolve o wfm_ids volvía a bajar el catálogo entero (1,4 MB) de warframe.market.
test("el catálogo de WFM se baja una vez por colo y lo comparten todas las rutas que lo leen", async () => {
    assert.ok(!src.includes("Fetcher.json(BASE_URLS.WF_MARKET_ITEMS)"), "ninguna ruta debe bajarlo por su cuenta");
    for (const name of ["wfm_items", "wfm_resolve", "wfm_ids", "prime_items_list"]) assert.match(handlerBody(name), /catalogoWFM\(ctx\)/, name);
    const head = src.slice(0, src.search(/^export default\b/m));
    const { catalogoWFM } = new Function(`${head}\nreturn { catalogoWFM };`)();
    const origCaches = globalThis.caches, origFetch = globalThis.fetch;
    const colo = cacheDeColo();
    globalThis.caches = colo;
    let descargas = 0;
    globalThis.fetch = async () => { descargas++; return new Response(JSON.stringify({ data: [{ id: "1", slug: "ash_prime_set" }] })); };
    const pendientes = [];
    const ctx = { waitUntil: (p) => pendientes.push(p) };
    try {
        assert.deepEqual(await catalogoWFM(ctx), [{ id: "1", slug: "ash_prime_set" }]);
        await Promise.all(pendientes);
        assert.deepEqual(await catalogoWFM(ctx), [{ id: "1", slug: "ash_prime_set" }]);
        assert.equal(descargas, 1);
        colo.guardado.clear();
        globalThis.fetch = async () => new Response("", { status: 503 });
        assert.equal(await catalogoWFM(ctx), null, "sin catálogo decide el handler");
    } finally { globalThis.caches = origCaches; globalThis.fetch = origFetch; }
});

test("el mercado sin rango comparte la entrada del lote de la lista; con rango va aparte", async () => {
    const head = src.slice(0, src.search(/^export default\b/m));
    const { Handlers } = new Function(`${head}\nreturn { Handlers };`)();
    const origCaches = globalThis.caches, origFetch = globalThis.fetch;
    globalThis.caches = cacheDeColo();
    const pedidas = [];
    globalThis.fetch = async (url) => {
        pedidas.push(String(url));
        return new Response(JSON.stringify(String(url).includes("/statistics") ? STATS_BY_RANK : TOP_BY_RANK));
    };
    const pendientes = [];
    const ctx = { waitUntil: (p) => pendientes.push(p) };
    const pide = (q) => Handlers.wfm_item_market(new URL(`https://api.voidstonks.com/?type=wfm_item_market&slug=primed_flow${q}`), {}, ctx);
    try {
        const primera = await pide("");
        await Promise.all(pendientes);
        const segunda = await pide("");
        assert.equal(pedidas.length, 2, "statistics + top una sola vez");
        assert.deepEqual(segunda.data, primera.data);
        assert.equal(segunda.ttl, 3600);
        assert.equal((await pide("&rank=10")).data.median, 90);
        assert.equal(pedidas.length, 4, "un rango concreto no sale del resumen mezclado");
    } finally { globalThis.caches = origCaches; globalThis.fetch = origFetch; }
});

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
    // El rango 5 no tiene ningún día cerrado: sin fallback la UI se quedaría sin
    // referencia de precio, que es peor que una referencia aproximada.
    const r5 = summarize(STATS_BY_RANK, TOP_BY_RANK, 5);
    assert.notEqual(r5.median, null, "debe dar alguna mediana");
});

// La mediana del día cerrado llega a tener dos días; para ajustar precios hace falta lo vendido en las últimas horas.
test("el resumen trae la última venta y la mediana de 48 h ponderada por volumen, por rango", () => {
    const summarize = loadSummarizeMarket();
    const hora = (h, mod_rank, median, closed_price, volume) => ({ datetime: `2026-09-27T${h}:00:00.000+00:00`, mod_rank, median, closed_price, volume });
    const stats = { payload: { statistics_closed: { "90days": [], "48hours": [
        hora("12", 0, 20, 21, 1), hora("14", 0, 30, 29, 9), hora("13", 0, 26, 25, 3),
        hora("13", 10, 80, 80, 4), hora("15", 10, 90, 90, 3), hora("16", 10, 99, 99, 0),
    ] } } };
    const r = summarize(stats, null, null).reciente;
    assert.deepEqual(r[0], { ultima: 29, hora: "2026-09-27T14:00:00.000+00:00", mediana: 30, volumen: 13 });
    assert.deepEqual(r[10], { ultima: 90, hora: "2026-09-27T15:00:00.000+00:00", mediana: 80, volumen: 7 }, "una hora sin ventas no es la última venta");
    const sinRango = summarize({ payload: { statistics_closed: { "48hours": [hora("10", undefined, 65, 63, 2)] } } }, null, null);
    assert.deepEqual(Object.keys(sinRango.reciente), [""]);
    assert.deepEqual(summarize({}, { data: {} }, null).reciente, {});
});

test("el mercado por rango no comparte entrada de caché con el ítem sin acotar", () => {
    // La caché global va por URL completa: basta con que el rango viaje en la query
    // y se valide, en vez de interpolarse a ciegas.
    const body = handlerBody("wfm_item_market");
    assert.match(body, /searchParams\.get\("rank"\)/, "el rango debe venir por query");
    assert.match(body, /Invalid rank/, "un rango no numérico debe rechazarse");
});

test("los accesos a caché van acotados: leer también gasta subrequests", () => {
    // Medido contra producción: con TODOS los ids ya cacheados (cero escrituras), 49
    // resolvían y 50 daban 500. El tope de 50 subrequests por invocación lo consumen
    // tanto las lecturas como las escrituras, así que acotar solo los put no bastaba.
    assert.match(src, /SUBREQUEST_BUDGET = (\d+)/, "debe declararse el presupuesto");
    const budget = Number(src.match(/SUBREQUEST_BUDGET = (\d+)/)[1]);
    assert.ok(budget < 50, `presupuesto ${budget}: debe dejar margen bajo el tope de 50`);

    // Un bucle de EdgeCache.get sin cupo es justo el patrón que provocaba el 500. Se
    // miran solo los handlers: dentro de getMany la lectura suelta es la implementación.
    for (const name of ["wfm_resolve", "wfm_ids", "wfm_market_batch"]) {
        const body = handlerBody(name);
        assert.ok(!/EdgeCache\.get\(/.test(body),
            `${name} debe leer con getMany, no con EdgeCache.get suelto`);
        assert.match(body, /EdgeCache\.getMany\(/, `${name} debe usar getMany`);
    }
});

test("cada handler que lee en lote declara su cupo", () => {
    // Sin cupo explícito heredarían el global y, sumado a fetches y escrituras del
    // propio handler, volverían a pasarse.
    const calls = [...src.matchAll(/EdgeCache\.getMany\([^)]*?,\s*(\d+)\)/g)].map(m => Number(m[1]));
    assert.ok(calls.length >= 3, `esperaba al menos 3 usos de getMany, hay ${calls.length}`);
    for (const c of calls) {
        assert.ok(c > 0 && c <= 30, `cupo ${c}: debe ser pequeño para dejar sitio a los fetches`);
    }
});

test("el lote de mercado limita los ítems que resuelve por invocación", () => {
    // Cada ítem no cacheado cuesta 2 fetches a WFM + 1 escritura: 30 de golpe se pasaban
    // del tope. Lo que no cabe deja la respuesta como incompleta y sin cachear.
    const body = handlerBody("wfm_market_batch");
    assert.match(body, /allMissing\.slice\(0, \d+\)/, "debe acotar cuántos resuelve");
    assert.match(body, /incomplete = allMissing\.length > missing\.length/,
        "lo que no cabe debe marcar la respuesta como incompleta");
    assert.match(body, /cacheable: !incomplete/, "una respuesta parcial no debe cachearse");
});

test("el login sigue el flujo que documenta DE para la v1", () => {
    // Mensaje de Kenya [DE] (15/4/26): "OAuth2 not ready -> use v1 /auth/signin", con
    // Authorization: JWT en la petición y el token leído de Set-Cookie.
    const body = handlerBody("wfm_login");

    assert.match(body, /"Authorization": "JWT"/, "el signin va con Authorization: JWT");
    assert.match(body, /Set-Cookie/, "el token se lee de Set-Cookie");

    // auth_type se ignora: comprobado contra la API, el JWT vuelve igual por cookie y
    // lleva dentro "auth_type":"cookie". Mandarlo sugería un comportamiento que no existe.
    assert.ok(!/auth_type:\s*"header"/.test(body),
        "no debe mandarse auth_type: la API lo ignora");
});

test("las peticiones autenticadas mandan el token como Bearer", () => {
    // Es lo que indica DE. Se manda además por cookie porque es lo que usa su propia web;
    // enviar ambos funciona con cualquiera de los dos que valide la API.
    for (const name of ["wfm_my_orders", "wfm_order_edit", "wfm_order_create"]) {
        const body = handlerBody(name);
        assert.match(body, /"Authorization": `Bearer \$\{jwt\}`/,
            `${name} debe mandar el token como Bearer`);
    }
});

test("el navegador nunca autentica directamente contra WFM", () => {
    // Un moderador de WFM: "if you're trying to authenticate using a browser, don't".
    // Además es imposible: su preflight no devuelve Access-Control-Allow-Origin y el JWT
    // vuelve en cookie HttpOnly. El signin sale del worker, nunca del cliente.
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

    // El worker sí debe hacerlo: es un servidor, que es lo que WFM espera.
    assert.match(handlerBody("wfm_login"), /auth\/signin/,
        "el signin debe vivir en el worker");
});

test("los datos que rotan no se sirven caducados por stale-while-revalidate", () => {
    // Bug real: "TODO ROTATING" en bounties. El default de ResponseHelper es swr=86400
    // (24h), así que tras una rotación Cloudflare seguía sirviendo el expiry viejo. La
    // respuesta con DATOS (ttl largo) debe declarar un swr corto; las de error (data:[]
    // con ttl bajo) dan igual, no tienen contadores que caduquen.
    for (const name of ["active_bounties", "fissures"]) {
        const body = handlerBody(name);
        // returns con ttl calculado o >= 60: son los que sirven contadores.
        const dataReturns = [...body.matchAll(/return \{[^}]*ttl: (?:Math\.max|\d{2,})[^}]*\}/g)]
            .map(m => m[0]);
        assert.ok(dataReturns.length > 0, `${name} debe tener un return con datos`);
        for (const r of dataReturns) {
            assert.match(r, /swr:/, `${name}: el return con datos debe declarar swr corto`);
        }
    }
});

test("el swr de las rutas que rotan es corto, no de horas", () => {
    // 120s: sirve stale un par de minutos mientras revalida, no un día.
    const body = handlerBody("active_bounties");
    const swr = Number(body.match(/const SWR = (\d+)/)?.[1]);
    assert.ok(swr > 0 && swr <= 300, `swr ${swr}: debe ser de minutos, no de horas`);
});

test("bounties se piden con versión para no golpear la caché vieja", () => {
    // La respuesta anterior quedó cacheada con swr=86400 (24h) y servía bounties
    // caducadas. &v=2 estrena clave de caché, igual que fissures, para saltarse esa
    // copia mientras expira sola.
    const repo = readFileSync(
        new URL("../deploy/js/repositories/api.repository.js", import.meta.url), "utf8");
    assert.match(repo, /type=active_bounties&v=\d/,
        "getActiveBounties debe versionar la URL");
});
