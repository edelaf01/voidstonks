import { getServerTime } from "../repositories/api.repository.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;

let syncPromise = null;

export function serverNow() {
    return Date.now() - (globalThis._serverTimeOffset || 0);
}

export function syncServerClock() {
    if (!syncPromise) {
        syncPromise = (async () => {
            try {
                const res = await getServerTime();
                if (!res.ok) return;
                const body = await res.json();
                if (typeof body?.now === "number") {
                    globalThis._serverTimeOffset = Date.now() - body.now;
                }
            } catch (e) {
                console.warn("[CLOCK] No se pudo sincronizar con el servidor:", e);
            }
        })();
    }
    return syncPromise;
}
