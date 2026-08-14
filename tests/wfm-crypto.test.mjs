// Sellado de credenciales antes de mandarlas al worker (ECDH P-256 efímero + AES-GCM 256).
//
// tests/wfm-credentials.test.mjs ya comprueba el esquema, pero REIMPLEMENTA el cifrado: si la
// implementación real se rompe, aquel test sigue verde porque no la ejecuta. Esto sí la importa
// y la abre con la clave privada del otro lado.
//
// Lo que se protege es un fallo silencioso de los peores: si sealCredentials devuelve null, el
// llamador puede acabar mandando la contraseña en claro; y si el par efímero se reutilizara,
// dos logins compartirían clave sin que nada lo indique.

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const ALG = { name: "ECDH", namedCurve: "P-256" };

// El módulo usa btoa/atob (del navegador) y crypto.subtle.
globalThis.btoa ??= (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
}

// Par del "worker": la pública se sirve por el endpoint, la privada solo la tiene este test.
const parWorker = await webcrypto.subtle.generateKey(ALG, true, ["deriveKey"]);
const publicaB64 = Buffer.from(
  await webcrypto.subtle.exportKey("raw", parWorker.publicKey),
).toString("base64");

let sirveClave = true;
let peticiones = 0;
globalThis.fetch = async (url) => {
  if (!String(url).includes("type=wfm_pubkey")) return { ok: false, status: 404 };
  peticiones++;
  if (!sirveClave) return { ok: false, status: 503 };
  return { ok: true, status: 200, json: async () => ({ key: publicaB64 }) };
};

const { sealCredentials } = await import("../deploy/js/utils/wfm_crypto.js");

const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** Abre el sobre como lo haría el worker, con la privada de verdad. */
async function abrir(sobre) {
  const epk = await webcrypto.subtle.importKey("raw", unb64(sobre.epk), ALG, false, []);
  const aes = await webcrypto.subtle.deriveKey(
    { name: "ECDH", public: epk },
    parWorker.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const claro = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(sobre.iv) },
    aes,
    unb64(sobre.data),
  );
  return JSON.parse(new TextDecoder().decode(claro));
}

test("el sobre solo lo abre quien tiene la privada del worker", async () => {
  const sobre = await sealCredentials({ email: "a@b.c", password: "secreta" });
  assert.ok(sobre, "debe producir un sobre");
  assert.deepEqual(Object.keys(sobre).sort(), ["data", "epk", "iv"]);
  assert.deepEqual(await abrir(sobre), { email: "a@b.c", password: "secreta" });
});

test("la contraseña no viaja en claro en ninguna parte del sobre", async () => {
  const sobre = await sealCredentials({ email: "a@b.c", password: "contraseñaLarguísima123" });
  const todo = JSON.stringify(sobre);
  assert.ok(!todo.includes("contraseña"), "no puede aparecer el texto plano");
  // Ni siquiera en base64: el cifrado no es reversible sin la clave.
  const plano = Buffer.from("contraseñaLarguísima123").toString("base64");
  assert.ok(!todo.includes(plano.slice(0, 12)));
});

// Reutilizar el par efímero haría que dos logins compartieran clave AES: quien capture uno y
// consiga descifrarlo, descifra el otro. Y repetir el IV en AES-GCM lo rompe directamente.
test("cada sellado estrena par efímero e IV", async () => {
  const a = await sealCredentials({ email: "x", password: "y" });
  const b = await sealCredentials({ email: "x", password: "y" });
  assert.notEqual(a.epk, b.epk, "el par efímero no puede reutilizarse");
  assert.notEqual(a.iv, b.iv, "el IV no puede repetirse");
  assert.notEqual(a.data, b.data, "el mismo texto no puede dar el mismo cifrado");
});

test("el IV mide los 12 bytes que pide AES-GCM", async () => {
  const sobre = await sealCredentials({ email: "x", password: "y" });
  assert.equal(unb64(sobre.iv).length, 12);
});

test("un sobre manipulado no se abre: AES-GCM autentica", async () => {
  const sobre = await sealCredentials({ email: "x", password: "y" });
  const roto = unb64(sobre.data);
  roto[0] ^= 0xff;
  await assert.rejects(
    () => abrir({ ...sobre, data: Buffer.from(roto).toString("base64") }),
    "un byte cambiado debe invalidar el sobre",
  );
});

// Devolver null es la señal de "no he podido cifrar". El llamador tiene que tratarla: si la
// ignora y manda el payload igual, la contraseña sale en claro.
test("sin clave pública devuelve null en vez de algo a medias", async () => {
  sirveClave = false;
  // La clave se cachea 1 h, así que hay que esperar a que caduque o forzar módulo nuevo.
  const { sealCredentials: sealFresco } = await import(
    "../deploy/js/utils/wfm_crypto.js?sinClave=1"
  );
  assert.equal(await sealFresco({ email: "x", password: "y" }), null);
  sirveClave = true;
});

test("la clave pública se pide una vez y se cachea", async () => {
  const antes = peticiones;
  await sealCredentials({ email: "x", password: "y" });
  await sealCredentials({ email: "x", password: "y" });
  assert.equal(peticiones, antes, "no debe volver a pedirla dentro del TTL");
});
