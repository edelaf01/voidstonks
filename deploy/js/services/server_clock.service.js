// Server clock: every countdown (fissures, farms, Arbitration) measures against the same
// reference. The system clock can run minutes ahead and show live missions as expired.
// The offset lives in globalThis: fissures.service.js writes it too, and importing each
// other would make a cycle.

import { getServerTime } from "../repositories/api.repository.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;

let syncPromise = null;

/**
 * Now, corrected by the offset measured against the server. Local time until synced.
 * @returns {number}
 */
export function serverNow() {
    return Date.now() - (globalThis._serverTimeOffset || 0);
}

/** @returns {boolean} */
export function isClockSynced() {
    return synced;
}
let synced = false;

export function syncServerClock() {
    // only a successful sync is cached, so a failed first try can retry
    if (syncPromise && synced) return syncPromise;

    syncPromise = (async () => {
        try {
            const res = await getServerTime();
            if (!res.ok) {
                console.warn("[CLOCK] ?type=time respondió", res.status, "- se reintentará");
                syncPromise = null;
                return;
            }
            const body = await res.json();
            if (typeof body?.now === "number") {
                globalThis._serverTimeOffset = Date.now() - body.now;
                synced = true;
                if (Math.abs(globalThis._serverTimeOffset) > 60000) {
                    console.warn("[CLOCK] tu reloj está desajustado",
                        Math.round(globalThis._serverTimeOffset / 1000), "s; corregido con la hora del servidor");
                }
            } else {
                syncPromise = null;
            }
        } catch (e) {
            console.warn("[CLOCK] No se pudo sincronizar con el servidor:", e);
            syncPromise = null;
        }
    })();

    return syncPromise;
}
