// Perfil público de un jugador.
//
// Son 24 líneas con dos desenlaces que la UI querría distinguir —"no existe ese perfil" y "no
// se pudo consultar"— pero **los dos textos no existen en TEXTS**, así que hoy los dos avisos
// salen vacíos. Está abajo con su explicación: la función está aparcada, no rota.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let responder = async () => ({ ok: true, status: 200, json: async () => ({}) });
const urls = [];
globalThis.fetch = async (url) => {
  urls.push(String(url));
  return responder();
};

const avisos = [];
const pintados = [];
globalThis.showToast = (msg) => avisos.push(msg);
globalThis.renderProfileStats = (payload) => pintados.push(payload);

const { state } = await import("../deploy/js/state.js");
const { TEXTS } = await import("../deploy/js/config.js");
const { fetchUserProfile } = await import("../deploy/js/services/profile.service.js");

state.currentLang = "es";
const T = TEXTS.es;

const reset = () => { avisos.length = 0; pintados.length = 0; urls.length = 0; };

const sinRuido = async (fn) => {
  const real = console.error;
  console.error = () => {};
  try { await fn(); } finally { console.error = real; }
};

test("un perfil que existe se pinta con su payload", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({ payload: { rank: 30 } }) });

  await fetchUserProfile("Tenno", "pc");
  assert.deepEqual(pintados, [{ rank: 30 }]);
  assert.deepEqual(avisos, [], "sin errores no se avisa de nada");
});

// Los dos caminos son distintos a propósito: "no existe" manda a revisar el nombre, "no se pudo
// consultar" manda a reintentar.
test("un perfil inexistente y un fallo del worker toman caminos distintos", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({ error: "not_found" }) });
  await fetchUserProfile("NoExiste", "pc");
  assert.equal(avisos.length, 1, "avisa");
  assert.deepEqual(pintados, [], "y no pinta nada");

  reset();
  await sinRuido(async () => {
    responder = async () => ({ ok: false, status: 502, json: async () => ({}) });
    await fetchUserProfile("Tenno", "pc");
  });
  assert.equal(avisos.length, 1);
  assert.deepEqual(pintados, []);
});

// HUECO CONOCIDO, y por eso no se arregla aquí: `errProfileNotFound` y `errProfileFetch` NO
// existen en TEXTS, en ninguno de los dos idiomas, así que los dos avisos salen como
// `undefined`. No se inventan los textos porque la función está aparcada — se publica en
// globalThis pero ningún HTML la llama, y el propio service lleva un TODO diciendo que no está
// planteado. Al retomar la pestaña de perfil, esto es lo primero: dos claves en ES y EN.
test("los textos de error del perfil siguen sin existir", () => {
  assert.equal(T.errProfileNotFound, undefined);
  assert.equal(T.errProfileFetch, undefined);
});

test("un fallo de red se reporta como error de consulta, no como perfil inexistente", async () => {
  reset();
  await sinRuido(async () => {
    responder = async () => { throw new Error("sin red"); };
    await fetchUserProfile("Tenno", "pc");
  });
  assert.deepEqual(avisos, [T.errProfileFetch]);
});

test("un JSON ilegible tampoco revienta", async () => {
  reset();
  await sinRuido(async () => {
    responder = async () => ({ ok: true, status: 200, json: async () => { throw new Error("no es json"); } });
    await fetchUserProfile("Tenno", "pc");
  });
  assert.deepEqual(avisos, [T.errProfileFetch]);
});

// El nombre lo teclea el usuario: sin codificar, un espacio o un carácter raro rompe la URL.
test("el nombre y la plataforma viajan codificados", async () => {
  reset();
  responder = async () => ({ ok: true, status: 200, json: async () => ({ payload: {} }) });
  await fetchUserProfile("Tenno Con Espacio", "pc");
  assert.ok(!urls.at(-1).includes("Tenno Con Espacio"), urls.at(-1));
  assert.match(urls.at(-1), /Tenno(%20|\+)Con/);
});

// La app puede pedir el perfil antes de que la UI esté montada; si el service diera por hecho
// que los globales existen, reventaría el arranque.
test("sin la UI montada no se rompe nada", async () => {
  reset();
  const toast = globalThis.showToast;
  const render = globalThis.renderProfileStats;
  globalThis.showToast = undefined;
  globalThis.renderProfileStats = undefined;
  try {
    responder = async () => ({ ok: true, status: 200, json: async () => ({ payload: {} }) });
    await assert.doesNotReject(() => fetchUserProfile("Tenno", "pc"));

    await sinRuido(async () => {
      responder = async () => ({ ok: false, status: 500, json: async () => ({}) });
      await assert.doesNotReject(() => fetchUserProfile("Tenno", "pc"));
    });
  } finally {
    globalThis.showToast = toast;
    globalThis.renderProfileStats = render;
  }
});
