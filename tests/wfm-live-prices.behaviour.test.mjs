// Precios en vivo del inventario: contrastar lo que dice el socket contra el precio guardado.
//
// De aquí sale el chip de "precio desactualizado", y su valor está entero en los dos umbrales:
// pasarse marca medio inventario y el chip deja de significar nada; quedarse corto y el usuario
// vende a un precio de hace horas. Ninguno de los dos casos da error.
//
// `wfm-live-prices.test.mjs` ya vigila esto grepeando el fuente; esto lo ejecuta, conduciendo
// órdenes por el socket real con un WebSocket falso.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let ultimoSocket = null;
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  constructor() {
    this.readyState = FakeWebSocket.OPEN;
    this._l = {};
    ultimoSocket = this;
    setTimeout(() => this._emit("open", {}), 0);
  }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
  _emit(t, ev) { for (const f of [...(this._l[t] || [])]) f(ev); }
  send() {}
  close() { this.readyState = FakeWebSocket.CLOSED; }
  recibir(obj) { this._emit("message", { data: JSON.stringify(obj) }); }
}
globalThis.WebSocket = FakeWebSocket;

globalThis.fetch = async (url) => {
  if (String(url).includes("wfm_ids")) {
    return {
      ok: true, status: 200,
      json: async () => ({
        ash_prime_set: { id: "idAsh" },
        mag_prime_set: { id: "idMag" },
        volt_prime_set: { id: "idVolt" },
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const { state } = await import("../deploy/js/state.js");
const live = await import("../deploy/js/services/market/wfm_live_prices.service.js");

state.primeInventory = { "Ash Prime Set": 1, "Mag Prime Set": 2, "Volt Prime Set": 1 };
assert.equal(await live.startLivePrices(), true, "debe arrancar con inventario e ids");

// El módulo contrasta contra `globalThis.MEMORY_CACHE`, que es el precio que sirvió el worker.
// Se usa la caché REAL y no un doble: storage.repository.js la publica al importarse, y
// startLivePrices lo arrastra por su cadena de import() — un doble puesto antes se pierde ahí.
const { MEMORY_CACHE: cache } = await import("../deploy/js/repositories/storage.repository.js");

const NEW_ORDER = "@wfm|event/subscriptions/newOrder";
/** Inyecta una orden como haría warframe.market. */
const emitir = (order) => ultimoSocket.recibir({ route: NEW_ORDER, payload: order });

const venta = (o = {}) => ({
  itemId: "idAsh", type: "sell", platinum: 100,
  user: { ingameName: "Tenno", status: "online" }, ...o,
});

/** Recoge lo que emita un canal durante la llamada. */
function capturar(suscribir, fn) {
  const vistos = [];
  const off = suscribir((x) => vistos.push(x));
  try { fn(); } finally { off(); }
  return vistos;
}

test("una orden de compra no cuenta como precio de venta", () => {
  const vistos = capturar(live.onLivePrice, () => emitir(venta({ type: "buy", platinum: 1 })));
  assert.deepEqual(vistos, [],
    "lo que alguien ofrece pagar no es el precio al que se vende");
});

test("un vendedor desconectado no marca precio", () => {
  const vistos = capturar(live.onLivePrice, () =>
    emitir(venta({ platinum: 1, user: { ingameName: "X", status: "offline" } })));
  assert.deepEqual(vistos, [], "no es un precio al que puedas comprar ahora");
});

test("un ítem que no está en tu inventario se ignora", () => {
  const vistos = capturar(live.onLivePrice, () => emitir(venta({ itemId: "idDesconocido" })));
  assert.deepEqual(vistos, []);
});

// El más barato es el precio al que realmente comprarías ahora mismo.
test("solo se queda el listing más barato de cada ítem", () => {
  const vistos = capturar(live.onLivePrice, () => {
    emitir(venta({ itemId: "idMag", platinum: 100 }));
    emitir(venta({ itemId: "idMag", platinum: 120 })); // más caro: no manda
    emitir(venta({ itemId: "idMag", platinum: 80 })); // más barato: sí
  });
  assert.deepEqual(vistos.map((v) => v.plat), [100, 80]);
  assert.equal(vistos.at(-1).slug, "mag_prime_set", "se emite el slug, no el itemId");
});

// --- Los dos umbrales de "desactualizado" ------------------------------------------------

// 20 % no es arbitrario: por debajo, el ruido normal del mercado (un vendedor con prisa, una
// pieza recién desvaultada) dispararía avisos constantes.
test("un desvío menor del 20 % no marca el precio como viejo", () => {
  cache.set("ash_prime_set", 100);
  emitir(venta({ platinum: 115 })); // +15 %
  assert.equal(live.isStale("ash_prime_set"), false);
});

test("pasado el 20 % sí se marca, con la diferencia medida", () => {
  cache.set("ash_prime_set", 100);
  const avisos = capturar(live.onStalePrice, () => emitir(venta({ platinum: 60 }))); // -40 %

  assert.equal(live.isStale("ash_prime_set"), true);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].cached, 100);
  assert.equal(avisos[0].live, 60);
  assert.ok(Math.abs(avisos[0].diff + 0.4) < 1e-9, `diff ${avisos[0].diff}`);
});

// El segundo umbral: sin él, un ítem de 8p que aparece a 10p salía como "+25 %" cuando la
// diferencia real son 2 platino. A precios bajos eso pasa constantemente.
test("un porcentaje grande sobre calderilla no marca nada", () => {
  // Slug propio: el "más barato manda" hace que un test herede el mínimo del anterior.
  cache.set("mag_prime_set", 8);
  emitir(venta({ itemId: "idMag", platinum: 4 })); // -50 % pero solo 4 platino de diferencia
  assert.equal(live.isStale("mag_prime_set"), false,
    "los dos umbrales tienen que cumplirse, no uno");
});

// Mantener una marca vieja haría que el chip mintiera justo cuando el mercado se corrige.
test("si el precio vuelve a cuadrar, la marca se retira", () => {
  cache.set("mag_prime_set", 100);
  emitir(venta({ itemId: "idMag", platinum: 3 })); // más barato que el 4 anterior: se procesa
  assert.equal(live.isStale("mag_prime_set"), true, "3 frente a 100 es desvío de sobra");

  cache.set("mag_prime_set", 4); // el worker sirve ya un precio acorde al mercado
  emitir(venta({ itemId: "idMag", platinum: 2 }));
  assert.equal(live.isStale("mag_prime_set"), false);
});

// 0 en la caché significa "el worker no tiene dato", no "vale 0 platino": compararse contra él
// daría un desvío infinito y marcaría todo.
//
// Slug limpio a propósito: `checkStale` sale antes de tiempo cuando no hay precio guardado, y
// eso incluye NO retirar una marca que ya hubiera. Un ítem marcado que luego pierde su precio
// del worker conserva el chip hasta que vuelva a haber dato — se ve al reutilizar un slug ya
// marcado, y es el motivo de que este test use el suyo.
test("sin precio guardado no hay nada que contradecir", () => {
  cache.delete("volt_prime_set");
  emitir(venta({ itemId: "idVolt", platinum: 1 }));
  assert.equal(live.isStale("volt_prime_set"), false);

  cache.set("volt_prime_set", 0);
  emitir(venta({ itemId: "idVolt", platinum: 999 }));
  assert.equal(live.isStale("volt_prime_set"), false, "0 es 'sin datos', no un precio");
});

// Va el último: deja el módulo parado.
test("parar la escucha olvida los precios y las marcas", () => {
  live.stopLivePrices();
  assert.deepEqual(live.staleSlugs(), []);
  assert.equal(live.getStaleInfo("mag_prime_set"), null);
});
