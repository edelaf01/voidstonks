// Vigilancia del mercado en vivo: chollos, rebajas de la competencia y mejor precio.
//
// Llegan ~250 órdenes por minuto y el filtrado es todo del cliente. Sus dos modos de fallo son
// avisar de más —y entonces el usuario apaga las alertas— o de menos, y entonces no sirven de
// nada. Ninguno de los dos da error.
//
// Se conduce por el socket de verdad con un WebSocket falso: así se comprueba también el
// cableado entre los dos services, que es donde se pierden los mensajes.

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

/** WebSocket de mentira: se abre solo y deja inyectar mensajes del servidor. */
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
    // El socket real abre de forma asíncrona; imitarlo evita que el test pase por accidente
    // con un connect() que asumiera apertura inmediata.
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
  /** Simula un mensaje del servidor. */
  recibir(obj) { this._emit("message", { data: JSON.stringify(obj) }); }
}
globalThis.WebSocket = FakeWebSocket;

const watch = await import("../deploy/js/services/market/wfm_watch.service.js");
const NEW_ORDER = "@wfm|event/subscriptions/newOrder";

/** Manda una orden nueva por el socket, como haría warframe.market. */
const emitir = (order) => ultimoSocket.recibir({ route: NEW_ORDER, payload: order });

const orden = (o = {}) => ({
  itemId: "i1", type: "sell", platinum: 50,
  user: { ingameName: "Tenno", status: "online" }, ...o,
});

await watch.startWatching();

/** Recoge lo que emita un canal durante la llamada. */
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
  // crossplay=false al contrario que WFM: un aviso de alguien de consola con quien no puedes
  // comerciar es ruido, no información.
  assert.equal(sub.payload.crossplay, false);
  assert.equal(sub.payload.platform, "pc");
});

test("una orden de un ítem que no vigilas se ignora", () => {
  watch.setWatchlist([{ itemId: "i1", median: 100 }]);
  const chollos = capturar(watch.onDeal, () => emitir(orden({ itemId: "otro", platinum: 1 })));
  assert.deepEqual(chollos, []);
});

// Un vendedor desconectado no puede venderte: avisar de su precio es una oportunidad falsa.
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

// --- Competencia ---------------------------------------------------------------------------

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

// Vender por debajo no te afecta si tú estás comprando: es el otro lado del libro.
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

// --- Rango (mods y arcanos) ------------------------------------------------------------------

// Cada rango es un mercado aparte: un r0 barato no rebaja tu r10 ni es un chollo frente a la
// mediana del rango máximo.
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

// --- Mejor precio en vivo --------------------------------------------------------------------

// Ojo con el id: `livePrices` NO se limpia al cambiar la lista de vigilancia (solo en
// stopWatching), así que cada test de precio usa el suyo o hereda el mejor precio del anterior.
test("solo se emite cuando el precio MEJORA el que ya había", () => {
  watch.setWatchlist([{ itemId: "precio1", median: 100 }]);

  const precios = capturar(watch.onPrice, () => {
    emitir(orden({ itemId: "precio1", platinum: 50 }));
    emitir(orden({ itemId: "precio1", platinum: 60 })); // peor venta: no mejora
    emitir(orden({ itemId: "precio1", platinum: 40 })); // mejor venta: sí
  });

  assert.deepEqual(precios.map((p) => p.sell), [50, 40]);
});

test("venta y compra se siguen por separado y cada una en su dirección", () => {
  watch.setWatchlist([{ itemId: "precio2", median: 100 }]);

  const precios = capturar(watch.onPrice, () => {
    emitir(orden({ itemId: "precio2", type: "sell", platinum: 50 }));
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 30 }));
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 40 })); // compra más alta = mejor
    emitir(orden({ itemId: "precio2", type: "buy", platinum: 35 })); // peor: no emite
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

// Con ~250 órdenes por minuto, un suscriptor que lance no puede dejar sin avisar a los demás.
// El síntoma no sería un error —el socket se traga la excepción— sino avisos que dejan de sonar
// sin motivo aparente. wfm_socket ya lo protegía; wfm_watch no, y se igualó.
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
