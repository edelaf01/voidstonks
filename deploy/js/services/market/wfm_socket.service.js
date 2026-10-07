import { getToken } from "./wfm_auth.service.js";

/**
 * warframe market websocket client to stream new market orders
 */

const WS_URL = "wss://ws.warframe.market/socket";
const SUBPROTOCOL = "wfm";
const CLAVE_VETO = "vs_wfm_socket_veto";
const VETO_MS = 24 * 60 * 60 * 1000;

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
const orderListeners = new Set();
let subscribedOrders = false;
let subPayload = null;
let vetoHasta = 0;

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
            } catch { /* a broken listener must not cut the stream */ }
        }
    }
}

/**
 * streams new market orders, filtered client-side without api calls
 * @param {(order: object) => void} fn
 * @param {{platform?: string, crossplay?: boolean}} [opts]
 * @returns {Promise<() => void>} unsubscribe function
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
            // wfm requires unsubscribe to repeat the exact subscribe payload, stored
            // here instead of reconstructed
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
        // only unsubscribe once nobody is listening
        if (!orderListeners.size && subscribedOrders && socket?.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({
                    route: ROUTES.UNSUB_ORDERS,
                    id: "unsuborders",
                    payload: subPayload
                }));
            } catch { /* the socket closes by itself */ }
            subscribedOrders = false;
            subPayload = null;
        }
    };
}

function vetado() {
    if (!vetoHasta) {
        try { vetoHasta = Number(localStorage.getItem(CLAVE_VETO)) || 0; } catch {}
    }
    return Date.now() < vetoHasta;
}

function veta() {
    vetoHasta = Date.now() + VETO_MS;
    try { localStorage.setItem(CLAVE_VETO, String(vetoHasta)); } catch {}
}

/**
 * Abre la conexión. 
 *
 * El signIn se sigue intentando si hay token (identifica la conexión ante WFM)
 */
async function connect() {
    if (socket?.readyState === WebSocket.OPEN) return true;
    if (vetado()) return false;

    // drop a half open socket before opening another
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        const viejo = socket;
        socket = null;
        try { viejo.close(); } catch { /* already closed */ }
    }

    return new Promise((resolve) => {
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };

        let abierto = false;
        let ws;
        try {
            ws = new WebSocket(WS_URL, [SUBPROTOCOL]);
        } catch {
            veta();
            done(false);
            return;
        }
        socket = ws;
        const falla = () => {
            if (!abierto && socket === ws) veta();
            done(false);
        };

        const timeout = setTimeout(() => {
            falla();
            try { ws.close(); } catch {}
        }, 8000);

        ws.addEventListener("message", (e) => {
            const raw = String(e.data);
            handleMessage(raw);

            let route = null;
            try {
                route = JSON.parse(raw).route;
            } catch {
                return;
            }

            if (route === ROUTES.SIGN_IN_OK) signedIn = true;
            else if (route === ROUTES.SIGN_IN_ERR) signedIn = false;
        });

        ws.addEventListener("open", () => {
            abierto = true;
            clearTimeout(timeout);

            const token = getToken();
            if (token) {
                try {
                    ws.send(JSON.stringify({
                        route: ROUTES.SIGN_IN,
                        id: "signin",
                        payload: { token }
                    }));
                } catch { /* the subscription does not depend on this */ }
            }
            done(true);
        });

        ws.addEventListener("close", () => {
            signedIn = false;
            clearTimeout(timeout);
            falla();
        });

        ws.addEventListener("error", () => {
            clearTimeout(timeout);
            falla();
        });
    });
}

/** Closes the socket (on logout). */
export function closeSocket() {
    signedIn = false;
    subscribedOrders = false;
    orderListeners.clear();
    vetoHasta = 0;
    try { localStorage.removeItem(CLAVE_VETO); } catch {}
    if (socket) {
        const s = socket;
        socket = null;
        try { s.close(); } catch { /* already closed */ }
    }
}
