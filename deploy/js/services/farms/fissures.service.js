import { getActiveFissures, getArbitration } from "../../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../server_clock.service.js";

// date header from edge cache is stale: clock syncs with one uncacheable call per session
let _clockSynced = false;

const FISSURE_TTL = 120 * 1000;
let _fissureCache = { data: null, ts: 0 };

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

            // server only returns active fissures: an expiry in the past means the local clock runs ahead
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
            allFissures = _fissureCache.data || [];
        }
    }

    return allFissures;
}

export async function fetchBestFissures(force = false) {
    const allFissures = await fetchAllFissures(force);
    const prefs = getFissurePrefs();
    return allFissures.filter((f) => passesPrefs(f, prefs));
}

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

const arbyBaseNode = (node) => (node || "").replace(/\s*\([^)]*\)\s*$/, "").trim();

function fillArbyTier(m) {
    if (m && !m.tier) {
        const t = ARBY_NODE_TIERS[arbyBaseNode(m.node)];
        if (t) m.tier = t;
    }
    return m;
}

let _arbyCache = { data: null };

export async function fetchArbitration(force = false) {
    const cached = _arbyCache.data;
    if (!force && cached?.current && new Date(cached.current.expiry) > new Date(Date.now() - (globalThis._serverTimeOffset || 0))) {
        return cached;
    }
    try {
        const res = await getArbitration(force);
        if (!res.ok) throw new Error(`Arbitration HTTP ${res.status}`);
        const payload = await res.json();
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
