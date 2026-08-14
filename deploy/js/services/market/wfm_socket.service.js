import { getToken } from "./wfm_auth.service.js";

/**
 * Cliente WebSocket de Warframe Market.
 *
 * Sirve para escuchar el flujo de órdenes nuevas del mercado: es la única forma de
 * seguir los precios en vivo sin machacar su API a peticiones.
 *
 * A diferencia de la API HTTP, este socket sí acepta conexiones desde el navegador,
 * así que va directo a WFM sin pasar por el worker. La sesión se abre mandando el
 * JWT en el propio mensaje de signIn (no por cookie ni cabecera).
 */

const WS_URL = "wss://ws.warframe.market/socket";
const SUBPROTOCOL = "wfm";

const ROUTES = {
    SIGN_IN: "@wfm|cmd/auth/signIn",
    SIGN_IN_OK: "@wfm|cmd/auth/signIn:ok",
    SIGN_IN_ERR: "@wfm|cmd/auth/signIn:error",
    SUB_ORDERS: "@wfm|cmd/subscribe/newOrders",
    UNSUB_ORDERS: "@wfm|cmd/unsubscribe/newOrders",
    NEW_ORDER: "@wfm|event/subscriptions/newOrder"
};

let socket = null;
let signedIn = false;
/** Suscriptores al flujo de órdenes nuevas del mercado. */
const orderListeners = new Set();
let subscribedOrders = false;
/** Payload exacto del subscribe en vuelo; el unsubscribe tiene que repetirlo igual. */
let subPayload = null;

function handleMessage(raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch {
        return;
    }

    if (msg.route === ROUTES.NEW_ORDER && msg.payload) {
        for (const fn of orderListeners) {
            try {
                fn(msg.payload);
            } catch { /* un listener roto no debe cortar el flujo */ }
        }
    }
}

/**
 * Escucha las órdenes nuevas del mercado (~250/min en PC).
 * El filtrado se hace en el cliente: no cuesta ni una petición a la API.
 *
 * crossplay=false por defecto, al contrario que WFM (su defecto es true). Con crossplay
 * llegan órdenes de consola: un aviso de "te han rebajado" por alguien con quien no
 * puedes comerciar es ruido, no información.
 *
 * @param {(order: object) => void} fn
 * @param {{platform?: string, crossplay?: boolean}} [opts]
 * @returns {Promise<() => void>} función para dejar de escuchar
 */
export async function subscribeNewOrders(fn, opts = {}) {
    const { platform = "pc", crossplay = false } = opts;
    orderListeners.add(fn);

    if (!subscribedOrders) {
        if (!await connect()) {
            orderListeners.delete(fn);
            return () => {};
        }
        try {
            // WFM exige que el unsubscribe repita el payload EXACTO del subscribe, así
            // que se guarda en vez de reconstruirlo: dos objetos que deben coincidir y
            // se escriben por separado acaban divergiendo.
            subPayload = { platform, crossplay };
            socket.send(JSON.stringify({
                route: ROUTES.SUB_ORDERS,
                id: "suborders",
                payload: subPayload
            }));
            subscribedOrders = true;
        } catch {
            orderListeners.delete(fn);
            return () => {};
        }
    }

    return () => {
        orderListeners.delete(fn);
        // Solo cancelamos la suscripción cuando ya no queda nadie escuchando.
        if (!orderListeners.size && subscribedOrders && socket?.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({
                    route: ROUTES.UNSUB_ORDERS,
                    id: "unsuborders",
                    payload: subPayload
                }));
            } catch { /* el socket se cerrará solo */ }
            subscribedOrders = false;
            subPayload = null;
        }
    };
}

/**
 * Abre la conexión. Reutiliza la que haya viva.
 *
 * La promesa se resuelve al ABRIR, no al autenticar: comprobado contra el socket real,
 * `subscribe/newOrders` responde ":ok" y empieza a emitir sin ningún token. Antes esto
 * exigía signIn y devolvía false sin él, así que una sesión en modo público —o sin
 * sesión— se quedaba sin precios en vivo por un requisito que WFM no impone.
 *
 * El signIn se sigue intentando si hay token (identifica la conexión ante WFM), pero
 * su fallo ya no cancela nada.
 */
async function connect() {
    if (socket?.readyState === WebSocket.OPEN) return true;

    // Si había un socket a medias, se descarta antes de abrir otro.
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close(); } catch { /* ya cerrado */ }
    }

    return new Promise((resolve) => {
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };

        try {
            socket = new WebSocket(WS_URL, [SUBPROTOCOL]);
        } catch {
            done(false);
            return;
        }

        // Sin este corte, un socket que nunca abre dejaría la promesa colgada.
        const timeout = setTimeout(() => done(false), 8000);

        socket.addEventListener("message", (e) => {
            const raw = String(e.data);
            handleMessage(raw);

            // Se compara la ruta ya parseada, no el texto crudo: buscar la cadena
            // dentro del mensaje da falsos positivos con cualquier payload que la cite.
            let route = null;
            try {
                route = JSON.parse(raw).route;
            } catch {
                return;
            }

            if (route === ROUTES.SIGN_IN_OK) signedIn = true;
            else if (route === ROUTES.SIGN_IN_ERR) signedIn = false;
        });

        socket.addEventListener("open", () => {
            clearTimeout(timeout);

            // Identificarse es opcional para escuchar el mercado: si el token no vale
            // (el de v1 no autoriza), WFM responde signIn:error y la suscripción sigue.
            const token = getToken();
            if (token) {
                try {
                    socket.send(JSON.stringify({
                        route: ROUTES.SIGN_IN,
                        id: "signin",
                        payload: { token }
                    }));
                } catch { /* la suscripción no depende de esto */ }
            }
            done(true);
        });

        socket.addEventListener("close", () => {
            signedIn = false;
            clearTimeout(timeout);
            done(false);
        });

        socket.addEventListener("error", () => {
            clearTimeout(timeout);
            done(false);
        });
    });
}

/** Cierra el socket (al salir de la sesión). */
export function closeSocket() {
    signedIn = false;
    subscribedOrders = false;
    orderListeners.clear();
    if (socket) {
        try { socket.close(); } catch { /* ya cerrado */ }
        socket = null;
    }
}
