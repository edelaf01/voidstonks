import { dbHelper } from "../repositories/storage.repository.js";
import { getLichWeapons } from "../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../utils/server_clock.js";

const CACHE_KEY = "lich_weapons_cache";

// Mientras falte algún bonus se reintenta cada media hora: los reportan los jugadores en
// la wiki DESPUÉS de que arranque la ventana, así que la primera lectura suele llegar
// incompleta. Con todos reportados no queda nada que refrescar —el lote y las stats están
// fijados hasta la rotación— y se cachea hasta el corte, sin gastar más peticiones.
const BONUS_RETRY_MS = 30 * 60 * 1000;
const MIN_CACHE_MS = 60 * 1000;

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
 * Rotación activa de Eleanor (Coda) y Ergo Glast (Tenet).
 * @param {boolean} [force] Salta la caché local. Lo usa el refetch al agotarse el contador:
 *   la entrada recién guardada tiene un suelo de 60s y sin esto el reintento se
 *   respondería a sí mismo con la ventana ya caducada.
 * @returns {Promise<Array>} Vendedores con sus armas, o [] si no hay datos.
 */
export async function fetchLichWeapons(force = false) {
    try {
        // Los contadores se pintan contra serverNow(): sin sincronizar, un reloj de
        // sistema desajustado marca la ventana como caducada y dispara refetch en bucle.
        await syncServerClock();

        const cached = await dbHelper.get(CACHE_KEY);
        if (!force && cached?.expiryTime > serverNow()) return cached.data;

        const res = await getLichWeapons(force);
        if (!res.ok) return cached?.data || [];

        const payload = await res.json();
        const vendors = normalizeVendors(payload);
        if (vendors.length === 0) return cached?.data || [];

        const now = serverNow();
        const soonestEnd = Math.min(...vendors.map((v) => Number(v.end) || 0));
        const pending = vendors.some((v) => v.weapons.some((w) => !w.bonus));
        const ceiling = pending ? Math.min(now + BONUS_RETRY_MS, soonestEnd) : soonestEnd;
        const expiryTime = Math.max(now + MIN_CACHE_MS, ceiling);
        await dbHelper.set(CACHE_KEY, { expiryTime, data: vendors });
        return vendors;
    } catch (e) {
        console.error("Lich weapons error:", e);
        return [];
    }
}
