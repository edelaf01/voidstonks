// Reloj del servidor: la referencia temporal contra la que se pintan TODOS los contadores.
//
// `server-clock.test.mjs` ya lo vigila, pero con regex sobre el fuente: comprueba que ciertas
// líneas existan, no que hagan lo que dicen. Esto lo ejecuta.
//
// El bug que motivó el módulo: "TODO sale ROTATING". El reloj del sistema adelantado unos
// minutos deja todos los contadores en negativo y las misiones vivas se muestran caducadas.
// El agravante fue que un primer sync fallido se cacheaba, así que el offset se quedaba en 0
// el resto de la sesión y no había forma de salir de ahí sin recargar.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let responder = async () => ({ ok: true, status: 200, json: async () => ({ now: Date.now() }) });
let peticiones = 0;
globalThis.fetch = async (url) => {
  if (!String(url).includes("type=time")) return { ok: false, status: 404, json: async () => ({}) };
  peticiones++;
  return responder();
};

const { serverNow, syncServerClock, isClockSynced } = await import(
  "../deploy/js/services/server_clock.service.js"
);

const sinRuido = async (fn) => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};

test("sin sincronizar todavía, serverNow es la hora local: nunca empeora lo que había", () => {
  globalThis._serverTimeOffset = 0;
  assert.ok(Math.abs(serverNow() - Date.now()) < 50);
});

// Este es el fallo que dejaba "ROTATING" para siempre: la promesa se cacheaba aunque el sync
// hubiera fallado, así que el offset se quedaba en 0 el resto de la sesión.
test("un sync fallido NO se cachea: el siguiente intento vuelve a salir", async () => {
  globalThis._serverTimeOffset = 0;
  peticiones = 0;

  await sinRuido(async () => {
    responder = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await syncServerClock();
    assert.equal(isClockSynced(), false, "un 503 no puede darse por sincronizado");
    assert.equal(peticiones, 1);

    await syncServerClock();
    assert.equal(peticiones, 2, "debe reintentar, no reutilizar el fallo");

    responder = async () => { throw new Error("sin red"); };
    await syncServerClock();
    assert.equal(peticiones, 3, "un throw tampoco se cachea");
    assert.equal(isClockSynced(), false);
  });
});

// El caso de verdad: reloj de sistema 30 minutos adelantado. Sin corregir, todo lo que manda
// el servidor parece caducado.
test("mide el desfase y corrige serverNow con él", async () => {
  globalThis._serverTimeOffset = 0;
  const desfase = 30 * 60000;
  responder = async () => ({ ok: true, status: 200, json: async () => ({ now: Date.now() - desfase }) });

  await syncServerClock();

  assert.equal(isClockSynced(), true);
  assert.ok(Math.abs(globalThis._serverTimeOffset - desfase) < 5000,
    `offset medido ${globalThis._serverTimeOffset}, esperado ~${desfase}`);
  // Y lo que importa: la hora corregida va por detrás de la del sistema, que es lo que
  // rescata los contadores.
  assert.ok(Date.now() - serverNow() > desfase - 5000);
});

test("una vez sincronizado no se vuelve a preguntar en toda la sesión", async () => {
  const antes = peticiones;
  await syncServerClock();
  await syncServerClock();
  assert.equal(peticiones, antes, "una petición por sesión es el presupuesto");
});

test("una respuesta sin la hora no se toma por buena", async () => {
  globalThis._serverTimeOffset = 0;
  await sinRuido(async () => {
    // Se fuerza un módulo nuevo: el de arriba ya quedó sincronizado para siempre.
    responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const fresco = await import("../deploy/js/services/server_clock.service.js?sinHora=1");
    await fresco.syncServerClock();
    assert.equal(fresco.isClockSynced(), false, "sin `now` no hay desfase que medir");
    assert.equal(globalThis._serverTimeOffset, 0);
  });
});
