import { getServerTime } from "../repositories/api.repository.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;

let syncPromise = null;

export function serverNow() {
    return Date.now() - (globalThis._serverTimeOffset || 0);
}

export function isClockSynced() {
    return synced;
}
let synced = false;

export function syncServerClock() {
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
