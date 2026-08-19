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

test("los dos workers no son el mismo", () => {
  assert.notEqual(R.RIVEN_API_BASE, R.ARB_API_BASE);
});

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

test("el historial devuelve un array venga en el formato que venga", async () => {
  responder = async () => ({ ok: true, status: 200, json: async () => [{ p: 100 }] });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 100 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ p: 200 }], pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [{ p: 200 }]);

  responder = async () => ({ ok: true, status: 200, json: async () => ({ pos: [], neg: [] }) });
  assert.deepEqual(await R.fetchWeaponHistory("X"), [], "sin data, lista vacía y no undefined");
});

test("un error del worker se propaga con su código", async () => {
  responder = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => R.fetchCurrentRivens(), /503/);
  await assert.rejects(() => R.fetchArbitrage(), /503/);
  await assert.rejects(() => R.fetchLiveOrders("x"), /503/);
});

test("el error del historial dice de qué arma era", async () => {
  responder = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => R.fetchWeaponHistory("Braton Prime"), /Braton Prime/);
});
