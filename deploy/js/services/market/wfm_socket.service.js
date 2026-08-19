import { getToken } from "./wfm_auth.service.js";

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
const orderListeners = new Set();
let subscribedOrders = false;
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
            } catch {}
        }
    }
}

export async function subscribeNewOrders(fn, opts = {}) {
    const { platform = "pc", crossplay = false } = opts;
    orderListeners.add(fn);

    if (!subscribedOrders) {
        if (!await connect()) {
            orderListeners.delete(fn);
            return () => {};
        }
        try {
            // wfm requires unsubscribe to repeat the exact subscribe payload
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
        if (!orderListeners.size && subscribedOrders && socket?.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({
                    route: ROUTES.UNSUB_ORDERS,
                    id: "unsuborders",
                    payload: subPayload
                }));
            } catch {}
            subscribedOrders = false;
            subPayload = null;
        }
    };
}

async function connect() {
    if (socket?.readyState === WebSocket.OPEN) return true;

    if (socket && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close(); } catch {}
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

        const timeout = setTimeout(() => done(false), 8000);

        socket.addEventListener("message", (e) => {
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

        socket.addEventListener("open", () => {
            clearTimeout(timeout);

            const token = getToken();
            if (token) {
                try {
                    socket.send(JSON.stringify({
                        route: ROUTES.SIGN_IN,
                        id: "signin",
                        payload: { token }
                    }));
                } catch {}
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

export function closeSocket() {
    signedIn = false;
    subscribedOrders = false;
    orderListeners.clear();
    if (socket) {
        try { socket.close(); } catch {}
        socket = null;
    }
}
