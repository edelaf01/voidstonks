// El acceso crudo a los dos workers de rivens.
//
// Son cuatro funciones cortas, pero cada una habla con un worker DISTINTO (el de rivens y el
// del arbitrage) y confundirlos da un 404 que se lee como "no hay datos de esta arma". Aquí se
// fija a qué base va cada una, que los nombres viajen codificados y que los dos formatos de
// respuesta del historial se traten igual.

import { test } from "node:test";
import assert from "node:assert/strict";

const peticiones = [];
let responder = async () => ({ ok: true, status: 200, json: async () => [] });
globalThis.fetch = async (url) => { peticiones.push(String(url)); return responder(); };

const R = await import("../deploy/js/repositories/riven.repository.js");

const ultima = () => peticiones.at(-1);
const reset = () => { peticiones.length = 0; };

test("cada consulta va al worker que le toca", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  await R.fetchCurrentRivens();
  assert.ok(ultima().startsWith(R.RIVEN_API_BASE), ultima());

  await R.fetchArbitrage();
  assert.ok(ultima().startsWith(R.ARB_API_BASE), ultima());

  await R.fetchLiveOrders("braton_prime");
  assert.ok(ultima().startsWith(R.ARB_API_BASE), ultima());

  await R.fetchWeaponHistory("Braton Prime");
  assert.ok(ultima().startsWith(R.RIVEN_API_BASE), ultima());
});

// Los dos bases son workers distintos desplegados por separado: si alguien los unifica por
// parecer "lo mismo", la mitad de las rutas dejan de existir.
test("los dos workers no son el mismo", () => {
  assert.notEqual(R.RIVEN_API_BASE, R.ARB_API_BASE);
});

// El slug lo compone el usuario indirectamente (nombre de arma); un espacio sin codificar parte
// la URL y devuelve 400.
test("el slug de una orden viaja codificado", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await R.fetchLiveOrders("con espacio&raro");
  assert.ok(!ultima().includes(" "), ultima());
  assert.ok(ultima().includes("%20") || ultima().includes("+"), ultima());
  assert.ok(!ultima().includes("&raro"), "el & no puede abrir otro parámetro");
});

test("el historial pide el arma por su slug de riven, no por su nombre", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => [] });
  await R.fetchWeaponHistory("Braton Prime");
  assert.ok(!ultima().includes("Braton Prime"), ultima());
  assert.match(ultima(), /weapon=\S+/);
});

// El worker devuelve a veces el array pelado y a veces `{data:[...], pos, neg}`. Quien lo llama
// hace `.map` sobre el resultado: si le llega el objeto, revienta al pintar el gráfico.
test("el historial devuelve un array venga en el formato que venga", async () => {
  responder = async () => ({ ok: true, status: 200, json: async () => [{ p: 100 }] });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 100 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ p: 200 }], pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 200 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [], "sin data, lista vacía y no undefined");
});

// Un repositorio que se traga el error devolvería null y la UI enseñaría "sin datos" cuando lo
// que pasa es que el worker está caído. El fallo sube; quien llama decide qué contar.
test("un error del worker se propaga con su código", async () => {
  responder = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => R.fetchCurrentRivens(), /503/);
  await assert.rejects(() => R.fetchArbitrage(), /503/);
  await assert.rejects(() => R.fetchLiveOrders("x"), /503/);
});

// El del historial es el único que menciona el arma: es el que se ve en consola cuando falla
// una sola y el resto va bien.
test("el error del historial dice de qué arma era", async () => {
  responder = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => R.fetchWeaponHistory("Braton Prime"), /Braton Prime/);
});
