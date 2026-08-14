// market curiosities loading: a cached failure would leave the carousel empty until reload
// the tests run IN ORDER on purpose (the module keeps state) and the first one is the failure

import { test } from "node:test";
import assert from "node:assert/strict";

const peticiones = [];
let responder = async () => ({ ok: false, status: 404, json: async () => ({}) });
globalThis.fetch = async (url) => { peticiones.push(String(url)); return responder(); };

const { getCuriosidades } = await import("../deploy/js/services/rivens/curiosidades.service.js");

test("un JSON que no está devuelve null, no un objeto a medias", async () => {
  assert.equal(await getCuriosidades(), null);
});

test("una red caída tampoco revienta", async () => {
  responder = async () => { throw new Error("sin red"); };
  assert.equal(await getCuriosidades(), null);
});

test("tras un fallo se vuelve a intentar", async () => {
  const antes = peticiones.length;
  responder = async () => ({ ok: true, json: async () => ({ globales: [], eventos: [{ arma: "torid" }] }) });
  const datos = await getCuriosidades();
  assert.equal(peticiones.length, antes + 1, "debe haber pedido el fichero otra vez");
  assert.deepEqual(datos.eventos, [{ arma: "torid" }]);
});

test("una vez cargado no se vuelve a pedir", async () => {
  const antes = peticiones.length;
  const a = await getCuriosidades();
  const b = await getCuriosidades();
  assert.equal(peticiones.length, antes, "sin peticiones nuevas");
  assert.equal(a, b, "y es el mismo objeto, no una copia");
});

test("se pide una ruta relativa: la app se sirve bajo su propio dominio", () => {
  assert.ok(peticiones.every((u) => u === "assets/ml/curiosidades.json"), peticiones.join(", "));
});
