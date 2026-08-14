// Farms se quedaba clavado en "ROTATING..." al rotar la hora del worldstate, y
// mientras tanto repetía el fetch en bucle. Eran tres defectos que se combinaban:
//
//   1. `rotationReloadAt` era un `let` DENTRO de renderBountiesTab(), y el reintento
//      llama a renderBountiesTab() -> cada pasada estrenaba el freno a 0 y el límite
//      de 30s no llegaba a aplicarse nunca.
//   2. fetchActiveBounties guardaba en IndexedDB `expiryTime = oracle.expiry`. Justo
//      tras rotar, el origen sirve el ciclo viejo unos segundos, así que ese valor ya
//      está en el pasado: la entrada nacía caducada y CADA render volvía a pedir.
//   3. Con el suelo de 60s del punto 2, la entrada recién guardada sigue vigente, así
//      que el reintento se respondía a sí mismo con las misiones caducadas si no podía
//      saltarse la caché.
//
// Nada de esto lo ve el lint ni la carga de la página: solo aparece en la rotación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../deploy/js/ui.components/farms/ui_bounties.js", import.meta.url));
const SVC = fileURLToPath(new URL("../deploy/js/services/farms/bounties.service.js", import.meta.url));
const API = fileURLToPath(new URL("../deploy/js/repositories/api.repository.js", import.meta.url));

const uiSrc = readFileSync(UI, "utf8");
const svcSrc = readFileSync(SVC, "utf8");
const apiSrc = readFileSync(API, "utf8");

/** Cuerpo de una función desde su firma, equilibrando llaves. */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) break; }
    i++;
  }
  return src.slice(open, i);
}

test("el freno del refetch vive fuera de renderBountiesTab", () => {
  const render = bodyOf(uiSrc, "export async function renderBountiesTab");
  assert.equal(
    /\b(let|var|const)\s+rotationReloadAt\b/.test(render),
    false,
    "declarado dentro del render, el reintento lo reinicia a 0 y nunca frena",
  );
  assert.ok(
    /^let rotationReloadAt\s*=/m.test(uiSrc),
    "debe ser estado de módulo para sobrevivir a los re-renders",
  );
});

test("el freno se respeta antes de programar otro refetch", () => {
  const render = bodyOf(uiSrc, "export async function renderBountiesTab");
  assert.ok(/if\s*\(\s*ts\s*<\s*rotationReloadAt\s*\)\s*return/.test(render), "falta la guarda");
  assert.ok(/rotationReloadAt\s*=\s*ts\s*\+\s*30000/.test(render), "el freno debe ser de 30s");
});

test("el reintento de rotación fuerza el refetch", () => {
  const render = bodyOf(uiSrc, "export async function renderBountiesTab");
  assert.ok(
    /renderBountiesTab\(true\)/.test(render),
    "sin force, la entrada recién guardada (60s de suelo) devuelve las misiones caducadas",
  );
});

test("un render normal sigue aprovechando la caché", () => {
  assert.ok(
    /export async function renderBountiesTab\(force = false\)/.test(uiSrc),
    "force debe ser opt-in: por defecto se usa la caché",
  );
  assert.ok(/fetchActiveBounties\(force\)/.test(uiSrc), "el render debe propagar su force");
});

test("fetchActiveBounties acepta force y lo aplica a la lectura de caché", () => {
  assert.ok(/export async function fetchActiveBounties\(force = false\)/.test(svcSrc));
  assert.ok(
    /if\s*\(\s*!force\s*&&\s*cached\?\.expiryTime\s*>\s*serverNow\(\)\s*\)/.test(svcSrc),
    "force debe saltarse la caché local",
  );
});

test("el expiryTime guardado nunca nace en el pasado", () => {
  assert.ok(
    /Math\.max\(\s*rawExpiry\s*,\s*now\s*\+\s*60000\s*\)/.test(svcSrc),
    "sin suelo, un oracle.expiry ya pasado deja la entrada caducada y cada render repite el fetch",
  );
});

// El defecto que sobrevivió a todo lo de arriba: `force` se quedaba en IndexedDB. El zone de
// Cloudflare reescribe el Cache-Control de lo que sirve desde su caché a max-age=18000 (5h),
// y las bounties rotan cada 2,5h -> el navegador respondía con el ciclo anterior sin tocar la
// red durante DOS rotaciones, así que el reintento "forzado" releía el mismo expiry pasado y
// ROTATING no se iba ni recargando la página. Medido en producción (mismo endpoint):
//   x-cache: MISS        -> max-age=7386   (lo que falta para rotar, correcto)
//   cf-cache-status: HIT -> max-age=18000  (5h, reescrito por el zone)
// Y el edge ignora igualmente el max-age del worker: fisuras (max-age=60, swr=120) se sirvió
// con age=254. Sin cache-buster no hay forma de alcanzar el ciclo nuevo.
// La política de caché en sí la cubre http-cache-policy.test.mjs; aquí solo que las bounties
// se acogen a ella y que el force llega hasta el fondo.
test("las bounties se piden por la vía de los datos que rotan", () => {
  assert.ok(
    /export async function getActiveBounties\(force = false\)/.test(apiSrc),
    "getActiveBounties debe aceptar force para poder bustear la caché",
  );
  const fn = bodyOf(apiSrc, "export async function getActiveBounties");
  assert.ok(
    /return fetchRotating\("type=active_bounties[^"]*",\s*\{\s*force\s*\}\)/.test(fn),
    "un fetch a pelo aquí vuelve a caer en la copia de 5h del navegador",
  );
});

test("fetchActiveBounties propaga force hasta la petición", () => {
  assert.ok(
    /getActiveBounties\(force\)/.test(svcSrc),
    "saltarse solo IndexedDB no sirve si la respuesta sale de la caché HTTP",
  );
});

// Segundo camino a un ROTATING permanente, este sin red de por medio: renderBountiesTab() es
// async y lo disparan switchTab, updateUILabels, los chips, las estrellas y el propio
// reintento. Dos renders solapados -> el segundo hace clearInterval antes de que el primero
// cree el suyo -> el intervalo del primero queda vivo con su expiryTimes viejo y escribe
// "ROTATING" cada segundo sobre la lista nueva. Cada solape dejaba otro intervalo suelto.
test("un render superado no pinta ni deja intervalos vivos", () => {
  const render = bodyOf(uiSrc, "export async function renderBountiesTab");
  assert.ok(/const myTurn = \+\+renderToken/.test(render), "falta el turno del render");
  assert.ok(
    /await fetchActiveBounties\(force\);\s*(\/\/[^\n]*\n\s*)*if\s*\(myTurn !== renderToken\)\s*return;/.test(render),
    "hay que abandonar justo al volver de la red, antes de repintar o crear el intervalo",
  );
  assert.ok(
    /^let renderToken\s*=/m.test(uiSrc),
    "el turno debe ser estado de módulo: dentro del render cada pasada lo reiniciaría",
  );
});

test("parar el contador deja bountyInterval a null", () => {
  const stop = bodyOf(uiSrc, "export function stopBountyTimers");
  assert.ok(/clearInterval\(bountyInterval\)/.test(stop));
  assert.ok(
    /bountyInterval = null/.test(stop),
    "sin esto dos renders se pasan un id ya cancelado y el segundo cree haber parado algo",
  );
});

test("el watcher de alarmas llama al fetcher sin argumentos", () => {
  // startAlarmWatcher(fetchActiveBounties, ...) pasa la función por referencia. Si el
  // tick la invocara con algo truthy, activaría `force` y saltaría la caché cada 60s.
  const alerts = readFileSync(
    fileURLToPath(new URL("../deploy/js/services/farms/alerts.service.js", import.meta.url)),
    "utf8",
  );
  assert.ok(
    /src\.fetchFn\(\)/.test(alerts),
    "el watcher debe llamar fetchFn() sin argumentos para no forzar refetch cada tick",
  );
});
