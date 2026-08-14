// HTTP cache policy: what the browser may answer on its own and what not
// the worker ttl does NOT reach the client: the Cloudflare zone rewrites Cache-Control on every cache HIT
// to `max-age=18000` (5 h)
// and the edge ignores the worker ttl too (fissures with max-age=60, swr=120 were served at age=395)
// it cannot be fixed from the repo, so the client declares the lifetime of each piece of data
// these tests make sure no new endpoint forgets to: stale data only shows hours later, in a browser that
// already had the app loaded
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionalSource } from "./_helpers/optional-source.mjs";

const apiSrc = readFileSync(
  fileURLToPath(new URL("../deploy/js/repositories/api.repository.js", import.meta.url)),
  "utf8",
);
const { src: workerSrc, test } = optionalSource(new URL("../worker-code.js", import.meta.url));

/**
 * function body from its signature, balancing braces
 * skips the parameter list first: some helpers here destructure options (`{ force = false } = {}`) and the
 * first brace would be THAT one
 */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  let p = src.indexOf("(", start);
  let parens = 0;
  while (p < src.length) {
    if (src[p] === "(") parens++;
    else if (src[p] === ")") { parens--; if (!parens) break; }
    p++;
  }
  const open = src.indexOf("{", p);
  let depth = 0, i = open;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) break; }
    i++;
  }
  return src.slice(open, i);
}

// data with a known expiry, cached by rotation upstream (IndexedDB or memory): a request that reaches the
// network is always an expired copy
// and the browser one is just as stale, so it cannot answer
const ROTATING = [
  "getActiveBounties",
  "getActiveFissures",
  "getArbitration",
  "getLichWeapons",
];

// data where only the CURRENT value counts
const LIVE = ["getServerTime", "getSyncMessage", "sendSyncMessage"];

test("fetchRotating revalida siempre contra el servidor", () => {
  const fn = bodyOf(apiSrc, "async function fetchRotating");
  assert.ok(fn, "falta el helper fetchRotating");
  assert.ok(
    /cache:\s*["']no-cache["']/.test(fn),
    "sin no-cache el navegador responde con su copia de 5h sin salir a la red",
  );
});

test("fetchRotating estrena clave de caché cuando se fuerza", () => {
  const fn = bodyOf(apiSrc, "async function fetchRotating");
  assert.ok(
    /if\s*\(force\)\s*url\s*\+=\s*`&_cb=\$\{Date\.now\(\)\}`/.test(fn),
    "el edge sigue sirviendo stale durante su swr justo cuando se acaba de rotar",
  );
});

test("fetchLive no deja guardar la respuesta en ninguna caché", () => {
  const fn = bodyOf(apiSrc, "async function fetchLive");
  assert.ok(fn, "falta el helper fetchLive");
  assert.ok(
    /cache:\s*["']no-store["']/.test(fn),
    "no-cache no basta: aquí no hay copia que pueda valer ni para revalidar",
  );
});

for (const name of ROTATING) {
  test(`${name} pasa por fetchRotating`, () => {
    const fn = bodyOf(apiSrc, `export async function ${name}(force = false)`);
    assert.ok(fn, `${name} debe aceptar force`);
    assert.ok(
      /return fetchRotating\(/.test(fn),
      `${name} pide datos que rotan: un fetch a pelo cae en la copia de 5h del navegador`,
    );
  });
}

for (const name of LIVE) {
  test(`${name} pasa por fetchLive`, () => {
    const fn = bodyOf(apiSrc, `export async function ${name}(`);
    assert.ok(fn, `no se encuentra ${name}`);
    assert.ok(
      /return fetchLive\(/.test(fn),
      `${name} solo vale en el instante en que se pide`,
    );
  });
}

test("el perfil se revalida: quien lo consulta dos veces espera ver el cambio", () => {
  const fn = bodyOf(apiSrc, "export async function getProfileData");
  assert.ok(
    /cache:\s*["']no-cache["']/.test(fn),
    "el worker le pone ttl 300 justo porque cambia al jugar; 5h de caché lo congelan",
  );
});

test("el buzón de sync nunca toca la caché compartida", () => {
  const line = workerSrc.match(/const skipGlobalCache = \[[^\]]*\]/)?.[0] || "";
  for (const type of ["sync_get", "sync_set"]) {
    assert.ok(
      line.includes(`"${type}"`),
      `${type}: una entrada compartida devuelve el mensaje viejo que se quiere superar`,
    );
  }
});

test("sync_set escribe de verdad aunque se repita el mismo mensaje", () => {
  const fn = bodyOf(workerSrc, "async 'sync_set'");
  assert.ok(
    /ResponseHelper\.live\(/.test(fn),
    "la escritura viaja en un GET: si la respuesta se cachea, la segunda vez no se escribe",
  );
});

test("las respuestas vivas del worker declaran no-store", () => {
  const fn = bodyOf(workerSrc, "    live(data, status = 200)");
  assert.ok(fn, "falta ResponseHelper.live");
  assert.ok(
    /"Cache-Control":\s*"no-store"/.test(fn),
    "json() tiene ttl mínimo 300 y swr 24h por defecto: para estos datos no hay ttl correcto",
  );
  for (const type of ["time", "sync_get"]) {
    assert.ok(
      /ResponseHelper\.live\(/.test(bodyOf(workerSrc, `async '${type}'`)),
      `${type} debe responder con live()`,
    );
  }
});
