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

async function fetchRawWorldstate() {
    const targetUrl = "https://content.warframe.com/dynamic/worldState.php";
    const altTargetUrl = "https://api.warframe.com/cdn/worldState.php";
    const now = Date.now();

    const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${targetUrl}&t=${now}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&t=${now}`,
        `https://corsproxy.io/?${encodeURIComponent(targetUrl + '?t=' + now)}`,
        `https://corsproxy.io/?${encodeURIComponent(altTargetUrl + '?t=' + now)}`
    ];

    let lastError = "";

    for (const proxyUrl of proxies) {
        try {
            const res = await fetch(proxyUrl, {
                headers: getRandomHeaders()
            });

            if (res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    if (json.ActiveMissions) return json;
                } catch (e) {
                    lastError = "El proxy devolvió HTML en lugar de JSON.";
                    continue;
                }
            } else {
                lastError = `Proxy falló con status ${res.status}`;
            }
        } catch (error) {
            lastError = `Error de red con el proxy: ${error.message}`;
        }
    }

    throw new Error(`Imposible penetrar el cortafuegos. Último error: ${lastError}`);
}

async function getFissuresWithFallback(env, SOL_NODES) {
    // 1. Try WarframeStat.us
    try {
        const res = await fetch("https://api.warframestat.us/pc/fissures", {
            headers: getRandomHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                return data.map(f => ({
                    id: f.id || String(Date.now()),
                    activation: f.activation,
                    expiry: f.expiry,
                    node: f.node,
                    enemy: f.enemy || "Unknown",
                    missionType: f.missionType || "Unknown",
                    tier: f.tier,
                    tierNum: f.tierNum || 0,
                    nodeKey: f.node || f.nodeKey,
                    isStorm: !!f.isStorm,
                    isHard: !!f.isHard
                }));
            }
        }
    } catch (e) {
        console.warn("WarframeStat.us API failed:", e.message);
    }

    // 2. Try Tenno.tools
    try {
        const res = await fetch("https://api.tenno.tools/worldstate/pc/fissures", {
            headers: getRandomHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data && Array.isArray(data.fissures) ? data.fissures : []);
            if (list.length > 0) {
                return list.map(f => ({
                    id: f.id || String(Date.now()),
                    activation: f.activation,
                    expiry: f.expiry,
                    node: f.node,
                    enemy: f.enemy || "Unknown",
                    missionType: f.missionType || "Unknown",
                    tier: f.tier,
                    tierNum: f.tierNum || 0,
                    nodeKey: f.node,
                    isStorm: !!f.isStorm,
                    isHard: !!f.isHard
                }));
            }
        }
    } catch (e) {
        console.warn("Tenno.tools API failed:", e.message);
    }

    // 3. Fallback to raw worldstate + proxies
    const rawState = await fetchRawWorldstate();
    const now = Date.now();

    const normalMissions = (rawState.ActiveMissions || [])
        .map(mission => {
            const expiryMs = parseDate(mission.Expiry);
            const activationMs = parseDate(mission.Activation);
            const tierInfo = DE_DICTS.tiers[mission.Modifier] || { name: 'Unknown', num: 0 };

            const nodeData = SOL_NODES[mission.Node] || {};
            const nodeName = nodeData.value || mission.Node;

            return {
                id: mission._id?.$oid || mission._id || String(activationMs),
                activation: new Date(activationMs).toISOString(),
                expiry: new Date(expiryMs).toISOString(),
                expiryMs: expiryMs,
                node: nodeName,
                enemy: nodeData.enemy || "Unknown",
                missionType: nodeData.type || "Unknown",
                tier: tierInfo.name,
                tierNum: tierInfo.num,
                nodeKey: nodeName,
                isStorm: false,
                isHard: !!mission.Hard
            };
        });

    // Las fisuras de Railjack NO están en ActiveMissions: viven en la sección VoidStorms
    // (con ActiveMissionTier en vez de Modifier). Sin esto, el fallback nunca devuelve storms.
    const stormMissions = (rawState.VoidStorms || [])
        .map(storm => {
            const expiryMs = parseDate(storm.Expiry);
            const activationMs = parseDate(storm.Activation);
            const tierInfo = DE_DICTS.tiers[storm.ActiveMissionTier] || { name: 'Unknown', num: 0 };

            const nodeData = SOL_NODES[storm.Node] || {};
            const nodeName = nodeData.value || storm.Node;

            return {
                id: storm._id?.$oid || storm._id || String(activationMs),
                activation: new Date(activationMs).toISOString(),
                expiry: new Date(expiryMs).toISOString(),
                expiryMs: expiryMs,
                node: nodeName,
                enemy: nodeData.enemy || "Unknown",
                missionType: nodeData.type || "Unknown",
                tier: tierInfo.name,
                tierNum: tierInfo.num,
                nodeKey: nodeName,
                isStorm: true,
                isHard: false
            };
        });

    return [...normalMissions, ...stormMissions]
        .filter(f => f.expiryMs > now)
        .map(f => {
            delete f.expiryMs;
            return f;
        });
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
