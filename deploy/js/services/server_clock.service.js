// Reloj del servidor: todos los contadores de la app (fisuras, farms, arbitración) deben
// medir contra la MISMA referencia temporal.
//
// El reloj del sistema del usuario no sirve tal cual: basta con que vaya adelantado unos
// minutos para que un contador salga en negativo y la misión se muestre como caducada
// ("ROTATING") cuando en realidad quedaba casi una hora. Y no es un caso raro — pasa con
// relojes desincronizados, cambios de zona horaria y máquinas virtuales.
//
// fissures.service.js ya calculaba este desfase contra ?type=time; aquí se centraliza para
// que farms y cualquier contador nuevo lo compartan en vez de reimplementarlo.
//
// El offset vive en globalThis a propósito: fissures.service.js lo escribe y lo lee, y
// hacer que ambos módulos se importen entre sí crearía un ciclo (ver CLAUDE.md).

import { getServerTime } from "../repositories/api.repository.js";

globalThis._serverTimeOffset = globalThis._serverTimeOffset || 0;

let syncPromise = null;

/**
 * Hora actual corregida con el desfase medido contra el servidor.
 * Sin sincronizar todavía, devuelve la hora local: es lo mismo que había antes, así que
 * nunca empeora el comportamiento.
 * @returns {number} milisegundos desde epoch, en la referencia del servidor
 */
export function serverNow() {
    return Date.now() - (globalThis._serverTimeOffset || 0);
}

/**
 * Mide el desfase contra el worker. Una sola petición por sesión: la promesa se reutiliza.
 * El endpoint responde no-store porque las respuestas de datos llegan cacheadas y su
 * cabecera Date es la de cuando se generaron, no la de ahora.
 */
/** @returns {boolean} true si ya se midió el desfase con éxito alguna vez. */
export function isClockSynced() {
    return synced;
}
let synced = false;

export function syncServerClock() {
    // Solo se cachea la promesa cuando SINCRONIZA. Antes se cacheaba siempre: si el
    // primer intento fallaba (red lenta al arrancar, timeout de ?type=time), la promesa
    // resuelta se reutilizaba para siempre y el offset quedaba en 0 el resto de la sesión.
    // Con el reloj del sistema desajustado, eso hacía que TODOS los contadores salieran
    // como caducados ("ROTATING") sin recuperarse nunca.
    if (syncPromise && synced) return syncPromise;

    syncPromise = (async () => {
        try {
            const res = await getServerTime();
            if (!res.ok) {
                console.warn("[CLOCK] ?type=time respondió", res.status, "- se reintentará");
                syncPromise = null; // permitir reintento en el siguiente render
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
                syncPromise = null; // respuesta rara: reintentar
            }
        } catch (e) {
            // Sin sincronizar se sigue usando la hora local: peor precisión, pero la app
            // funciona igual que antes de existir esto. Se permite reintento.
            console.warn("[CLOCK] No se pudo sincronizar con el servidor:", e);
            syncPromise = null;
        }
    })();

    return syncPromise;
}
