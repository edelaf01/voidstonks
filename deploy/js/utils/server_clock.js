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
                // Sin sincronizar se sigue usando la hora local: peor precisión, pero la app
                // funciona igual que antes de existir esto.
                console.warn("[CLOCK] No se pudo sincronizar con el servidor:", e);
            }
        })();
    }
    return syncPromise;
}
