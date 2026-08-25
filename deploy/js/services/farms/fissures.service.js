import { getActiveFissures, getArbitration } from "../../repositories/api.repository.js";
import { serverNow, syncServerClock } from "../server_clock.service.js";

// Sincronización de reloj: UNA llamada mínima no cacheable por sesión. La cabecera Date de las
// respuestas de datos NO sirve para esto: llegan de la caché edge/navegador (con SWR) con la
// Date de cuando se generaron, y usarla inflaba los contadores con la antigüedad de la respuesta
// (p. ej. mostrar 1h27m cuando quedaban 40m).
//
// La implementación vive en services/server_clock.service.js: farms tenía el mismo problema (contador en
// negativo => "ROTATING" con la rotación viva) y tener dos copias del cálculo las dejaba
// divergir. _clockSynced sigue aquí porque solo lo usa el rescate por heurística de más abajo.
let _clockSynced = false;

// Cache en memoria del worldstate (global y de cambio lento): limita las llamadas al worker
// (límite 100k/día) y evita parpadeos al re-renderizar el panel.
const FISSURE_TTL = 120 * 1000; // 2 min
let _fissureCache = { data: null, ts: 0 };
let _inflight = null;
let _fissuresUnavailable = false;

// La cache guarda TODAS las fisuras (incluidas Railjack), ya normalizadas pero SIN aplicar las
// preferencias del usuario: así, cambiar de preferencias solo re-filtra en memoria y no gasta
// una llamada al worker mientras la cache siga dentro del TTL.
const PREFS_KEY = "vs_fissure_prefs";

// Comportamiento por defecto = el histórico: solo estos 4 tipos + Omnia, sin Railjack.
export const DEFAULT_MISSION_TYPES = ["Capture", "Extermination", "Rescue", "Void Cascade"];

// Tipos de misión propios de Railjack (Tormentas del Vacío). Por defecto todos activos:
// al encender el toggle de Railjack se ve todo, y el usuario recorta desde ahí.
export const RAILJACK_MISSION_TYPES = [
    "Skirmish",
    "Volatile",
    "Extermination",
    "Survival",
    "Defense",
    "Spy",
    "Orphix",
];

const DEFAULT_PREFS = {
    missionTypes: DEFAULT_MISSION_TYPES,
    includeOmnia: true,
    includeRailjack: false,
    railjackTypes: RAILJACK_MISSION_TYPES,
};

/**
 * Lee las preferencias de fisuras guardadas por el usuario (localStorage).
 * Si no hay nada guardado, o el valor es inválido, devuelve el default (= comportamiento actual).
 * @returns {{missionTypes: string[], includeOmnia: boolean, includeRailjack: boolean}}
 */
export function getFissurePrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return { ...DEFAULT_PREFS, missionTypes: [...DEFAULT_MISSION_TYPES] };

        const parsed = JSON.parse(raw);
        return {
            missionTypes: Array.isArray(parsed.missionTypes)
                ? parsed.missionTypes.filter((x) => typeof x === "string")
                : [...DEFAULT_MISSION_TYPES],
            includeOmnia: typeof parsed.includeOmnia === "boolean" ? parsed.includeOmnia : true,
            includeRailjack: typeof parsed.includeRailjack === "boolean" ? parsed.includeRailjack : false,
            railjackTypes: Array.isArray(parsed.railjackTypes)
                ? parsed.railjackTypes.filter((x) => typeof x === "string")
                : [...RAILJACK_MISSION_TYPES],
        };
    } catch (e) {
        console.error("Error leyendo preferencias de fisuras:", e);
        return { ...DEFAULT_PREFS, missionTypes: [...DEFAULT_MISSION_TYPES], railjackTypes: [...RAILJACK_MISSION_TYPES] };
    }
}

/**
 * Guarda las preferencias de fisuras del usuario en localStorage.
 * @param {{missionTypes: string[], includeOmnia: boolean, includeRailjack: boolean}} prefs
 */
export function saveFissurePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        console.error("Error guardando preferencias de fisuras:", e);
    }
}

function passesPrefs(f, prefs) {
    // Railjack (isStorm) tiene sus propios missionType (no están en la lista de tipos "normales"):
    // su visibilidad depende del toggle dedicado más su propia lista de tipos.
    if (f.isStorm) return !!prefs.includeRailjack && prefs.railjackTypes.includes(f.type);

    const typeMatch = prefs.missionTypes.includes(f.type);
    const omniaMatch = prefs.includeOmnia && f.tier === "Omnia";
    return typeMatch || omniaMatch;
}

/**
 * Fetches TODAS las fisuras activas normalizadas (incl. Railjack), sin aplicar las preferencias
 * de vista del usuario. Es la fuente para el panel (que luego filtra por prefs) y para las
 * alarmas de fisuras (que deben ver todo, no solo lo que el usuario muestra).
 * @param {boolean} [force=false] - Ignora la cache en memoria y fuerza recarga.
 * @returns {Promise<Array>}
 */
export async function fetchAllFissures(force = false) {
    if (!force && _fissureCache.data && (Date.now() - _fissureCache.ts < FISSURE_TTL)) {
        return _fissureCache.data;
    }
    // Una sola petición para todos los que pidan a la vez. El panel de rutas se pinta en tres
    // sitios y cada instancia pedía la suya: con el worker frío, la que se comía el timeout de
    // 15 s pintaba "esperando fisura" sobre eras que el panel de al lado enseñaba abiertas.
    if (force || !_inflight) {
        _inflight = loadFissures(force).finally(() => { _inflight = null; });
    }
    return _inflight;
}

/** Si el último intento se quedó sin datos que servir. Separa "no hay fisura de esa era" de
 *  "no lo sabemos", que es la diferencia entre informar y mentir. */
export function fissuresUnavailable() {
    return _fissuresUnavailable;
}

async function loadFissures(force) {
    let allFissures;
    try {
        // El ping de hora corre en paralelo al fetch de datos; solo se espera al final.
        const clockSync = syncServerClock();
        const res = await getActiveFissures(force);
        if (!res.ok) throw new Error("Error al conectar con el Worldstate");

        let fissures = await res.json();

        if (typeof fissures === "string") {
            // Algunas respuestas del parser llegan como string JSON en vez de objeto.
            try { fissures = JSON.parse(fissures); } catch (e) {
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

        await clockSync;

        // Respaldo si el ping de hora falló: auto-detección de desfase a partir de los propios
        // datos. El servidor SOLO devuelve fisuras activas (expiry > serverNow). Si el Date.now()
        // del cliente ya supera la primera expiración, el reloj local va adelantado. Solo corre
        // sin sincronización real: con datos stale del caché daría un falso positivo.
        if (!_clockSynced && fissures.length > 0 && !globalThis._serverTimeOffset) {
            const expiryTimes = fissures.map(f => new Date(f.expiry).getTime());
            const activationTimes = fissures.map(f => new Date(f.activation).getTime());
            const earliestExpiry = Math.min(...expiryTimes);
            const latestActivation = Math.max(...activationTimes);

            if (Date.now() > earliestExpiry) {
                // El reloj va adelantado: la mejor estimación del "ahora real" es el punto
                // medio entre la activación más reciente y la expiración más próxima.
                globalThis._serverTimeOffset = Date.now() - (latestActivation + earliestExpiry) / 2;
                console.warn(`[FISSURES] Desfase de reloj detectado: ${Math.round(globalThis._serverTimeOffset / 60000)}min. Corrigiendo.`);
            }
        }

        const now = new Date(Date.now() - (globalThis._serverTimeOffset || 0));

        allFissures = fissures.reduce((acc, f) => {
            const expiryDate = new Date(f.expiry);
            if (expiryDate <= now) return acc;

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
                expiry: f.expiry,
                isSP: f.isHard === true,
                isOmnia: f.tier === "Omnia",
                isStorm: f.isStorm === true,
            });
            return acc;
        }, []);

        _fissureCache = { data: allFissures, ts: Date.now() };
        _fissuresUnavailable = false;
    } catch (e) {
        console.error("Error en Worldstate:", e);
        // Fallo transitorio (timeout/cold start): no vacíes la lista, devuelve lo último bueno.
        allFissures = _fissureCache.data || [];
        // Sin nada cacheado no hay lista vieja que valga: quien pinte con esto tiene que
        // poder decir que no se sabe, no dar por hecho que no hay fisuras.
        _fissuresUnavailable = allFissures.length === 0;
    }

    return allFissures;
}

/**
 * Fisuras activas con las preferencias de vista del usuario aplicadas (tipos, Omnia, Railjack).
 * @param {boolean} [force=false] - Ignora la cache en memoria y fuerza recarga.
 * @returns {Promise<Array>}
 */
export async function fetchBestFissures(force = false) {
    const allFissures = await fetchAllFissures(force);
    const prefs = getFissurePrefs();
    return allFissures.filter((f) => passesPrefs(f, prefs));
}

/**
 * Cuántas fisuras activas esconden ahora mismo las preferencias de vista.
 *
 * El valor de fábrica solo enseña cuatro tipos de misión, así que quien no abra el panel de
 * filtros ve una lista recortada sin ninguna señal de que lo está. Vive aquí y no en el
 * componente porque es la misma pregunta que contestan fetchAll/fetchBest, y sale de restarlas.
 * @param {number} nowMs reloj ya sincronizado con el servidor.
 */
export async function countHiddenFissures(nowMs = Date.now()) {
    const vivas = (f) => !f.expiry || (new Date(f.expiry) - nowMs) > 0;
    const todas = (await fetchAllFissures()).filter(vivas);
    const prefs = getFissurePrefs();
    return todas.filter((f) => !passesPrefs(f, prefs)).length;
}

/**
 * Tipos de misión presentes ahora mismo en los datos, separados por origen. El panel de filtros
 * los fusiona con su lista fija: si DE saca un tipo nuevo (o falta uno en la lista), sigue siendo
 * filtrable en vez de quedar oculto sin casilla. Lee la cache, no dispara fetch.
 * @returns {{normal: string[], railjack: string[]}}
 */
export function getObservedMissionTypes() {
    const data = _fissureCache.data || [];
    const normal = new Set();
    const railjack = new Set();
    for (const f of data) {
        if (!f.type) continue;
        (f.isStorm ? railjack : normal).add(f.type);
    }
    return { normal: [...normal], railjack: [...railjack] };
}

// Tiers comunitarios de Arbitración por NODO (discord.gg/Arbitrations, VE/min con squad
// óptimo). FALLBACK cliente: el parser ya trae el tier desde browse.wf/arbyTiers, pero si
// esa fuente falla o no cubre el nodo, sin esto el badge no se pinta y las alarmas por
// tier mínimo no pueden disparar. Clave = nombre base del nodo (sin "(Planeta)").
const ARBY_NODE_TIERS = {
    "Tyana Pass": "S", "Alator": "S", "Callisto": "S", "Xini": "S", "Cytherean": "S",
    "Munio": "A", "Seimeni": "A", "Cinxia": "A", "Casta": "A", "Oestrus": "A", "Hyf": "A",
    "Larzac": "B", "Sechura": "B", "Hydron": "B", "Helene": "B", "Ose": "B", "Akkad": "B",
    "Kala-azar": "B", "Odin": "B", "Mithra": "B", "Belenus": "B", "Taranis": "B",
    "Coba": "C", "Spear": "C", "Kadesh": "C", "Paimon": "C", "Lith": "C",
    "Stephano": "C", "Tessera": "C", "Outer Terminus": "C",
    "Umbriel": "D", "Cerberus": "D", "Lares": "D", "Sangeru": "D", "Sinai": "D",
    "Gulliver": "D", "Romula": "D", "Proteus": "D", "Io": "D", "Stöfler": "D", "Gaia": "D",
};

// Nombre base del nodo: "Sechura (Pluto)" -> "Sechura".
const arbyBaseNode = (node) => (node || "").replace(/\s*\([^)]*\)\s*$/, "").trim();

// Rellena m.tier con el fallback comunitario cuando el parser no lo trae.
function fillArbyTier(m) {
    if (m && !m.tier) {
        const t = ARBY_NODE_TIERS[arbyBaseNode(m.node)];
        if (t) m.tier = t;
    }
    return m;
}

// La Arbitration rota cada hora en punto: la cache en memoria vale hasta la expiración de la
// actual, así cada cliente hace como mucho 1 llamada al parser por rotación.
let _arbyCache = { data: null };

/**
 * Fetches the current + upcoming Arbitration from the fissures parser worker.
 * @param {boolean} [force=false]
 * @returns {Promise<{current: Object|null, upcoming: Array}|null>}
 */
export async function fetchArbitration(force = false) {
    const cached = _arbyCache.data;
    if (!force && cached?.current && new Date(cached.current.expiry) > new Date(Date.now() - (globalThis._serverTimeOffset || 0))) {
        return cached;
    }
    try {
        const res = await getArbitration(force);
        if (!res.ok) throw new Error(`Arbitration HTTP ${res.status}`);
        const payload = await res.json();
        // El worker principal devuelve el objeto directo; el parser lo envuelve en {data}.
        const data = payload?.data ?? payload ?? null;
        if (data?.current) {
            fillArbyTier(data.current);
            (data.upcoming || []).forEach(fillArbyTier);
            _arbyCache = { data };
        }
        return data?.current ? data : cached;
    } catch (e) {
        console.error("Error obteniendo Arbitration:", e);
        return cached || null;
    }
}

/**
 * Arbitración ACTIVA ahora mismo como lista para el motor de alarmas: si la
 * "current" del parser ya expiró, promociona la rotación de `upcoming` que esté
 * en curso (misma lógica que renderArbitrationBar). [] si no hay ninguna válida.
 */
export async function fetchActiveArbitration() {
    const arby = await fetchArbitration();
    const now = new Date(Date.now() - (globalThis._serverTimeOffset || 0));
    let cur = arby?.current;
    if (cur && new Date(cur.expiry) <= now) {
        cur = (arby.upcoming || []).find(
            (m) => new Date(m.activation) <= now && new Date(m.expiry) > now,
        ) || null;
    }
    return cur && new Date(cur.expiry) > now ? [cur] : [];
}
