import { WORKER_URL } from "../../config.js";

/**
 * Sesión de Warframe Market: login, logout y estado del token. Nada más.
 *
 * Las órdenes y los precios viven en wfm_orders.service.js, que solo le pide el
 * token: así este módulo puede reescribirse entero el día que WFM abra OAuth sin
 * arrastrar consigo la lógica del mercado.
 *
 * Login por email+contraseña contra la API v1 a través del worker (api.warframe.market
 * no envía cabeceras CORS, así que el navegador no puede llamarla directamente).
 * Se usa v1 porque el signin v2 exige App Check y está reservado al cliente oficial,
 * y porque OAuth sigue cerrado a terceros.
 *
 * La contraseña se usa UNA vez para obtener el JWT y no se guarda jamás: solo se
 * persiste el token. Va en sessionStorage a propósito (muere al cerrar la pestaña),
 * lo que reduce la ventana de exposición ante un XSS.
 *
 * Si algún día WFM abre el registro de clientes OAuth, basta con reescribir este
 * módulo: el resto de la app no conoce estos detalles.
 */

const TOKEN_KEY = "wfm_jwt";
const NAME_KEY = "wfm_name";
const SLUG_KEY = "wfm_slug";
const SCOPE_KEY = "wfm_scope";
// Sesiones anteriores guardaban aquí el estado del mercado (ingame/online/invisible).
// Ya no se escribe —el cambio de estado se retiró—, pero el logout lo sigue limpiando
// para no dejar el rastro en navegadores que lo tengan de antes.
const STATUS_KEY = "wfm_status";
const EXPIRY_KEY = "wfm_exp";
const PLATFORM_KEY = "wfm_platform";

/**
 * Caducidad propia, mucho más corta que la del JWT de WFM (60 días).
 * El token da acceso TOTAL a la cuenta y no tiene scopes, así que cuanto menos
 * tiempo viva en el navegador, menor es la ventana ante un XSS.
 */
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 horas

/** Quita el prefijo "JWT " y las comillas que suelen colarse al copiar de DevTools. */
function normalizeToken(raw) {
    if (!raw) return "";
    return raw.trim().replace(/^JWT\s+/i, "").replace(/^["']|["']$/g, "").trim();
}

/**
 * Valida la forma del JWT y devuelve su payload, o null si no es utilizable.
 * No verifica la firma (eso solo puede hacerlo WFM); descarta pegados obviamente rotos.
 * @param {string} token
 * @returns {object|null}
 */
export function decodeToken(token) {
    const parts = normalizeToken(token).split(".");
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        return typeof payload === "object" && payload ? payload : null;
    } catch {
        return null;
    }
}

/** @returns {boolean} true si el token existe y no ha caducado. */
export function isTokenValid(token) {
    const payload = decodeToken(token);
    if (!payload?.exp) return false;
    return payload.exp * 1000 > Date.now();
}

/** @returns {string|null} el token guardado, o null si falta o ya caducó. */
export function getToken() {
    let stored = null;
    try {
        stored = sessionStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
    if (!stored) return null;

    // Nuestra caducidad manda sobre la del JWT: aunque WFM lo acepte 60 días,
    // la sesión local expira antes y obliga a volver a conectarse.
    const until = parseInt(sessionStorage.getItem(EXPIRY_KEY) || "0", 10);
    if (!until || Date.now() > until) {
        clearToken();
        return null;
    }
    if (!isTokenValid(stored)) {
        clearToken();
        return null;
    }
    return stored;
}

/**
 * Inicia sesión en Warframe Market.
 *
 * La contraseña se envía una sola vez al worker, que la reenvía a WFM; ni el worker
 * ni la app la almacenan en ningún momento.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} [platform] pc | ps4 | xbox | switch | mobile
 * @returns {Promise<{ok: boolean, ingameName?: string, error?: string}>}
 */
export async function login(email, password, platform = "pc") {
    if (!email || !password) return { ok: false, error: "missing_fields" };

    // Email y contraseña se cifran aquí: al worker solo llega un sobre que su clave
    // privada puede abrir. Si el cifrado no está disponible se envía en claro, que es
    // lo que hacía antes; el worker lo rechaza si ya tiene clave configurada.
    let payload = { email, password, platform };
    try {
        const { sealCredentials } = await import("../../utils/wfm_crypto.js");
        const sealed = await sealCredentials({ email, password });
        if (sealed) payload = { sealed, platform };
    } catch { /* sin cifrado: sigue el envío directo */ }

    let res;
    try {
        res = await fetch(`${WORKER_URL}?type=wfm_login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch {
        return { ok: false, error: "network" };
    }

    let body;
    try {
        body = await res.json();
    } catch {
        return { ok: false, error: "server" };
    }

    if (!res.ok || !body?.token) {
        if (res.status === 429) return { ok: false, error: "rate_limited" };
        return { ok: false, error: body?.error || "invalid_credentials" };
    }

    const token = normalizeToken(body.token);
    if (!isTokenValid(token)) return { ok: false, error: "server" };

    // El signin v1 no siempre devuelve una sesión que la API v2 acepte. Cuando pasa,
    // seguimos adelante con el slug del perfil: las órdenes públicas se leen sin token.
    // Solo es un fallo irrecuperable si además no sabemos el slug.
    const slug = (body.userSlug || body.ingameName || "").toLowerCase();
    if (!body.authorized && !slug) {
        return { ok: false, error: "token_rejected", diag: body.diag };
    }

    try {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + SESSION_TTL_MS));
        if (body.ingameName) sessionStorage.setItem(NAME_KEY, body.ingameName);
        if (slug) sessionStorage.setItem(SLUG_KEY, slug);
        sessionStorage.setItem(SCOPE_KEY, body.authorized ? "full" : "public");
        // La vigilancia del mercado necesita saber en qué plataforma juegas: escuchar
        // el flujo de PC a un jugador de consola daría alertas de órdenes ajenas.
        sessionStorage.setItem(PLATFORM_KEY, platform);
    } catch {
        return { ok: false, error: "storage" };
    }

    return {
        ok: true,
        ingameName: body.ingameName || null,
        authorized: !!body.authorized
    };
}

/** @returns {string|null} nombre in-game de la sesión actual, si se conoce. */
export function getIngameName() {
    try {
        return sessionStorage.getItem(NAME_KEY);
    } catch {
        return null;
    }
}

/** @returns {string|null} slug del perfil, usado para leer las órdenes públicas. */
export function getUserSlug() {
    try {
        return sessionStorage.getItem(SLUG_KEY);
    } catch {
        return null;
    }
}

/**
 * Alcance real de la sesión:
 *  "full"   -> el JWT autoriza la API v2 (incluye órdenes ocultas, permitirá escritura)
 *  "public" -> solo lectura de las órdenes visibles del perfil
 * @returns {"full"|"public"|null}
 */
export function getScope() {
    try {
        return sessionStorage.getItem(SCOPE_KEY);
    } catch {
        return null;
    }
}

/**
 * Registra el alcance que el worker dice haber servido (cabecera X-WFM-Scope).
 * Lo llama quien lee las órdenes: el scope real solo se conoce al usar el token,
 * no al obtenerlo, así que la sesión se corrige en cada carga.
 * @param {string|null} served valor de la cabecera; se ignora si no es válido
 */
export function cacheScope(served) {
    if (served !== "full" && served !== "public") return;
    try {
        sessionStorage.setItem(SCOPE_KEY, served);
    } catch { /* sessionStorage no disponible */ }
}

/** @returns {string} plataforma elegida al conectarse; "pc" si no consta. */
export function getPlatform() {
    try {
        return sessionStorage.getItem(PLATFORM_KEY) || "pc";
    } catch {
        return "pc";
    }
}

/** Borra la sesión local. No invalida el token en WFM: para eso está logout(). */
export function clearToken() {
    try {
        for (const k of [TOKEN_KEY, NAME_KEY, SLUG_KEY, SCOPE_KEY, STATUS_KEY, EXPIRY_KEY,
            PLATFORM_KEY]) {
            sessionStorage.removeItem(k);
        }
    } catch { /* sessionStorage no disponible */ }
}

/**
 * Cierre de sesión completo: revoca el token en WFM y luego borra el local.
 * Sin la revocación el token seguiría sirviendo 60 días aunque el usuario "saliera".
 * La sesión local se limpia pase lo que pase con la revocación.
 * @returns {Promise<{ok: boolean, revoked: boolean}>}
 */
export async function logout() {
    const token = getToken();
    let revoked = false;

    if (token) {
        try {
            const res = await fetch(`${WORKER_URL}?type=wfm_logout`, {
                method: "POST",
                headers: { "X-WFM-Token": token }
            });
            if (res.ok) revoked = !!(await res.json())?.revoked;
        } catch { /* sin red: se cierra igual en local */ }
    }

    clearToken();
    return { ok: true, revoked };
}

/**
 * Hay sesión si el JWT sigue vigente o, en su defecto, si conocemos el slug
 * (modo público: se pueden leer las órdenes visibles sin token).
 * @returns {boolean}
 */
export function isLoggedIn() {
    return getToken() !== null || getUserSlug() !== null;
}
