import { dbHelper } from "../repositories/storage.repository.js";
import { getLichWeapons } from "../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../utils/server_clock.js";

const CACHE_KEY = "lich_weapons_cache";

/**
 * Normaliza la respuesta del worker. Un vendedor sin armas se descarta: la tarjeta
 * vacía no dice nada y el resto del apartado sigue siendo útil.
 * @param {object} payload
 * @returns {Array}
 */
function normalizeVendors(payload) {
    const vendors = Array.isArray(payload?.vendors) ? payload.vendors : [];
    return vendors.filter((v) => v?.key && Array.isArray(v.weapons) && v.weapons.length > 0);
}

/**
 * Última respuesta buena guardada, solo si su ventana sigue viva.
 *
 * Servir una rotación ya terminada sería peor que no enseñar nada: el jugador iría a la
 * tienda a por un arma que ya no está.
 * @returns {Promise<Array>}
 */
async function lastKnownGood() {
    const cached = await dbHelper.get(CACHE_KEY);
    const vendors = Array.isArray(cached?.data) ? cached.data : [];
    if (vendors.length === 0) return [];
    const soonestEnd = Math.min(...vendors.map((v) => Number(v.end) || 0));
    return soonestEnd > serverNow() ? vendors : [];
}

/**
 * Rotación activa de Eleanor (Coda) y Ergo Glast (Tenet).
 *
 * SIEMPRE se pregunta al worker: es la única fuente de verdad y si tiene datos nuevos
 * (bonus que acaban de reportarse, un lote recién rotado) el cliente tiene que verlos.
 * Preguntar no cuesta peticiones: el worker responde con `Cache-Control` medido —30 min
 * mientras falte algún bonus, hasta la rotación cuando ya están todos— así que la caché
 * HTTP del propio navegador contesta sin salir a la red. Antes había además una caché en
 * IndexedDB con su propia caducidad, y era ella la que tapaba los datos nuevos.
 *
 * IndexedDB queda solo como red de seguridad para cuando la petición falla.
 *
 * @param {boolean} [force] Estrena URL (`_cb`) para saltarse también la caché HTTP del
 *   navegador y la del edge. Lo usa el refetch al rotar, que es cuando la respuesta
 *   cacheada es justo la que ya no vale.
 * @returns {Promise<Array>} Vendedores con sus armas, o [] si no hay nada que enseñar.
 */
export async function fetchLichWeapons(force = false) {
    try {
        // Los contadores se pintan contra serverNow(): sin sincronizar, un reloj de
        // sistema desajustado marca la ventana como caducada y dispara refetch en bucle.
        await syncServerClock();

        const res = await getLichWeapons(force);
        if (res.ok) {
            const vendors = normalizeVendors(await res.json());
            if (vendors.length > 0) {
                await dbHelper.set(CACHE_KEY, { data: vendors });
                return vendors;
            }
        }
        return lastKnownGood();
    } catch (e) {
        console.error("Lich weapons error:", e);
        // Si lo que ha fallado es IndexedDB, el rescate fallará igual: se acepta el vacío.
        return lastKnownGood().catch(() => []);
    }
}
