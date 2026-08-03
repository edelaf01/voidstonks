/**
 * Detección de entorno y capa de red conmutable, para poder empaquetar la app como
 * escritorio sin duplicar código.
 *
 * NADA de lo que ya existe depende de esto todavía: es un añadido. Los módulos actuales
 * siguen llamando a WORKER_URL como siempre. La migración a apiCall() se hará pieza a
 * pieza, empezando por el login, que es lo que en escritorio irá directo a WFM (sin CORS
 * ni HttpOnly, como un script) en vez de pasar por el worker.
 *
 * En la WEB todo sigue igual: apiCall() reenvía al worker, byte por byte como hoy.
 * En ESCRITORIO, un puente nativo (Tauri/Electron) expondrá globalThis.__vsNative y
 * apiCall() lo usará para las rutas que no deban tocar el worker.
 */

/**
 * ¿Corre dentro de un empaquetado de escritorio?
 *
 * Se detecta por la presencia del puente nativo, no por el user-agent: el WebView de
 * Tauri/Electron se identifica de formas distintas y cambiantes, pero el puente solo
 * existe si lo inyecta el contenedor. Es la señal fiable.
 *
 * @returns {boolean}
 */
export function isDesktop() {
    return typeof globalThis.__vsNative === "object" && globalThis.__vsNative !== null;
}

/** @returns {"web"|"desktop"} etiqueta del entorno, para ramas y telemetría. */
export function platform() {
    return isDesktop() ? "desktop" : "web";
}

/**
 * URL base del worker. Función y no constante para que el destino pueda cambiar en el
 * futuro (un usuario de escritorio podría apuntar a su propio worker) sin tocar el
 * resto. Hoy devuelve el de producción, igual que la constante WORKER_URL de config.js.
 *
 * Se lee de config.js para no duplicar el literal: si un día cambia el dominio, cambia
 * en un solo sitio.
 */
export async function workerBase() {
    const { WORKER_URL } = await import("../config.js");
    return WORKER_URL;
}

/**
 * Rutas que en escritorio NO deben pasar por el worker, porque son credenciales del
 * usuario y el sentido de empaquetar es justamente que no las toque un servidor ajeno.
 * El resto (precios, catálogo, fisuras...) sí sigue yendo al worker: son datos
 * compartidos y cacheados, no tiene sentido pedirlos 1:1 desde cada escritorio.
 */
const NATIVE_ROUTES = new Set([
    "wfm_login",
    "wfm_logout",
    "wfm_my_orders",
    "wfm_order_create",
    "wfm_order_edit"
]);

/** @returns {boolean} true si esa ruta debe ir por el puente nativo en escritorio. */
export function isNativeRoute(type) {
    return isDesktop() && NATIVE_ROUTES.has(type);
}

/**
 * Punto único de llamada a la API.
 *
 * En web: construye la URL del worker y hace fetch, exactamente como el código actual.
 * En escritorio y ruta de credenciales: delega en el puente nativo, que hablará con WFM
 * directo (sin CORS, como un script de Python).
 *
 * Se ofrece como alternativa OPCIONAL: los módulos existentes no están obligados a
 * migrar. Un módulo nuevo, o uno que se toque, puede empezar a usar esto.
 *
 * @param {string} type valor de ?type= del worker (o nombre de comando nativo)
 * @param {{params?: Record<string,string>, method?: string, headers?: Record<string,string>, body?: any}} [opts]
 * @returns {Promise<Response>} misma forma que fetch, para no obligar a cambiar a quien la consuma
 */
export async function apiCall(type, opts = {}) {
    const { params = {}, method = "GET", headers = {}, body } = opts;

    if (isNativeRoute(type)) {
        // El puente nativo devuelve algo con forma de Response (status + json/text) para
        // que el llamante no note la diferencia con el camino web.
        return globalThis.__vsNative.call(type, { params, method, headers, body });
    }

    const base = await workerBase();
    const qs = new URLSearchParams({ type, ...params }).toString();
    const init = { method, headers };
    if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (!headers["Content-Type"]) init.headers = { ...headers, "Content-Type": "application/json" };
    }
    return fetch(`${base}?${qs}`, init);
}
