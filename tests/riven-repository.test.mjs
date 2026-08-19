// raw access to both riven workers (rivens and arbitrage)
// each function talks to a DIFFERENT worker: confusing them yields a 404 misread as "no data for weapon"
// pins base endpoints, slug encoding and uniform history response parsing

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

// both bases are distinct workers deployed separately: unifying them would break half the endpoints
test("los dos workers no son el mismo", () => {
  assert.notEqual(R.RIVEN_API_BASE, R.ARB_API_BASE);
});

// weapon slug is user-derived: unencoded spaces break the URL and return 400
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

// worker returns either a raw array or {data:[...], pos, neg}; callers .map the result and an object
// breaks graph rendering
test("el historial devuelve un array venga en el formato que venga", async () => {
  responder = async () => ({ ok: true, status: 200, json: async () => [{ p: 100 }] });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 100 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ p: 200 }], pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 200 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [], "sin data, lista vacía y no undefined");
});

// swallowing errors would show "no data" when the worker is down; propagating errors lets callers handle
// failure explicitly
test("un error del worker se propaga con su código", async () => {
  responder = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => R.fetchCurrentRivens(), /503/);
  await assert.rejects(() => R.fetchArbitrage(), /503/);
  await assert.rejects(() => R.fetchLiveOrders("x"), /503/);
});

// history error is the only one naming the weapon: visible in console when one weapon fails while others
// succeed
test("el error del historial dice de qué arma era", async () => {
  responder = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => R.fetchWeaponHistory("Braton Prime"), /Braton Prime/);
});
