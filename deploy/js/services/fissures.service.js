import { getActiveFissures } from "../repositories/api.repository.js";

/**
 * Fetches active fissure missions from the worker and filters them.
 * @returns {Promise<Array>}
 */
export async function fetchBestFissures() {
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

        return fissures.reduce((acc, f) => {
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
    } catch (e) {
        console.error("Error en Worldstate:", e);
        return [];
    }
}
