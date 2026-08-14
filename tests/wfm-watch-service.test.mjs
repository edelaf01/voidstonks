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
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocolos) {
    this.url = url;
    this.protocolos = protocolos;
    this.readyState = FakeWebSocket.CONNECTING;
    this._listeners = {};
    ultimoSocket = this;
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this._emit("open", {});
    }, 0);
  }
  addEventListener(tipo, fn) { (this._listeners[tipo] ||= []).push(fn); }
  removeEventListener(tipo, fn) {
    this._listeners[tipo] = (this._listeners[tipo] || []).filter((f) => f !== fn);
  }
  _emit(tipo, ev) { for (const fn of [...(this._listeners[tipo] || [])]) fn(ev); }
  send(data) { enviados.push(JSON.parse(data)); }
  close() { this.readyState = FakeWebSocket.CLOSED; this._emit("close", {}); }
  recibir(obj) { this._emit("message", { data: JSON.stringify(obj) }); }
}
globalThis.WebSocket = FakeWebSocket;

const watch = await import("../deploy/js/services/market/wfm_watch.service.js");
const NEW_ORDER = "@wfm|event/subscriptions/newOrder";

const emitir = (order) => ultimoSocket.recibir({ route: NEW_ORDER, payload: order });

const orden = (o = {}) => ({
  itemId: "i1", type: "sell", platinum: 50,
  user: { ingameName: "Tenno", status: "online" }, ...o,
});

await watch.startWatching();

function capturar(suscribir, fn) {
  const vistos = [];
  const off = suscribir((x) => vistos.push(x));
  try { fn(); } finally { off(); }
  return vistos;
}

test("el socket se abre con el subprotocolo de WFM y se suscribe a órdenes nuevas", () => {
  assert.deepEqual(ultimoSocket.protocolos, ["wfm"]);
  const sub = enviados.find((m) => m.route === "@wfm|cmd/subscribe/newOrders");
  assert.ok(sub, "debe mandarse el subscribe");
  assert.equal(sub.payload.crossplay, false);
  assert.equal(sub.payload.platform, "pc");
});

test("una orden de un ítem que no vigilas se ignora", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const chollos = capturar(watch.onDeal, () => emitir(orden({ itemId: "otro", platinum: 1 })));
  assert.deepEqual(chollos, []);
});

test("las órdenes de gente desconectada no cuentan", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const chollos = capturar(watch.onDeal, () =>
    emitir(orden({ platinum: 10, user: { ingameName: "X", status: "offline" } })));
  assert.deepEqual(chollos, []);
});

test("un chollo es una venta al 70 % de la mediana o menos", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);

  const justo = capturar(watch.onDeal, () => emitir(orden({ platinum: 70 })));
  assert.equal(justo.length, 1, "justo en el umbral sí cuenta");
  assert.equal(justo[0].discount, 30);

  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const caro = capturar(watch.onDeal, () => emitir(orden({ platinum: 71 })));
  assert.deepEqual(caro, [], "un 71 % ya no es chollo");
});

test("una compra nunca es un chollo, por barata que sea", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const chollos = capturar(watch.onDeal, () => emitir(orden({ type: "buy", platinum: 1 })));
  assert.deepEqual(chollos, [], "que alguien COMPRE barato no es una oportunidad para ti");
});

test("sin mediana conocida no se inventa un chollo", () => {
  watch.setWatchlist([{ itemId: "i1" }]);
  const chollos = capturar(watch.onDeal, () => emitir(orden({ platinum: 1 })));
  assert.deepEqual(chollos, []);
});

test("te avisan cuando te rebajan en tu mismo lado del libro", () => {
  watch.setWatchlist([{ itemId: "i1", myPrice: 100, type: "sell" }]);
  const avisos = capturar(watch.onUndercut, () => emitir(orden({ platinum: 90 })));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].theirs, 90);
  assert.equal(avisos[0].mine, 100);

  watch.setWatchlist([{ itemId: "i1", myPrice: 100, type: "sell" }]);
  assert.deepEqual(capturar(watch.onUndercut, () => emitir(orden({ platinum: 110 }))), [],
    "vender más caro que tú no te rebaja");
});

test("una venta no te rebaja si tu orden es de compra", () => {
  watch.setWatchlist([{ itemId: "i1", myPrice: 100, type: "buy" }]);
  assert.deepEqual(capturar(watch.onUndercut, () => emitir(orden({ type: "sell", platinum: 10 }))), []);
});

test("comprando, te rebaja quien ofrece MÁS que tú", () => {
  watch.setWatchlist([{ itemId: "i1", myPrice: 100, type: "buy" }]);
  const avisos = capturar(watch.onUndercut, () => emitir(orden({ type: "buy", platinum: 120 })));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].theirs, 120);
});

test("en un ítem con rango, solo cuentan las órdenes de TU rango", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100, myPrice: 100, type: "sell", rank: 3 }]);

  const otroRango = capturar(watch.onDeal, () => emitir(orden({ platinum: 10, rank: 0 })));
  assert.deepEqual(otroRango, [], "un rango 0 no es un chollo de tu rango 3");

  watch.setWatchlist([{ itemId: "i1", median: 100, myPrice: 100, type: "sell", rank: 3 }]);
  const miRango = capturar(watch.onDeal, () => emitir(orden({ platinum: 10, rank: 3 })));
  assert.equal(miRango.length, 1);
});

test("un ítem sin rango acepta cualquier orden", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const vistos = capturar(watch.onDeal, () => emitir(orden({ platinum: 10, rank: 5 })));
  assert.equal(vistos.length, 1, "sin rango vigilado no se filtra por rango");
});

// livePrices is only cleared in stopWatching: each test uses its own id or inherits minimum
test("solo se emite cuando el precio MEJORA el que ya había", () => {
  watch.setWatchlist([{ itemId: "precio1", median: 100 }]);

  const precios = capturar(watch.onPrice, () => {
    emitir(orden({ itemId: "precio1", platinum: 50 }));
    emitir(orden({ itemId: "precio1", platinum: 60 }));
    emitir(orden({ itemId: "precio1", platinum: 40 }));
  });

  assert.deepEqual(precios.map((p) => p.sell), [50, 40]);
});

test("venta y compra se siguen por separado y cada una en su dirección", () => {
  watch.setWatchlist([{ itemId: "precio2", median: 100 }]);

  const precios = capturar(watch.onPrice, () => {
    emitir(orden({ itemId: "precio2", type: "sell", platinum: 50 }));
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 30 }));
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 40 }));
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 35 }));
  });

  assert.equal(precios.length, 3);
  assert.deepEqual(precios.at(-1).buy, 40);
  assert.deepEqual(precios.at(-1).sell, 50, "la venta se conserva al actualizar la compra");
});

test("cambiar la lista de vigilancia descarta lo anterior", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  watch.setWatchlist([{ itemId: "i2", median: 100 }]);
  assert.deepEqual(capturar(watch.onDeal, () => emitir(orden({ itemId: "i1", platinum: 1 }))), []);
});

test("una orden sin id o sin precio no rompe el flujo", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  assert.doesNotThrow(() => {
    emitir({ type: "sell", platinum: 10 });
    emitir({ itemId: "i1", type: "sell" });
    emitir({});
  });
});

test("un listener roto no deja sin avisar a los que van detrás", () => {
  watch.setWatchlist([{ itemId: "roto1", median: 100 }]);
  const buenos = [];
  const offRoto = watch.onDeal(() => { throw new Error("listener roto"); });
  const offBueno = watch.onDeal((d) => buenos.push(d));

  assert.doesNotThrow(() => emitir(orden({ itemId: "roto1", platinum: 10 })));
  offRoto(); offBueno();
  assert.equal(buenos.length, 1, "el listener sano tiene que recibir el chollo igual");
});

test("lo mismo en los otros dos canales", () => {
  watch.setWatchlist([{ itemId: "roto2", median: 100, myPrice: 100, type: "sell" }]);
  const precios = [];
  const rebajas = [];
  const offs = [
    watch.onPrice(() => { throw new Error("roto"); }),
    watch.onPrice((p) => precios.push(p)),
    watch.onUndercut(() => { throw new Error("roto"); }),
    watch.onUndercut((u) => rebajas.push(u)),
  ];

  emitir(orden({ itemId: "roto2", platinum: 90 }));
  for (const off of offs) off();

  assert.equal(precios.length, 1, "onPrice");
  assert.equal(rebajas.length, 1, "onUndercut");
});
