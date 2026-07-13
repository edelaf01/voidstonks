import { getActiveFissures, getArbitration } from "../repositories/api.repository.js";

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

export async function fetchBestFissures(force = false) {
    let allFissures;

    if (!force && _fissureCache.data && (Date.now() - _fissureCache.ts < FISSURE_TTL)) {
        allFissures = _fissureCache.data;
    } else {
        try {
            const res = await getActiveFissures();
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

            const now = new Date();

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

    const prefs = getFissurePrefs();
    return allFissures.filter((f) => passesPrefs(f, prefs));
}

let _arbyCache = { data: null };

export async function fetchArbitration(force = false) {
    const cached = _arbyCache.data;
    if (!force && cached?.current && new Date(cached.current.expiry) > new Date()) {
        return cached;
    }
    try {
        const res = await getArbitration();
        if (!res.ok) throw new Error(`Arbitration HTTP ${res.status}`);
        const payload = await res.json();
        const data = payload?.data ?? payload ?? null;
        if (data?.current) _arbyCache = { data };
        return data?.current ? data : cached;
    } catch (e) {
        console.error("Error obteniendo Arbitration:", e);
        return cached || null;
    }
}
