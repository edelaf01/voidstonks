import { getActiveFissures, getArbitration, getServerTime } from "../repositories/api.repository.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;

let _clockSyncPromise = null;
let _clockSynced = false;

function syncServerClock() {
    if (!_clockSyncPromise) {
        _clockSyncPromise = (async () => {
            try {
                const res = await getServerTime();
                if (!res.ok) return;
                const body = await res.json();
                if (typeof body?.now === "number") {
                    globalThis._serverTimeOffset = Date.now() - body.now;
                    _clockSynced = true;
                }
            } catch (e) {
                console.warn("[FISSURES] No se pudo sincronizar el reloj con el servidor:", e);
            }
        })();
    }
    return _clockSyncPromise;
}

const FISSURE_TTL = 120 * 1000;
let _fissureCache = { data: null, ts: 0 };

// The cache holds every fissure, Railjack included, without the user's prefs:
// changing prefs only refilters in memory.
const PREFS_KEY = "vs_fissure_prefs";

export const DEFAULT_MISSION_TYPES = ["Capture", "Extermination", "Rescue", "Void Cascade"];

export const RAILJACK_MISSION_TYPES = [
    "Skirmish",
    "Volatile",
    "Extermination",
    "Survival",
    "Defense",
    "Spy",
    "Orphix",
];

const DEFAULT_PREFS = {
    missionTypes: DEFAULT_MISSION_TYPES,
    includeOmnia: true,
    includeRailjack: false,
    railjackTypes: RAILJACK_MISSION_TYPES,
};

/** @returns {{missionTypes: string[], includeOmnia: boolean, includeRailjack: boolean}} */
export function getFissurePrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return { ...DEFAULT_PREFS, missionTypes: [...DEFAULT_MISSION_TYPES] };

        const parsed = JSON.parse(raw);
        return {
            missionTypes: Array.isArray(parsed.missionTypes)
                ? parsed.missionTypes.filter((x) => typeof x === "string")
                : [...DEFAULT_MISSION_TYPES],
            includeOmnia: typeof parsed.includeOmnia === "boolean" ? parsed.includeOmnia : true,
            includeRailjack: typeof parsed.includeRailjack === "boolean" ? parsed.includeRailjack : false,
            railjackTypes: Array.isArray(parsed.railjackTypes)
                ? parsed.railjackTypes.filter((x) => typeof x === "string")
                : [...RAILJACK_MISSION_TYPES],
        };
    } catch (e) {
        console.error("Error leyendo preferencias de fisuras:", e);
        return { ...DEFAULT_PREFS, missionTypes: [...DEFAULT_MISSION_TYPES], railjackTypes: [...RAILJACK_MISSION_TYPES] };
    }
}

/** @param {{missionTypes: string[], includeOmnia: boolean, includeRailjack: boolean}} prefs */
export function saveFissurePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        console.error("Error guardando preferencias de fisuras:", e);
    }
}

function passesPrefs(f, prefs) {
    if (f.isStorm) return !!prefs.includeRailjack && prefs.railjackTypes.includes(f.type);

    const typeMatch = prefs.missionTypes.includes(f.type);
    const omniaMatch = prefs.includeOmnia && f.tier === "Omnia";
    return typeMatch || omniaMatch;
}

/**
 * All active fissures, Railjack included, without view prefs. Feeds the panel and
 * the fissure alarms.
 * @param {boolean} [force=false]
 * @returns {Promise<Array>}
 */
export async function fetchAllFissures(force = false) {
    let allFissures;

    if (!force && _fissureCache.data && (Date.now() - _fissureCache.ts < FISSURE_TTL)) {
        allFissures = _fissureCache.data;
    } else {
        try {
            const clockSync = syncServerClock();
            const res = await getActiveFissures(force);
            if (!res.ok) throw new Error("Error al conectar con el Worldstate");

            let fissures = await res.json();

            if (typeof fissures === "string") {
                try { fissures = JSON.parse(fissures); } catch (e) {
                    console.error("Error al parsear las fisuras", e);
                }
            }
            if (fissures && !Array.isArray(fissures) && Array.isArray(fissures.data)) {
                fissures = fissures.data;
            }

            if (!Array.isArray(fissures)) {
                console.error("[Worldstate Error] Expected array, got:", typeof fissures, fissures);
                throw new TypeError("El Worldstate no ha devuelto un array válido de fisuras.");
            }

            await clockSync;

            // Fallback when the time ping failed: the server only returns active fissures, so a
            // first expiry already in the past means the local clock runs ahead. Never on stale cache.
            if (!_clockSynced && fissures.length > 0 && !globalThis._serverTimeOffset) {
                const expiryTimes = fissures.map(f => new Date(f.expiry).getTime());
                const activationTimes = fissures.map(f => new Date(f.activation).getTime());
                const earliestExpiry = Math.min(...expiryTimes);
                const latestActivation = Math.max(...activationTimes);

                if (Date.now() > earliestExpiry) {
                    globalThis._serverTimeOffset = Date.now() - (latestActivation + earliestExpiry) / 2;
                    console.warn(`[FISSURES] Desfase de reloj detectado: ${Math.round(globalThis._serverTimeOffset / 60000)}min. Corrigiendo.`);
                }
            }

            const now = new Date(Date.now() - (globalThis._serverTimeOffset || 0));

            allFissures = fissures.reduce((acc, f) => {
                const expiryDate = new Date(f.expiry);
                if (expiryDate <= now) return acc;

                const diffMs = expiryDate - now;
                const diffMins = Math.round(diffMs / 60000);
                const timeText = diffMins >= 60
                    ? `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`
                    : `${diffMins}m`;

                acc.push({
                    node: f.node,
                    type: f.missionType,
                    tier: f.tier,
                    eta: timeText,
                    expiry: f.expiry,
                    isSP: f.isHard === true,
                    isOmnia: f.tier === "Omnia",
                    isStorm: f.isStorm === true,
                });
                return acc;
            }, []);

            _fissureCache = { data: allFissures, ts: Date.now() };
        } catch (e) {
            console.error("Error en Worldstate:", e);
            // transient failure: serve the last good list
            allFissures = _fissureCache.data || [];
        }
    }

    return allFissures;
}

/**
 * Active fissures with the user's view prefs applied.
 * @param {boolean} [force=false]
 * @returns {Promise<Array>}
 */
export async function fetchBestFissures(force = false) {
    const allFissures = await fetchAllFissures(force);
    const prefs = getFissurePrefs();
    return allFissures.filter((f) => passesPrefs(f, prefs));
}

/**
 * Mission types present in the data right now, by source, so a new type stays
 * filterable. Reads the cache only.
 * @returns {{normal: string[], railjack: string[]}}
 */
export function getObservedMissionTypes() {
    const data = _fissureCache.data || [];
    const normal = new Set();
    const railjack = new Set();
    for (const f of data) {
        if (!f.type) continue;
        (f.isStorm ? railjack : normal).add(f.type);
    }
    return { normal: [...normal], railjack: [...railjack] };
}

// Community Arbitration tiers by node (discord.gg/Arbitrations), used when the parser
// brings no tier. Key = node name without "(Planet)".
const ARBY_NODE_TIERS = {
    "Tyana Pass": "S", "Alator": "S", "Callisto": "S", "Xini": "S", "Cytherean": "S",
    "Munio": "A", "Seimeni": "A", "Cinxia": "A", "Casta": "A", "Oestrus": "A", "Hyf": "A",
    "Larzac": "B", "Sechura": "B", "Hydron": "B", "Helene": "B", "Ose": "B", "Akkad": "B",
    "Kala-azar": "B", "Odin": "B", "Mithra": "B", "Belenus": "B", "Taranis": "B",
    "Coba": "C", "Spear": "C", "Kadesh": "C", "Paimon": "C", "Lith": "C",
    "Stephano": "C", "Tessera": "C", "Outer Terminus": "C",
    "Umbriel": "D", "Cerberus": "D", "Lares": "D", "Sangeru": "D", "Sinai": "D",
    "Gulliver": "D", "Romula": "D", "Proteus": "D", "Io": "D", "Stöfler": "D", "Gaia": "D",
};

// "Sechura (Pluto)" -> "Sechura"
const arbyBaseNode = (node) => (node || "").replace(/\s*\([^)]*\)\s*$/, "").trim();

function fillArbyTier(m) {
    if (m && !m.tier) {
        const t = ARBY_NODE_TIERS[arbyBaseNode(m.node)];
        if (t) m.tier = t;
    }
    return m;
}

let _arbyCache = { data: null };

/**
 * @param {boolean} [force=false]
 * @returns {Promise<{current: Object|null, upcoming: Array}|null>}
 */
export async function fetchArbitration(force = false) {
    const cached = _arbyCache.data;
    if (!force && cached?.current && new Date(cached.current.expiry) > new Date(Date.now() - (globalThis._serverTimeOffset || 0))) {
        return cached;
    }
    try {
        const res = await getArbitration(force);
        if (!res.ok) throw new Error(`Arbitration HTTP ${res.status}`);
        const payload = await res.json();
        // the main worker returns the object, the parser wraps it in {data}
        const data = payload?.data ?? payload ?? null;
        if (data?.current) {
            fillArbyTier(data.current);
            (data.upcoming || []).forEach(fillArbyTier);
            _arbyCache = { data };
        }
        return data?.current ? data : cached;
    } catch (e) {
        console.error("Error obteniendo Arbitration:", e);
        return cached || null;
    }
}

/**
 * Active Arbitration as a list for the alarm engine: if "current" expired, the running
 * `upcoming` rotation takes its place. [] when there is none.
 */
export async function fetchActiveArbitration() {
    const arby = await fetchArbitration();
    const now = new Date(Date.now() - (globalThis._serverTimeOffset || 0));
    let cur = arby?.current;
    if (cur && new Date(cur.expiry) <= now) {
        cur = (arby.upcoming || []).find(
            (m) => new Date(m.activation) <= now && new Date(m.expiry) > now,
        ) || null;
    }
    return cur && new Date(cur.expiry) > now ? [cur] : [];
}
