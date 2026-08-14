import { WORKER_URL } from "../config.js";
import { state } from "../state.js";
import { dbHelper } from "./storage.repository.js";

async function fetchWithTimeout(url, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

/* --------------------------------------------------------------------------------------
 * Política de caché HTTP
 *
 * El ttl que calcula el worker NO llega al navegador. El zone de Cloudflare reescribe el
 * Cache-Control de TODO lo que sirve desde su caché a `max-age=18000` (5 h). Medido contra
 * producción, mismo endpoint y con 3 s de diferencia:
 *
 *   x-cache: MISS         -> cache-control: public, max-age=1135   (lo que dice el worker)
 *   cf-cache-status: HIT  -> cache-control: public, max-age=18000
 *
 * Es configuración de zona, no del worker: el mismo código servido desde
 * wf-parser.edelamf0.workers.dev (un *.workers.dev, sin Cache Rules) devuelve su max-age=300
 * intacto. O sea que desde este repo NO se puede arreglar en el origen, solo aquí.
 *
 * Consecuencia: cualquier respuesta se queda hasta 5 h guardada en el navegador, que la
 * sirve sin salir a la red. Para las bounties (rotan cada 2,5 h) eso significaba leer el
 * ciclo anterior durante dos rotaciones, con el expiry ya pasado: "ROTATING" clavado del que
 * no se salía ni forzando el refetch ni recargando la página.
 *
 * Así que el cliente declara la vida de cada dato y se protege él. Tres clases, por USO:
 *
 *   rotating  Caduca a una hora concreta (fisuras, bounties, arbitración, armas de lich).
 *             Estos datos ya se cachean por rotación aguas arriba (IndexedDB o memoria), así
 *             que si una petición llega hasta aquí es porque esa copia caducó: la del
 *             navegador está igual de vieja y no debe responder nunca. -> fetchRotating()
 *   live      Solo vale el valor de AHORA: la hora del servidor y el buzón de sync. Ni
 *             cachear ni revalidar; una copia es directamente un dato falso. -> fetchLive()
 *   catálogo  Cambia con los parches del juego (relics_opt, prime_items_list, aya, precios).
 *             Aquí la caché del navegador es justo lo que se quiere y las 5 h no molestan:
 *             se piden con fetchWithTimeout a pelo y sin opciones de caché.
 * ------------------------------------------------------------------------------------ */

/**
 * Datos que caducan a una hora concreta. `no-cache` obliga al navegador a revalidar siempre
 * (Cloudflare ignora el no-cache del cliente, así que el edge sigue absorbiendo la carga y
 * el worker no ve ni una petición más).
 * @param {string} query Querystring del worker, sin el "?" inicial.
 * @param {{force?: boolean, timeout?: number}} [opts] force estrena clave de caché para
 *   esquivar también al edge: su stale-while-revalidate le deja servir la ventana vieja un
 *   par de minutos más, justo los que importan cuando se acaba de rotar.
 * @returns {Promise<Response>}
 */
async function fetchRotating(query, { force = false, timeout = 15000 } = {}) {
    let url = `${WORKER_URL}?${query}`;
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, { cache: "no-cache", timeout });
}

/**
 * Datos de los que solo sirve el valor actual. `no-store` en vez de `no-cache`: aquí ni
 * siquiera interesa revalidar contra una copia, porque no hay copia que pueda valer.
 * @param {string} query Querystring del worker, sin el "?" inicial.
 * @param {{timeout?: number}} [opts]
 * @returns {Promise<Response>}
 */
async function fetchLive(query, { timeout = 10000 } = {}) {
    return fetchWithTimeout(`${WORKER_URL}?${query}`, { cache: "no-store", timeout });
}

/**
 * Loads raw relic/mission/bounty data from IDB cache or worker.
 * @param {string} cacheKey
 * @param {number} cacheTtl
 * @returns {Promise<object>}
 */
export async function loadRelicsData(cacheKey, cacheTtl) {
    try {
        const cachedRecord = await dbHelper.get(cacheKey);
        if (cachedRecord && Date.now() - cachedRecord.timestamp < cacheTtl) {
            return cachedRecord.data;
        }
    } catch (e) {
        console.warn("Cache local ignorada:", e);
    }

    const [relicsRes, missionsRes, bountiesRes] = await Promise.all([
        fetchWithTimeout(`${WORKER_URL}?type=relics_opt`),
        fetchWithTimeout(`${WORKER_URL}?type=missions_opt`),
        fetchWithTimeout(`${WORKER_URL}?type=bounties_opt`),
    ]);

    if (!relicsRes.ok || !missionsRes.ok || !bountiesRes.ok) {
        throw new Error("Worker Error (Partial)");
    }

    const [rData, mData, bData] = await Promise.all([
        relicsRes.json(),
        missionsRes.json(),
        bountiesRes.json(),
    ]);

    const rawData = {
        relics: rData.relics || [],
        missionRewards: mData.missionRewards || {},
        cetusBountyRewards: bData.cetus || [],
        solarisBountyRewards: bData.solaris || [],
        zarimanRewards: bData.zariman || [],
        deimosRewards: bData.deimos || [],
    };

    await dbHelper.set(cacheKey, { timestamp: Date.now(), data: rawData });
    return rawData;
}

/**
 * Fetches the prime manifest (entities) and populates state.primeManifest.
 */
export async function fetchPrimeManifest() {
    try {
        const [resEntities, resWeapons] = await Promise.all([
            fetch("assets/json/cleaned_entities.json"),
            fetch("assets/json/cleaned_weapons.json").catch(() => null)
        ]);

        if (!resEntities.ok) throw new Error("Entities Load Failed");
        const data = await resEntities.json();
        state.primeManifest = data;
        state.entitiesDB = data;
        console.log("Entities Manifest Loaded:", data.length, "items");
        
        const { updateDucatsDB } = await import("../services/inventory/relics.service.js");
        updateDucatsDB(data);

        if (resWeapons && resWeapons.ok) {
            const weaponsData = await resWeapons.json();
            const primeWeapons = weaponsData.filter(item => item.isPrime);
            console.log("Prime Weapons Loaded for Ducats:", primeWeapons.length, "items");
            updateDucatsDB(primeWeapons);
        }
    } catch (e) {
        console.warn("Error loading entities/weapons manifest:", e);
    }
}

/**
 * Loads the prime items list for OCR matching into state.ocrReferenceList.
 */
export async function initializeOCRDatabase() {
    try {
        const res = await fetchWithTimeout(`${WORKER_URL}?type=prime_items_list`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        state.ocrReferenceList = data.items;
    } catch (e) {
        console.error("Error detallado al cargar referencia OCR:", e);
        throw e;
    }
}

/**
 * Fetches the active resurgence list (Aya items) from the worker 'aya' endpoint with a 1-day cache.
 */
export async function fetchActiveResurgence() {
    const CACHE_KEY = "voidstonks_active_resurgence_list_v2";
    const ONE_DAY = 24 * 60 * 60 * 1000;
    try {
        const cached = await dbHelper.get(CACHE_KEY);
        if (cached?.data && cached?.timestamp && (Date.now() - cached.timestamp < ONE_DAY)) {
            state.activeResurgenceList = new Set(cached.data);
            return;
        }

        const res = await fetchWithTimeout(`${WORKER_URL}?type=aya`);
        if (!res.ok) return;
        const data = await res.json();
        const traders = data.PrimeVaultTraders || [];
        
        const resurgenceSet = new Set();
        traders.forEach(trader => {
            if (trader.Closed) return;
            const manifest = trader.Manifest || [];
            manifest.forEach(item => {
                const itemName = item.ItemType;
                if (itemName && itemName.includes("Relic")) {
                    const cleaned = itemName.replace(" Relic", "").trim().toUpperCase();
                    resurgenceSet.add(cleaned);
                }
            });
        });

        state.activeResurgenceList = resurgenceSet;
        await dbHelper.set(CACHE_KEY, { timestamp: Date.now(), data: Array.from(resurgenceSet) });
    } catch (e) {
        console.warn("Error fetching resurgence list:", e);
    }
}

/**
 * Sends a synchronization message to the Cloudflare Worker.
 * @param {string} code - The 4-digit code.
 * @param {string} val - The message content.
 * @returns {Promise<Response>}
 */
export async function sendSyncMessage(code, val) {
    // El buzón vive 60s en KV, pero la escritura viaja en un GET: si el navegador responde
    // desde su caché, NO llega a salir la petición y el mensaje no se escribe. Reenviar el
    // mismo texto con el mismo código (el caso típico: "no le ha llegado, dale otra vez")
    // no hacía nada durante 5 h.
    return fetchLive(`type=sync_set&id=${code}&val=${encodeURIComponent(val)}`, { timeout: 8000 });
}

/**
 * Retrieves a synchronization message from the Cloudflare Worker.
 * @param {string} code - The 4-digit code.
 * @returns {Promise<Response>}
 */
export async function getSyncMessage(code) {
    // Buzón efímero (60s de vida en KV) que se consulta en bucle esperando al otro
    // dispositivo: la respuesta cacheada es justo el mensaje viejo que se quiere superar.
    return fetchLive(`type=sync_get&id=${code}`, { timeout: 8000 });
}

/**
 * Fetches user profile data from the worker.
 * @param {string} username
 * @param {string} platform
 * @returns {Promise<Response>}
 */
export async function getProfileData(username, platform) {
    // El worker le pone 300s de ttl porque un perfil cambia al jugar, y quien lo consulta
    // dos veces seguidas es porque espera ver el cambio. Con la reescritura del zone la
    // segunda consulta ni salía a la red en 5 h: se revalida siempre.
    return fetchWithTimeout(
        `${WORKER_URL}?type=profile&platform=${platform}&user=${encodeURIComponent(username)}`,
        { cache: "no-cache" },
    );
}

/**
 * Fetches batch prices for items chunk from the worker.
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getPricesBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_batch&q=${chunk.join(",")}`);
}

/**
 * Mapa slug->precio de todo el catálogo prime (~750 entradas, 4 KB comprimido).
 *
 * Url fija a propósito: es lo que hace que el edge sirva la MISMA entrada a todos los
 * clientes. Un lote `q=<slugs>` lleva el inventario del usuario en la clave de caché y
 * por eso nunca acierta; pedirlo entero sale más barato que describir el subconjunto.
 * @returns {Promise<Response>}
 */
export async function getPricesSnapshot() {
    return fetchWithTimeout(`${WORKER_URL}?type=prices_snapshot`, { timeout: 15000 });
}

/**
 * Fetches price + liquidity stats for a chunk of arcane slugs (Vosfor calculator).
 * Timeout alto: el worker puede tener que pedir órdenes + histórico a WFM por cada slug.
 * @param {Array<string>} chunk
 * @returns {Promise<Response>}
 */
export async function getArcaneBatch(chunk) {
    return fetchWithTimeout(`${WORKER_URL}?type=arcane_batch&q=${chunk.join(",")}`, { timeout: 25000 });
}

/**
 * Fetches active bounty data from the worker.
 * @param {boolean} [force] Reintento tras una rotación: además de revalidar, esquiva la
 *   copia del edge (ver abajo).
 * @returns {Promise<Response>}
 */
export async function getActiveBounties(force = false) {
    // &v=2 estrena una clave de caché en Cloudflare: la respuesta anterior se cacheó con
    // stale-while-revalidate=86400 (24h) y servía bounties caducadas ("ROTATING") tras
    // cada rotación. La versión nueva del worker ya declara swr corto; el parámetro evita
    // seguir golpeando la copia envenenada mientras esa expira. Mismo truco que fissures.
    return fetchRotating("type=active_bounties&v=2", { force });
}

/**
 * Fetches active fissure data from the worker with cache-busting.
 * @returns {Promise<Response>}
 */
export async function getActiveFissures(force = false) {
    return fetchRotating("type=fissures&v=2", { force });
}

/**
 * Fetches the current + upcoming Arbitration rotations. Mismo flujo que las fisuras:
 * worker principal -> wf-parser (que lee el calendario determinista de browse.wf).
 * @returns {Promise<Response>}
 */
export async function getArbitration(force = false) {
    return fetchRotating("type=arbitration", { force });
}

/**
 * Rotación de armas de adversario (Eleanor / Ergo Glast). El worker calcula la ventana
 * activa y adjunta stats y bonus de valencia.
 * @returns {Promise<Response>}
 */
export async function getLichWeapons(force = false) {
<<<<<<< Updated upstream
    let url = `${WORKER_URL}?type=lich_weapons`;
    // El ttl del worker vence justo al rotar, pero su stale-while-revalidate deja al edge
    // servir la ventana vieja hasta 5 min más. Solo en el refetch de rotación se estrena
    // clave de caché para ver el lote nuevo al momento; un render normal debe seguir
    // cayendo en la entrada compartida.
    if (force) url += `&_cb=${Date.now()}`;
    return fetchWithTimeout(url, { timeout: 15000 });
=======
    // &v=2 estrena clave de caché. Mientras el handler no estaba desplegado, el worker
    // respondía a este tipo con su fallback {"status":"Ready"} y max-age=86400: los
    // navegadores que llegaron a pedirlo se guardaron ESA respuesta 24 h y seguían
    // sirviéndosela a sí mismos sin salir a la red, así que el apartado salía vacío
    // aunque el worker ya estuviera bien. Mismo truco que bounties y fisuras.
    return fetchRotating("type=lich_weapons&v=2", { force });
>>>>>>> Stashed changes
}

/**
 * Pide la hora del servidor para sincronizar los contadores del cliente. Es LA referencia
 * de todos los contadores: una hora cacheada desajusta justo lo que viene a corregir.
 * @returns {Promise<Response>}
 */
export async function getServerTime() {
    return fetchLive("type=time");
}
