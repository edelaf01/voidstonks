/* wf-parser.js - Worker independiente para procesar el Worldstate con Proxies Rotativos
 * Rutas:
 *   GET /             -> fisuras activas (con fallbacks: warframestat.us -> tenno.tools -> worldstate crudo)
 *   GET /arbitration  -> Arbitration actual + próximas (calendario determinista de browse.wf)
 */

const DE_DICTS = {
    tiers: {
        'VoidT1': { name: 'Lith', num: 1 },
        'VoidT2': { name: 'Meso', num: 2 },
        'VoidT3': { name: 'Neo', num: 3 },
        'VoidT4': { name: 'Axi', num: 4 },
        'VoidT5': { name: 'Requiem', num: 5 },
        'VoidT6': { name: 'Omnia', num: 6 }
    }
};

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
};

// --- Arbitrations (calendario determinista publicado por browse.wf) ---
const ARBY_SCHEDULE_URL = "https://browse.wf/arbys.txt";
const ARBY_TIERS_URL = "https://browse.wf/supplemental-data/arbyTiers.js";
const ARBY_KV_KEY = "arby_window";
const ARBY_WINDOW_SIZE = 48;  // entradas (48h) guardadas en KV por descarga del calendario
const ARBY_UPCOMING = 12;     // próximas rotaciones devueltas al cliente

function parseDate(deDateObj) {
    if (!deDateObj) return Date.now() + 86400000;

    if (deDateObj.$date) {
        return parseInt(deDateObj.$date.$numberLong || deDateObj.$date);
    }

    const asNum = parseInt(deDateObj);
    if (!isNaN(asNum)) return asNum;

    return Date.now() + 86400000;
}

function getRandomHeaders() {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
    ];
    return {
        "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    };
}

/**
 * Worldstate crudo de DE. DIRECTO primero, proxies solo si eso falla.
 *
 * Un Worker no tiene el problema de CORS del navegador, así que puede pedirle a DE sin
 * intermediarios: menos saltos, menos latencia y ninguna dependencia de terceros que
 * caducan. Los proxies se quedan como red de seguridad por si DE bloquea el rango de IPs
 * de Cloudflare algún día.
 *
 * `content.warframe.com/dynamic/worldState.php` devuelve 404 desde que DE lo movió (medido
 * 2026-08-15). Se deja en la lista por si vuelve, pero el que responde es el CDN.
 */
const DE_WORLDSTATE_URLS = [
    "https://api.warframe.com/cdn/worldState.php",
    "https://content.warframe.com/dynamic/worldState.php"
];

/**
 * Ninguna petición a un tercero puede comerse el presupuesto de la invocación.
 *
 * El cliente aborta a los 8 s (fetchWithTimeout en api.repository.js), así que una fuente que
 * tarde 20 s no es "lenta": es un fallo que además se lleva por delante a las que vienen
 * detrás. Sin esto, la cascada llegó a tardar 36 s y el navegador solo veía un AbortError.
 */
const SOURCE_TIMEOUT_MS = 4000;

async function fetchWithDeadline(url, ms = SOURCE_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { headers: getRandomHeaders(), signal: ctrl.signal });
    } finally {
        clearTimeout(id);
    }
}

/**
 * Worldstate crudo de DE, directo. Sin proxies: los proxies van aparte y de últimos.
 *
 * `content.warframe.com/dynamic/worldState.php` devuelve 404 desde que DE lo movió (medido
 * 2026-08-15). Se deja por si vuelve, pero el que responde es el CDN de api.warframe.com.
 */
async function fetchRawWorldstate() {
    for (const url of DE_WORLDSTATE_URLS) {
        try {
            const res = await fetchWithDeadline(url);
            if (!res.ok) continue;
            const json = await res.json();
            if (json.ActiveMissions) return json;
        } catch (e) {
            console.warn(`[worldstate] ${url}: ${e.message}`);
        }
    }
    throw new Error("DE no respondió por vía directa");
}

/**
 * Worldstate a través de proxies públicos. Va el ÚLTIMO de la cascada, no pegado al intento
 * directo: son lentos y poco fiables, y probarlos antes que warframestat.us/tenno.tools
 * multiplicaba por diez el tiempo de respuesta para acabar usando igualmente un tercero.
 */
async function fetchRawWorldstateViaProxies() {
    const now = Date.now();
    const target = DE_WORLDSTATE_URLS[0];
    const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${target}&t=${now}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}&t=${now}`,
        `https://corsproxy.io/?${encodeURIComponent(target + '?t=' + now)}`
    ];

    for (const proxyUrl of proxies) {
        try {
            const res = await fetchWithDeadline(proxyUrl);
            if (!res.ok) continue;
            const json = JSON.parse(await res.text());
            if (json.ActiveMissions) return json;
        } catch (e) {
            console.warn(`[worldstate] proxy: ${e.message}`);
        }
    }
    throw new Error("Ningún proxy devolvió el worldstate");
}

// DE manda el tipo como "MT_MOBILE_DEFENSE". Traducirlo aquí evita depender de dict_solNodes
// para el dato que más se usa aguas abajo: los minutos por run, los filtros de tipo y las
// alarmas. Antes salía de SOL_NODES[node].type, que es el tipo HABITUAL del nodo, no el de
// esta rotación.
const MISSION_TYPES = {
    MT_EXCAVATE: "Excavation", MT_SABOTAGE: "Sabotage", MT_RESCUE: "Rescue",
    MT_CAPTURE: "Capture", MT_TERRITORY: "Interception", MT_ARTIFACT: "Disruption",
    MT_MOBILE_DEFENSE: "Mobile Defense", MT_INTEL: "Spy", MT_DEFENSE: "Defense",
    MT_EXTERMINATION: "Extermination", MT_SURVIVAL: "Survival", MT_ASSASSINATION: "Assassination",
    MT_ASSAULT: "Assault", MT_EVACUATION: "Defection", MT_ALCHEMY: "Alchemy",
    MT_CORRUPTION: "Void Flood", MT_VOID_CASCADE: "Void Cascade", MT_ARENA: "Arena",
    MT_JUNCTION: "Junction", MT_LANDSCAPE: "Free Roam", MT_HIVE: "Hive",
    MT_RAILJACK: "Skirmish", MT_VOLATILE: "Volatile", MT_ORPHIX: "Orphix",
    MT_PURIFY: "Purify", MT_ARMAGEDDON: "Void Armageddon"
};

function prettyMissionType(mt) {
    if (!mt) return null;
    if (MISSION_TYPES[mt]) return MISSION_TYPES[mt];
    // Un MT_ nuevo de DE se enseña legible en vez de "Unknown".
    const limpio = String(mt).replace(/^MT_/, "").toLowerCase()
        .replace(/(^|_)(\w)/g, (_, __, c) => " " + c.toUpperCase()).trim();
    return limpio || null;
}

/**
 * Fisuras de la lista que SIGUEN VIVAS.
 *
 * Es la comprobación que faltaba y la que provocó el apagón del 2026-08-15: warframestat.us
 * estuvo tres horas devolviendo 200 con 35 fisuras bien formadas y TODAS caducadas. La cascada
 * la daba por buena —tenía datos, ¿no?— y nunca pasaba a la siguiente fuente. "Responde" no es
 * "funciona".
 */
function liveFissures(list) {
    const now = Date.now();
    return (list || []).filter(f => {
        const t = Date.parse(f.expiry);
        return Number.isFinite(t) && t > now;
    });
}

// "SolNode310" es la clave interna de DE, no un sitio al que ir. Si salen sin traducir es que
// falta dict_solNodes en KV: los datos son frescos pero no se pueden ENSEÑAR, y además rompe el
// matcher de planeta de las alarmas del cliente. Cuenta como fuente inservible, igual que la
// caducidad, para caer a otra que sí sepa nombrarlos.
const RAW_NODE_KEY = /^(SolNode|CrewBattleNode|ClanNode|SettlementNode)\d+$/;

// Índice numérico de la era a partir de su nombre. Las fuentes de terceros no siempre mandan
// tierNum (tenno.tools no lo trae), y dejarlo en 0 haría que dos fuentes describieran la misma
// fisura de forma distinta.
const TIER_NUM_BY_NAME = Object.fromEntries(
    Object.values(DE_DICTS.tiers).map(t => [t.name, t.num])
);

function namesResolved(list) {
    return !list.some(f => RAW_NODE_KEY.test(f.node));
}

// --- Fuente 1: DE, que es la verdad -----------------------------------------------------------

async function fissuresFromDE(SOL_NODES, cargarWorldstate = fetchRawWorldstate) {
    const rawState = await cargarWorldstate();
    const nodeInfo = key => SOL_NODES[key] || {};

    const normalMissions = (rawState.ActiveMissions || []).map(mission => {
        const tierInfo = DE_DICTS.tiers[mission.Modifier] || { name: 'Unknown', num: 0 };
        const info = nodeInfo(mission.Node);
        const nodeName = info.value || mission.Node;

        return {
            id: mission._id?.$oid || mission._id || String(parseDate(mission.Activation)),
            activation: new Date(parseDate(mission.Activation)).toISOString(),
            expiry: new Date(parseDate(mission.Expiry)).toISOString(),
            node: nodeName,
            enemy: info.enemy || "Unknown",
            // El de DE manda: es el de ESTA rotación. El del diccionario queda de respaldo.
            missionType: prettyMissionType(mission.MissionType) || info.type || "Unknown",
            tier: tierInfo.name,
            tierNum: tierInfo.num,
            nodeKey: nodeName,
            isStorm: false,
            isHard: !!mission.Hard
        };
    });

    // Las fisuras de Railjack NO están en ActiveMissions: viven en VoidStorms, con
    // ActiveMissionTier en vez de Modifier y sin MissionType propio.
    const stormMissions = (rawState.VoidStorms || []).map(storm => {
        const tierInfo = DE_DICTS.tiers[storm.ActiveMissionTier] || { name: 'Unknown', num: 0 };
        const info = nodeInfo(storm.Node);
        const nodeName = info.value || storm.Node;

        return {
            id: storm._id?.$oid || storm._id || String(parseDate(storm.Activation)),
            activation: new Date(parseDate(storm.Activation)).toISOString(),
            expiry: new Date(parseDate(storm.Expiry)).toISOString(),
            node: nodeName,
            enemy: info.enemy || "Unknown",
            missionType: info.type || "Skirmish",
            tier: tierInfo.name,
            tierNum: tierInfo.num,
            nodeKey: nodeName,
            isStorm: true,
            isHard: false
        };
    });

    return [...normalMissions, ...stormMissions];
}

// --- Fuente 2: warframestat.us ---------------------------------------------------------------

async function fissuresFromWarframeStat() {
    const res = await fetchWithDeadline("https://api.warframestat.us/pc/fissures");
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(f => ({
        id: f.id || String(Date.now()),
        activation: f.activation,
        expiry: f.expiry,
        node: f.node,
        enemy: f.enemy || "Unknown",
        missionType: f.missionType || "Unknown",
        tier: f.tier,
        tierNum: f.tierNum || TIER_NUM_BY_NAME[f.tier] || 0,
        nodeKey: f.node || f.nodeKey,
        isStorm: !!f.isStorm,
        isHard: !!f.isHard
    }));
}

// --- Fuente 3: tenno.tools -------------------------------------------------------------------

async function fissuresFromTennoTools() {
    const res = await fetchWithDeadline("https://api.tenno.tools/worldstate/pc/fissures");
    if (!res.ok) return [];
    const data = await res.json();

    // La lista vive en `fissures.data`. El código anterior comprobaba Array.isArray(data.fissures),
    // y `fissures` es un objeto {time, data}: siempre daba [], así que este respaldo NUNCA entró.
    const list = Array.isArray(data) ? data
        : (Array.isArray(data?.fissures?.data) ? data.fissures.data
            : (Array.isArray(data?.fissures) ? data.fissures : []));

    return list.map(f => {
        // Aquí los tiempos van en SEGUNDOS y el nodo como "Planeta/Nodo"; el resto de la app
        // espera milisegundos y "Nodo (Planeta)" — sin darle la vuelta, el matcher de planeta
        // de las alarmas no reconoce ninguno.
        const [planeta, nodo] = String(f.location || "").split("/");
        const nodeName = nodo ? `${nodo} (${planeta})` : (f.location || f.node || "Unknown");

        return {
            id: f.id || String(Date.now()),
            activation: new Date((f.start ?? 0) * 1000).toISOString(),
            expiry: new Date((f.end ?? 0) * 1000).toISOString(),
            node: nodeName,
            enemy: f.faction || f.enemy || "Unknown",
            missionType: f.missionType || "Unknown",
            tier: f.tier,
            tierNum: f.tierNum || TIER_NUM_BY_NAME[f.tier] || 0,
            nodeKey: nodeName,
            isStorm: !!f.isStorm,
            isHard: !!f.hard
        };
    });
}

/**
 * Cascada de fuentes, con DE primero porque es la verdad y las demás son copias suyas.
 *
 * Una fuente solo se acepta si pasa DOS filtros: trae fisuras vivas y sabe nombrar los nodos.
 * Cualquiera de los dos que falle la descarta y se pasa a la siguiente, en vez de servir datos
 * inservibles con un 200 por delante.
 */
async function getFissuresWithFallback(env, SOL_NODES) {
    const fuentes = [
        ["DE", () => fissuresFromDE(SOL_NODES)],
        ["warframestat.us", fissuresFromWarframeStat],
        ["tenno.tools", fissuresFromTennoTools],
        // Los proxies de últimos: solo si los tres anteriores no han dado nada servible.
        ["DE (proxies)", () => fissuresFromDE(SOL_NODES, fetchRawWorldstateViaProxies)]
    ];

    for (const [nombre, cargar] of fuentes) {
        try {
            const vivas = liveFissures(await cargar());
            if (!vivas.length) {
                console.warn(`[fisuras] ${nombre}: sin fisuras vivas, pasando a la siguiente`);
                continue;
            }
            if (!namesResolved(vivas)) {
                console.warn(`[fisuras] ${nombre}: ${vivas.length} vivas pero con nodos sin traducir (¿falta dict_solNodes en KV?)`);
                continue;
            }
            return vivas;
        } catch (e) {
            console.warn(`[fisuras] ${nombre} falló:`, e.message);
        }
    }

    return [];
}

/* Ventana de Arbitrations: el calendario completo de browse.wf pesa ~1MB, así que solo se
 * descarga cuando la ventana cacheada en KV (48h de entradas) se agota. Escrituras KV
 * resultantes: ~1 cada día y medio. Los tiers comunitarios (S/A/B...) se cachean con ella. */
async function loadArbyWindow(env) {
    const nowSec = Math.floor(Date.now() / 1000);

    if (env.VOID_KV) {
        try {
            const cached = await env.VOID_KV.get(ARBY_KV_KEY, { type: "json" });
            if (cached && Array.isArray(cached.entries)) {
                const remaining = cached.entries.filter(e => e.ts + 3600 > nowSec);
                if (remaining.length > ARBY_UPCOMING) {
                    return { entries: remaining, tiers: cached.tiers || {} };
                }
            }
        } catch (e) {
            console.warn("KV arby_window read failed:", e.message);
        }
    }

    const res = await fetch(ARBY_SCHEDULE_URL, {
        headers: { "User-Agent": "VoidStonks-Parser/1.2" }
    });
    if (!res.ok) throw new Error(`arbys.txt devolvió ${res.status}`);
    const text = await res.text();

    const entries = [];
    for (const line of text.split("\n")) {
        const comma = line.indexOf(",");
        if (comma === -1) continue;
        const ts = parseInt(line.slice(0, comma));
        if (!ts || ts + 3600 <= nowSec) continue; // rotación ya pasada
        entries.push({ ts, node: line.slice(comma + 1).trim() });
        if (entries.length >= ARBY_WINDOW_SIZE) break;
    }
    if (!entries.length) throw new Error("arbys.txt sin entradas futuras");

    // Tiers comunitarios (best-effort: si el formato del JS cambia, seguimos sin tier).
    let tiers = {};
    try {
        const tRes = await fetch(ARBY_TIERS_URL, {
            headers: { "User-Agent": "VoidStonks-Parser/1.2" }
        });
        if (tRes.ok) {
            const js = await tRes.text();
            const m = js.match(/window\.arbyTiers\s*=\s*(\{[\s\S]*?\})\s*;?/);
            if (m) {
                const jsonish = m[1]
                    .replace(/\/\/[^\n]*/g, "")
                    .replace(/([A-Za-z0-9_]+)\s*:/g, '"$1":')
                    .replace(/,\s*}/g, "}");
                tiers = JSON.parse(jsonish);
            }
        }
    } catch (e) {
        console.warn("arbyTiers parse failed:", e.message);
    }

    const blob = { entries, tiers };
    if (env.VOID_KV) {
        try {
            await env.VOID_KV.put(ARBY_KV_KEY, JSON.stringify(blob), { expirationTtl: ARBY_WINDOW_SIZE * 3600 });
        } catch (e) {
            console.warn("KV arby_window write failed:", e.message);
        }
    }
    return blob;
}

function buildArbitrationPayload(blob, SOL_NODES) {
    const nowSec = Math.floor(Date.now() / 1000);

    const mapEntry = (e) => {
        const nodeData = SOL_NODES[e.node] || {};
        return {
            nodeKey: e.node,
            node: nodeData.value || e.node,
            type: nodeData.type || "Unknown",
            enemy: nodeData.enemy || "Unknown",
            tier: blob.tiers[e.node] || null,
            activation: new Date(e.ts * 1000).toISOString(),
            expiry: new Date((e.ts + 3600) * 1000).toISOString()
        };
    };

    const active = blob.entries.filter(e => e.ts + 3600 > nowSec);
    const current = active.find(e => e.ts <= nowSec) || null;
    const upcoming = active.filter(e => e.ts > nowSec).slice(0, ARBY_UPCOMING);

    return {
        current: current ? mapEntry(current) : null,
        upcoming: upcoming.map(mapEntry)
    };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            let SOL_NODES = {};
            if (env.VOID_KV) {
                const dictString = await env.VOID_KV.get("dict_solNodes");
                if (dictString) SOL_NODES = JSON.parse(dictString);
            }

            const url = new URL(request.url);

            if (url.pathname === "/arbitration" || url.pathname === "/arbys") {
                const blob = await loadArbyWindow(env);
                const payload = buildArbitrationPayload(blob, SOL_NODES);
                return new Response(JSON.stringify({ data: payload }), {
                    status: 200,
                    // La rotación es horaria y determinista: cache corta en el edge.
                    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" }
                });
            }

            const fissures = await getFissuresWithFallback(env, SOL_NODES);

            return new Response(JSON.stringify({ data: fissures }), {
                status: 200,
                headers: CORS_HEADERS
            });

        } catch (error) {
            return new Response(JSON.stringify({ data: [], error: error.message }), {
                status: 500,
                headers: CORS_HEADERS
            });
        }
    }
};
