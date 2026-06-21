import { getActiveFissures } from "../repositories/api.repository.js";

// Cache en memoria del worldstate (global y de cambio lento): limita las llamadas al worker
// (límite 100k/día) y evita parpadeos al re-renderizar el panel.
const FISSURE_TTL = 120 * 1000; // 2 min
let _fissureCache = { data: null, ts: 0 };

/**
 * Fetches active fissure missions from the worker and filters them.
 * @param {boolean} [force=false] - Ignora la cache en memoria y fuerza recarga.
 * @returns {Promise<Array>}
 */
export async function fetchBestFissures(force = false) {
    if (!force && _fissureCache.data && (Date.now() - _fissureCache.ts < FISSURE_TTL)) {
        return _fissureCache.data;
    }
    try {
        const res = await getActiveFissures();
        if (!res.ok) throw new Error("Error al conectar con el Worldstate");

        let fissures = await res.json();

        if (typeof fissures === "string") {
            try { fissures = JSON.parse(fissures); } catch (e) {//TODO elaborar mas el handler igual esto no hace falta
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
        const fastMissions = new Set(["Capture", "Extermination", "Rescue", "Void Cascade"]);

        const result = fissures.reduce((acc, f) => {
            const isValidType = (fastMissions.has(f.missionType) || f.tier === "Omnia") && !f.isStorm;
            const expiryDate = new Date(f.expiry);
            if (!isValidType || expiryDate <= now) return acc;

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
                isSP: f.isHard === true,
                isOmnia: f.tier === "Omnia",
            });
            return acc;
        }, []);

        _fissureCache = { data: result, ts: Date.now() };
        return result;
    } catch (e) {
        console.error("Error en Worldstate:", e);
        // Fallo transitorio (timeout/cold start): no vacíes la lista, devuelve lo último bueno.
        return _fissureCache.data || [];
    }
}
