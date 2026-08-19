// Socket de warframe.market: la conexión por la que llegan las ~250 órdenes por minuto.
//
// Sus fallos no dan error, dejan la app muda. Y hay uno de vuelta atrás muy fácil de cometer:
// exigir sesión para escuchar. WFM NO la exige —`subscribe/newOrders` responde ":ok" y empieza a
// emitir sin token— pero el código pedía signIn y devolvía false sin él, así que una sesión en
// modo público se quedaba sin precios en vivo por un requisito inventado.

import { test } from "node:test";
import assert from "node:assert/strict";

const sesion = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sesion.has(k) ? sesion.get(k) : null),
  setItem: (k, v) => sesion.set(k, String(v)),
  removeItem: (k) => sesion.delete(k),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

const enviados = [];
let ultimoSocket = null;
let abrirSolo = true; // false = el socket nunca abre
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  constructor(url, protocolos) {
    this.url = url;
    this.protocolos = protocolos;
    this.readyState = FakeWebSocket.CONNECTING;
    this._l = {};
    ultimoSocket = this;
    if (abrirSolo) {
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this._emit("open", {});
      }, 0);
    }
  }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
  _emit(t, ev) { for (const f of [...(this._l[t] || [])]) f(ev); }
  send(data) { enviados.push(JSON.parse(data)); }
  close() { this.readyState = FakeWebSocket.CLOSED; this._emit("close", {}); }
  recibir(obj) { this._emit("message", { data: JSON.stringify(obj) }); }
  fallar() { this._emit("error", {}); }
}
globalThis.WebSocket = FakeWebSocket;

const socket = await import("../deploy/js/services/market/wfm_socket.service.js");

const R = {
  SIGN_IN: "@wfm|cmd/auth/signIn",
  SUB: "@wfm|cmd/subscribe/newOrders",
  UNSUB: "@wfm|cmd/unsubscribe/newOrders",
  NEW_ORDER: "@wfm|event/subscriptions/newOrder",
};

function jwtValido() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor((Date.now() + 3600_000) / 1000) })}.f`;
}

const mensajes = (route) => enviados.filter((m) => m.route === route);

// ESTE es el que impide volver atrás: escuchar el mercado no requiere sesión.
test("sin token se conecta y se suscribe igual", async () => {
  sesion.clear();
  enviados.length = 0;

  const off = await socket.subscribeNewOrders(() => {});
  assert.equal(typeof off, "function", "sin sesión también se devuelve la baja");
  assert.equal(mensajes(R.SUB).length, 1, "la suscripción sale sin token");
  assert.equal(mensajes(R.SIGN_IN).length, 0, "y no se intenta identificar si no hay nada que mandar");
  off();
  socket.closeSocket();
});

test("con token se identifica, pero eso no condiciona la suscripción", async () => {
  sesion.clear();
  sesion.set("wfm_jwt", jwtValido());
  sesion.set("wfm_exp", String(Date.now() + 3600_000));
  enviados.length = 0;

  const off = await socket.subscribeNewOrders(() => {});
  assert.equal(mensajes(R.SIGN_IN).length, 1);
  assert.equal(mensajes(R.SUB).length, 1);

  // Un signIn:error no puede cortar el flujo: la suscripción ya está hecha.
  ultimoSocket.recibir({ route: "@wfm|cmd/auth/signIn:error", payload: {} });
  const recibidas = [];
  const off2 = await socket.subscribeNewOrders((o) => recibidas.push(o));
  ultimoSocket.recibir({ route: R.NEW_ORDER, payload: { itemId: "i1" } });
  assert.equal(recibidas.length, 1, "sigue emitiendo tras un signIn fallido");

  off(); off2();
  socket.closeSocket();
});

test("crossplay va apagado al contrario que en WFM", async () => {
  sesion.clear();
  enviados.length = 0;
  const off = await socket.subscribeNewOrders(() => {});
  // Con crossplay llegan órdenes de consola: avisar de alguien con quien no puedes comerciar es
  // ruido, no información.
  assert.deepEqual(mensajes(R.SUB)[0].payload, { platform: "pc", crossplay: false });
  off();
  socket.closeSocket();
});

// Una conexión por sesión: ~250 mensajes por minuto no se multiplican por suscriptor.
test("varios suscriptores comparten una sola suscripción", async () => {
  sesion.clear();
  enviados.length = 0;

  const vistos = [[], []];
  const off1 = await socket.subscribeNewOrders((o) => vistos[0].push(o));
  const off2 = await socket.subscribeNewOrders((o) => vistos[1].push(o));

  assert.equal(mensajes(R.SUB).length, 1, "solo un subscribe");
  ultimoSocket.recibir({ route: R.NEW_ORDER, payload: { itemId: "i1" } });
  assert.equal(vistos[0].length, 1);
  assert.equal(vistos[1].length, 1, "el mensaje llega a los dos");

  off1(); off2();
  socket.closeSocket();
});

// WFM exige que el unsubscribe repita el payload EXACTO del subscribe. Reconstruirlo por
// separado es la forma de que dos objetos que deben coincidir acaben divergiendo.
test("el unsubscribe repite el payload exacto del subscribe", async () => {
  sesion.clear();
  enviados.length = 0;

  const off = await socket.subscribeNewOrders(() => {}, { platform: "ps4", crossplay: true });
  off();

  const sub = mensajes(R.SUB)[0];
  const unsub = mensajes(R.UNSUB)[0];
  assert.ok(unsub, "debe mandarse el unsubscribe");
  assert.deepEqual(unsub.payload, sub.payload);
  socket.closeSocket();
});

// Cancelar mientras otro sigue escuchando dejaría a ese otro sin órdenes.
test("solo se cancela cuando ya no queda nadie escuchando", async () => {
  sesion.clear();
  enviados.length = 0;

  const off1 = await socket.subscribeNewOrders(() => {});
  const off2 = await socket.subscribeNewOrders(() => {});

  off1();
  assert.equal(mensajes(R.UNSUB).length, 0, "todavía queda uno");
  off2();
  assert.equal(mensajes(R.UNSUB).length, 1);
  socket.closeSocket();
});

test("un mensaje que no es JSON o no es una orden se ignora sin romper", async () => {
  sesion.clear();
  const recibidas = [];
  const off = await socket.subscribeNewOrders((o) => recibidas.push(o));

  assert.doesNotThrow(() => {
    ultimoSocket._emit("message", { data: "esto no es json" });
    ultimoSocket.recibir({ route: "@wfm|otra/cosa", payload: { itemId: "x" } });
    ultimoSocket.recibir({ route: R.NEW_ORDER }); // sin payload
  });
  assert.deepEqual(recibidas, []);
  off();
  socket.closeSocket();
});

// La ruta se compara sobre el mensaje ya parseado, no buscando la cadena dentro del texto: un
// payload que cite la ruta daría un falso positivo.
test("una orden que MENCIONA la ruta en su contenido no se confunde con la ruta", async () => {
  sesion.clear();
  const recibidas = [];
  const off = await socket.subscribeNewOrders((o) => recibidas.push(o));

  ultimoSocket.recibir({ route: "@wfm|otra/cosa", payload: { texto: R.NEW_ORDER } });
  assert.deepEqual(recibidas, [], "el texto del payload no es la ruta del mensaje");
  off();
  socket.closeSocket();
});

test("un listener roto no corta el flujo de los demás", async () => {
  sesion.clear();
  const buenos = [];
  const off1 = await socket.subscribeNewOrders(() => { throw new Error("roto"); });
  const off2 = await socket.subscribeNewOrders((o) => buenos.push(o));

  assert.doesNotThrow(() => ultimoSocket.recibir({ route: R.NEW_ORDER, payload: { itemId: "i1" } }));
  assert.equal(buenos.length, 1);
  off1(); off2();
  socket.closeSocket();
});

// Sin socket no hay nada que escuchar, pero devolver undefined haría que el llamador petara al
// intentar darse de baja.
test("si el socket no llega a abrir, se devuelve una baja que no hace nada", async () => {
  sesion.clear();
  socket.closeSocket();
  abrirSolo = false;
  enviados.length = 0;

  const promesa = socket.subscribeNewOrders(() => {});
  ultimoSocket.fallar(); // el navegador avisa del error de conexión
  const off = await promesa;

  assert.equal(typeof off, "function");
  assert.doesNotThrow(() => off());
  assert.equal(mensajes(R.SUB).length, 0, "no se manda nada por un socket que no abrió");

  abrirSolo = true;
  socket.closeSocket();
});

test("cerrar el socket olvida los suscriptores", async () => {
  sesion.clear();
  const recibidas = [];
  const off = await socket.subscribeNewOrders((o) => recibidas.push(o));
  const abierto = ultimoSocket;

  socket.closeSocket();
  abierto.recibir({ route: R.NEW_ORDER, payload: { itemId: "i1" } });
  assert.deepEqual(recibidas, [], "tras cerrar no debe llegar nada");
  off();
});
