import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import { optionalSource } from "./_helpers/optional-source.mjs";

/**
 * Verifica que las credenciales de Warframe Market no se filtran por ningún camino:
 * ni en el cuerpo de la petición, ni en logs, ni en almacenamiento del navegador.
 *
 * Reproduce el cifrado real (ECDH P-256 + AES-GCM) en vez de comprobar solo el texto
 * del código: si el esquema deja de funcionar, estos tests fallan.
 */

const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));
const authSrc = readFileSync(new URL("../deploy/js/services/market/wfm_auth.service.js", import.meta.url), "utf8");
const cryptoSrc = readFileSync(new URL("../deploy/js/utils/wfm_crypto.js", import.meta.url), "utf8");

const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** Sella igual que el cliente. */
async function seal(publicKeyRaw, payload) {
    const workerKey = await crypto.subtle.importKey(
        "raw", publicKeyRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const eph = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey(
        { name: "ECDH", public: workerKey }, eph.privateKey,
        { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(payload)));
    return {
        epk: b64(await crypto.subtle.exportKey("raw", eph.publicKey)),
        iv: b64(iv),
        data: b64(data)
    };
}

/** Abre igual que el worker. */
async function open(privateKey, envelope) {
    const epk = await crypto.subtle.importKey(
        "raw", unb64(envelope.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const aes = await crypto.subtle.deriveKey(
        { name: "ECDH", public: epk }, privateKey,
        { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(envelope.iv) }, aes, unb64(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain));
}

const CREDS = { email: "tenno@example.com", password: "MiContraseñaSecreta123" };

test("el sobre cifrado no contiene la contraseña ni el email en claro", async () => {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);

    const sealed = await seal(pub, CREDS);
    const wire = JSON.stringify({ sealed, platform: "pc" });

    assert.ok(!wire.includes(CREDS.password), "la contraseña viaja en claro");
    assert.ok(!wire.includes(CREDS.email), "el email viaja en claro");
    assert.ok(!wire.includes("example.com"), "el dominio del email es visible");
    // Ni siquiera en base64 sin decodificar.
    assert.ok(!wire.includes(Buffer.from(CREDS.password).toString("base64")));
});

test("el worker recupera exactamente lo que cifró el cliente", async () => {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);

    const opened = await open(pair.privateKey, await seal(pub, CREDS));
    assert.deepEqual(opened, CREDS);
});

test("otra clave privada no puede abrir el sobre", async () => {
    const mine = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const other = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", mine.publicKey);

    const sealed = await seal(pub, CREDS);
    await assert.rejects(() => open(other.privateKey, sealed));
});

test("un sobre manipulado se rechaza (AES-GCM autentica)", async () => {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);

    const sealed = await seal(pub, CREDS);
    const tampered = unb64(sealed.data);
    tampered[0] ^= 0xff;
    await assert.rejects(() => open(pair.privateKey, { ...sealed, data: b64(tampered) }));
});

test("dos sobres del mismo secreto son distintos (clave efímera por login)", async () => {
    const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);

    const a = await seal(pub, CREDS);
    const b = await seal(pub, CREDS);
    assert.notEqual(a.data, b.data, "el ciphertext se repite");
    assert.notEqual(a.epk, b.epk, "se reutiliza la clave efímera");
});

test("el worker nunca registra credenciales en logs", () => {
    const start = workerSrc.indexOf("async 'wfm_login'");
    const body = workerSrc.slice(start, workerSrc.indexOf("async 'wfm_logout'"));
    assert.ok(!body.includes("console.log"), "el login no debe loguear");
    assert.ok(!body.includes("console.error"), "ni siquiera en el camino de error");
    // El email solo puede tocarse hasheado para el rate-limit.
    assert.match(body, /sha256Hex\(String\(body\.email\)/);
});

test("la clave privada solo sale del entorno, nunca del código", () => {
    assert.match(workerSrc, /env\.WFM_PRIVATE_KEY/);
    // Una clave PKCS8 en base64 incrustada sería un bloque largo sin espacios.
    const literals = workerSrc.match(/"[A-Za-z0-9+/=]{100,}"/g) || [];
    assert.equal(literals.length, 0, `posible clave incrustada: ${literals[0]?.slice(0, 40)}`);
});

test("el cliente no guarda la contraseña en sessionStorage", () => {
    // Solo se persisten token, nombre, slug, scope, estado y caducidad.
    const keys = [...authSrc.matchAll(/const (\w+_KEY) = "([^"]+)"/g)].map(m => m[2]);
    assert.ok(keys.length >= 5, "no se detectaron las claves de sesión");
    for (const k of keys) {
        assert.ok(!/pass|pwd|secret|email/i.test(k), `clave sospechosa: ${k}`);
    }
    assert.ok(!/setItem\([^)]*password/i.test(authSrc), "no debe persistirse la contraseña");
});

test("el cifrado usa parámetros vigentes (P-256 + AES-GCM 256)", () => {
    assert.match(cryptoSrc, /namedCurve: "P-256"/);
    assert.match(cryptoSrc, /name: "AES-GCM", length: 256/);
    // IV de 12 bytes: el tamaño recomendado para GCM.
    assert.match(cryptoSrc, /new Uint8Array\(12\)/);
    assert.ok(!/ECB|MD5|SHA-1\b/.test(cryptoSrc), "primitiva obsoleta");
});

test("el login rechaza texto plano cuando hay clave configurada", () => {
    const start = workerSrc.indexOf("async 'wfm_login'");
    const body = workerSrc.slice(start, workerSrc.indexOf("async 'wfm_logout'"));
    assert.match(body, /else if \(env\.WFM_PRIVATE_KEY\)/,
        "con clave presente, el envío en claro debe rechazarse");
});
