/** @returns {boolean} */
export function isDesktop() {
    return typeof globalThis.__vsNative === "object" && globalThis.__vsNative !== null;
}

/** @returns {"web"|"desktop"} */
export function platform() {
    return isDesktop() ? "desktop" : "web";
}

export async function workerBase() {
    const { WORKER_URL } = await import("../config.js");
    return WORKER_URL;
}

const NATIVE_ROUTES = new Set([
    "wfm_login",
    "wfm_logout",
    "wfm_my_orders",
    "wfm_order_create",
    "wfm_order_edit"
]);

/** @returns {boolean} */
export function isNativeRoute(type) {
    return isDesktop() && NATIVE_ROUTES.has(type);
}

/**
 * @param {string} type
 * @param {{params?: Record<string,string>, method?: string, headers?: Record<string,string>, body?: any}} [opts]
 * @returns {Promise<Response>}
 */
export async function apiCall(type, opts = {}) {
    const { params = {}, method = "GET", headers = {}, body } = opts;

    if (isNativeRoute(type)) {
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
