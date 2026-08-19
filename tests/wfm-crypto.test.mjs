// credential sealing before sending to worker (ephemeral ECDH P-256 + AES-GCM 256)
// imports the actual implementation and decrypts with worker private key rather than reimplementing crypto
// pins silent regressions where null sealCredentials might send cleartext or reused ephemeral keys would
// share AES keys

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const ALG = { name: "ECDH", namedCurve: "P-256" };

// module relies on browser btoa/atob and crypto.subtle
globalThis.btoa ??= (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob ??= (s) => Buffer.from(s, "base64").toString("binary");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
}

// fake worker key pair: public key is served via endpoint, private key is held only by this test
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

/** opens envelope like the worker using real private key */
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
  // not even base64-encoded: encryption is not reversible without the key
  const plano = Buffer.from("contraseñaLarguísima123").toString("base64");
  assert.ok(!todo.includes(plano.slice(0, 12)));
});

// reusing ephemeral keypairs would share AES keys across logins, and repeating an IV directly breaks
// AES-GCM
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

// returning null signals failed encryption: callers must handle it or risk transmitting passwords in
// cleartext
test("sin clave pública devuelve null en vez de algo a medias", async () => {
  sirveClave = false;
  // public key is cached for 1 h, requiring fresh module import to test miss behavior
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
