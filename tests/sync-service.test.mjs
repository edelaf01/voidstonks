// Buzón de sincronización entre dispositivos (código de 4 dígitos, 60 s de vida en KV).
//
// El service nació al sacar el plumbing HTTP de ui_sync.js: el componente decidía qué pintar
// mirando `res.status === 429` y `res.ok`, y repetía ese mapeo dos veces (emisor y receptor)
// con textos distintos. Lo que se fija aquí es esa traducción, porque los tres desenlaces se
// parecen mucho en pantalla y equivocarlos manda al usuario a esperar un minuto cuando el
// problema era otro — o al revés, le esconde que hay límite de peticiones.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let respuesta = { ok: true, status: 200, json: async () => ({}) };
let lanza = false;
const urls = [];

globalThis.fetch = async (url) => {
  urls.push(String(url));
  if (lanza) throw new Error("red caída");
  return respuesta;
};

const { sendSync, pollSync, isValidSyncCode } = await import(
  "../deploy/js/services/sync.service.js"
);

const responde = (status, cuerpo = {}) => {
  lanza = false;
  respuesta = { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
};

test("solo valen códigos de exactamente 4 dígitos", () => {
  for (const bueno of ["0000", "1234", "9999"]) assert.equal(isValidSyncCode(bueno), true, bueno);
  for (const malo of ["123", "12345", "12a4", "", null, undefined, " 1234"]) {
    assert.equal(isValidSyncCode(malo), false, String(malo));
  }
});

test("un código inválido no llega a salir a la red", async () => {
  const antes = urls.length;
  assert.deepEqual(await sendSync("12", "hola"), { ok: false, reason: "invalid-code" });
  assert.equal(urls.length, antes, "no debe generar tráfico");
});

test("enviar: los tres desenlaces se distinguen por nombre, no por código HTTP", async () => {
  responde(200);
  assert.deepEqual(await sendSync("1234", "hola"), { ok: true });

  // 429 tiene arreglo (esperar); el resto no. Confundirlos daba el aviso equivocado.
  responde(429);
  assert.deepEqual(await sendSync("1234", "hola"), { ok: false, reason: "rate-limit" });

  responde(500);
  assert.deepEqual(await sendSync("1234", "hola"), { ok: false, reason: "server" });
});

test("enviar: un fallo de red se reporta como error de servidor, no revienta", async () => {
  lanza = true;
  assert.deepEqual(await sendSync("1234", "hola"), { ok: false, reason: "server" });
});

test("recibir: 'todavía nada' es un resultado normal, no un error", async () => {
  // El receptor consulta en bucle cada 3 s; tratar el buzón vacío como error cortaría la
  // espera al primer tick, que es justo cuando el otro dispositivo aún no ha enviado.
  responde(200, {});
  assert.deepEqual(await pollSync("1234"), { status: "waiting" });

  responde(200, { val: null });
  assert.deepEqual(await pollSync("1234"), { status: "waiting" });
});

test("recibir: el mensaje llega con su valor", async () => {
  responde(200, { val: "Lith A1 x3" });
  assert.deepEqual(await pollSync("1234"), { status: "received", value: "Lith A1 x3" });
});

test("recibir: límite y error de servidor sí cortan el bucle", async () => {
  responde(429);
  assert.deepEqual(await pollSync("1234"), { status: "rate-limit" });

  responde(503);
  assert.deepEqual(await pollSync("1234"), { status: "server" });
});

// Un corte de red suelto no puede matar la espera: el usuario tendría que volver a generar
// código y empezar de cero por un tick fallido.
test("recibir: un fallo de red puntual deja seguir esperando", async () => {
  lanza = true;
  assert.deepEqual(await pollSync("1234"), { status: "waiting" });
});

test("el código viaja en la petición", async () => {
  responde(200, { val: "x" });
  const antes = urls.length;
  await pollSync("4321");
  assert.match(urls.at(-1), /id=4321/);
  assert.ok(urls.length > antes);
});
